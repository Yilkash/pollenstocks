import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createManagedWallet, getManagedWallet, WalletProviderError } from "../wallets/privy";
import { senderLookup } from "./config";
import { walletConfiguration, walletSetupEnabled } from "./wallet-setup";

type Job = {
  account_id: string;
  app_id: string;
  owner_id: string;
  policy_id: string;
  external_id: string;
  idempotency_key: string;
  submitted_at: number | null;
  sender: string;
};
// One job per invocation. Creation is never automatically retried after a possibly
// submitted request: subsequent attempts only look up the same external ID.
export async function provisionWallet(db: DatabaseSync, allowed: Set<string>, key: Buffer) {
  if (!walletSetupEnabled()) return;
  const allowedKeys = new Set([...allowed].map((value) => senderLookup(value, key)));
  const lease = randomUUID(),
    now = Date.now();
  let job: Job | undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    const candidates = db
      .prepare(
        `SELECT p.*,r.external_id,r.idempotency_key,a.sender
      FROM wa_wallet_provisioning p JOIN wa_accounts a ON a.id=p.account_id
      JOIN wa_wallet_requests r ON r.account_id=p.account_id
      WHERE a.status='active' AND p.state IN ('queued','checking','unknown')
      AND p.next_check<=? AND (p.lease_until IS NULL OR p.lease_until<?)
      ORDER BY p.consent_at LIMIT 50`,
      )
      .all(now, now) as Job[];
    job = candidates.find((row) => allowedKeys.has(row.sender));
    if (job)
      db.prepare(
        "UPDATE wa_wallet_provisioning SET state='checking',lease=?,lease_until=? WHERE account_id=?",
      ).run(lease, now + 120000, job.account_id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (!job) return;
  const selected = job;
  function finish(state: string, error: string) {
    db.prepare(
      "UPDATE wa_wallet_provisioning SET state=?,error=?,lease=NULL,lease_until=NULL,next_check=? WHERE account_id=? AND lease=?",
    ).run(state, error, Date.now() + 60000, selected.account_id, lease);
  }
  try {
    const config = walletConfiguration();
    if (
      job.app_id !== config.app ||
      job.owner_id !== config.owner ||
      job.policy_id !== config.policy
    ) {
      finish("blocked", "configuration_changed");
      return;
    }
    let wallet = await getManagedWallet(job.external_id);
    if (!wallet && job.submitted_at !== null) {
      finish("unknown", "creation_outcome_unknown");
      return;
    }
    if (!wallet) {
      // Persist intent to submit while still holding a valid lease. Recheck account
      // pause status after the lookup; never hold a SQLite transaction over HTTP.
      const claim = db
        .prepare(
          `UPDATE wa_wallet_provisioning SET submitted_at=?
        WHERE account_id=? AND lease=? AND lease_until>? AND submitted_at IS NULL
        AND EXISTS(SELECT 1 FROM wa_accounts WHERE id=? AND status='active')`,
        )
        .run(Date.now(), job.account_id, lease, Date.now(), job.account_id);
      if (claim.changes !== 1) return;
      wallet = await createManagedWallet(job.external_id, job.idempotency_key);
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const held = db
        .prepare(
          "SELECT account_id FROM wa_wallet_provisioning WHERE account_id=? AND lease=? AND lease_until>?",
        )
        .get(job.account_id, lease, Date.now());
      if (held) {
        db.prepare(
          "INSERT INTO wa_managed_wallets(account_id,provider_id,address,chain,app_id,owner_id,policy_id,external_id,created) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          job.account_id,
          wallet.id,
          wallet.address,
          46630,
          job.app_id,
          job.owner_id,
          job.policy_id,
          wallet.externalId,
          Date.now(),
        );
        db.prepare(
          "UPDATE wa_wallet_provisioning SET state='ready',lease=NULL,lease_until=NULL,error=NULL WHERE account_id=? AND lease=?",
        ).run(job.account_id, lease);
        db.prepare("UPDATE wa_accounts SET wallet_state='ready' WHERE id=?").run(job.account_id);
        db.prepare("UPDATE wa_wallet_requests SET state='ready' WHERE account_id=?").run(
          job.account_id,
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    const code = e instanceof WalletProviderError ? e.code : "provisioning_unresolved";
    const blocked = /mismatch|invalid|not_configured|disabled/.test(code);
    finish(blocked ? "blocked" : "unknown", code);
  }
}
