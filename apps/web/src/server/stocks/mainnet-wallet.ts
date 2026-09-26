import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAddress } from "viem";
import { z } from "zod";
import { mainnetWallet } from "./mainnet-orders";
import { requireTrade as ensure } from "./mainnet-trade";

/** Provision only the authenticated account. No account or address comes from AI arguments. */
export async function ensureMainnetWallet(db: DatabaseSync, account: string) {
  const active = () =>
    db.prepare("SELECT id FROM wa_accounts WHERE id=? AND status='active'").get(account);
  ensure(active(), "account_not_active");
  const policy = process.env.PRIVY_MAINNET_POLICY_ID?.trim();
  ensure(policy, "mainnet_policy_required");
  const existing = mainnetWallet(db, account);
  if (existing) {
    ensure(
      existing.policy_id === policy &&
        existing.app_id === process.env.PRIVY_APP_ID &&
        existing.owner_id === process.env.PRIVY_WALLET_OWNER_ID,
      "wallet_identity_mismatch",
    );
    return existing;
  }
  // Durable external ID: after a timeout only lookup is allowed on later runs.
  db.exec(
    "CREATE TABLE IF NOT EXISTS wa_mainnet_wallet_requests(account_id TEXT PRIMARY KEY,external_id TEXT NOT NULL UNIQUE,idempotency_key TEXT NOT NULL UNIQUE,submitted_at INTEGER)",
  );
  db.prepare(
    "INSERT OR IGNORE INTO wa_mainnet_wallet_requests(account_id,external_id,idempotency_key) VALUES(?,?,?)",
  ).run(account, `steward_mainnet_${account}`, randomUUID());
  const job = db
    .prepare("SELECT * FROM wa_mainnet_wallet_requests WHERE account_id=?")
    .get(account) as {
    external_id: string;
    idempotency_key: string;
    submitted_at: number | null;
  };
  const app = process.env.PRIVY_APP_ID!,
    owner = process.env.PRIVY_WALLET_OWNER_ID!;
  ensure(app && owner && process.env.PRIVY_APP_SECRET, "privy_configuration_missing");
  const headers = {
    Authorization:
      "Basic " + Buffer.from(app + ":" + process.env.PRIVY_APP_SECRET).toString("base64"),
    "privy-app-id": app,
    "content-type": "application/json",
  };
  let response = await fetch(
    "https://api.privy.io/v1/wallets/ext_wal_" + encodeURIComponent(job.external_id),
    { headers, signal: AbortSignal.timeout(15000), redirect: "error" },
  );
  if (response.status === 404) {
    ensure(active(), "account_not_active");
    ensure(job.submitted_at === null, "wallet_creation_uncertain_lookup_only");
    ensure(
      db
        .prepare(
          "UPDATE wa_mainnet_wallet_requests SET submitted_at=? WHERE account_id=? AND submitted_at IS NULL",
        )
        .run(Date.now(), account).changes === 1,
    );
    response = await fetch("https://api.privy.io/v1/wallets", {
      method: "POST",
      headers: { ...headers, "privy-idempotency-key": job.idempotency_key },
      body: JSON.stringify({
        chain_type: "ethereum",
        external_id: job.external_id,
        owner_id: owner,
        policy_ids: [policy],
      }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  }
  ensure(response.ok, "wallet_provider_unavailable");
  const data = z
    .object({
      id: z.string(),
      address: z.string(),
      chain_type: z.literal("ethereum"),
      external_id: z.string(),
      owner_id: z.string(),
      policy_ids: z.array(z.string()),
    })
    .parse(await response.json());
  ensure(
    data.external_id === job.external_id &&
      data.owner_id === owner &&
      data.policy_ids.length === 1 &&
      data.policy_ids[0] === policy,
    "wallet_identity_mismatch",
  );
  ensure(active(), "account_not_active");
  const address = getAddress(data.address);
  ensure(
    !db
      .prepare("SELECT account_id FROM wa_managed_wallets WHERE lower(address)=lower(?)")
      .get(address),
    "must_use_dedicated_mainnet_wallet",
  );
  db.prepare(
    "INSERT OR IGNORE INTO wa_mainnet_wallets(account_id,address,provider_id,external_id,app_id,owner_id,policy_id) VALUES(?,?,?,?,?,?,?)",
  ).run(account, address, data.id, job.external_id, app, owner, policy);

  const wallet = mainnetWallet(db, account);
  ensure(
    wallet &&
      wallet.address === address &&
      wallet.provider_id === data.id &&
      wallet.policy_id === policy,
    "wallet_identity_mismatch",
  );
  return wallet;
}
