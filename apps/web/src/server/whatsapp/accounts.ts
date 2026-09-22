import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { senderLookup } from "./config";
import { actionFor, menu, text } from "./menu";

// Version the exact disclosure so later custody changes require fresh consent.
export const CONSENT_VERSION = "steward-test-account-v1";
export const DISCLOSURE =
  "Create a Steward test account\n\nSteward will control your wallet and authorize only payments you confirm. This prototype uses Robinhood Chain testnet and Demo USD, which has no monetary value. Control of this WhatsApp account gives access to your Steward account.\n\nWallet setup is still pending. Continuing creates your test account and records your consent; it does not create or fund a wallet yet. Phone-number recipient lookup is off until you choose to enable it.\n\nThis choice expires in 10 minutes.";
type Account = { id: string; status: string; wallet_state: string };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function migrateAccounts(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_accounts (
      id TEXT PRIMARY KEY, sender TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active',
      consent_version TEXT NOT NULL, consent_at INTEGER NOT NULL, consent_message_id TEXT NOT NULL,
      phone_lookup INTEGER NOT NULL DEFAULT 0, wallet_state TEXT NOT NULL DEFAULT 'awaiting_provider',
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wa_account_consents (
      token_hash TEXT PRIMARY KEY, sender TEXT NOT NULL, version TEXT NOT NULL,
      expires INTEGER NOT NULL, consumed INTEGER, outcome TEXT
    );
    CREATE TABLE IF NOT EXISTS wa_wallet_requests (
      account_id TEXT PRIMARY KEY REFERENCES wa_accounts(id), external_id TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE, chain INTEGER NOT NULL CHECK(chain=46630),
      state TEXT NOT NULL DEFAULT 'awaiting_provider', created INTEGER NOT NULL
    );
  `);
}
// Invoked inside the inbox/outbox transaction; account creation, consuming consent and
// enqueueing its reply succeed together. No provider/network work belongs in this function.
export function accountReply(
  db: DatabaseSync,
  key: Buffer,
  message: { from: string; input: string; id: string },
) {
  const sender = senderLookup(message.from, key);
  const account = db
    .prepare("SELECT id,status,wallet_state FROM wa_accounts WHERE sender=?")
    .get(sender) as Account | undefined;
  if (account && account.status !== "active")
    return text(
      "This account is paused. Contact the Steward operator for recovery. No wallet action was performed.",
    );
  if (message.input.startsWith("enroll:")) {
    const match = /^enroll:(accept|cancel):([a-f0-9]{48})$/.exec(message.input);
    if (!match)
      return text(
        "This account confirmation is invalid. Choose Create account from Menu for a new one.",
      );
    const [, action, token] = match;
    const consent = db
      .prepare(
        "SELECT token_hash FROM wa_account_consents WHERE token_hash=? AND sender=? AND version=? AND consumed IS NULL AND expires>?",
      )
      .get(digest(token), sender, CONSENT_VERSION, Date.now());
    if (!consent)
      return text(
        "This confirmation expired or was already used. Type Menu to view your account or start again.",
      );
    db.prepare(
      "UPDATE wa_account_consents SET consumed=?,outcome=? WHERE token_hash=? AND consumed IS NULL",
    ).run(Date.now(), action, digest(token));
    if (action === "cancel")
      return text("Account setup cancelled. No wallet was created. Type Menu to return.");
    if (!account) {
      const id = randomUUID(),
        now = Date.now();
      db.prepare(
        "INSERT INTO wa_accounts(id,sender,consent_version,consent_at,consent_message_id,created) VALUES(?,?,?,?,?,?)",
      ).run(id, sender, CONSENT_VERSION, now, message.id, now);
      db.prepare(
        "INSERT INTO wa_wallet_requests(account_id,external_id,idempotency_key,chain,created) VALUES(?,?,?,?,?)",
      ).run(id, "steward_" + id, randomUUID(), 46630, now);
    }
    return text(
      "Your Steward test account is created. Wallet setup is pending; no wallet address or test funds are available yet. Type Menu to return, or choose My account to check setup status.",
    );
  }
  const action = actionFor(message.input);
  if (
    action === "create" ||
    ["my account", "menu:account"].includes(message.input.trim().toLowerCase())
  ) {
    if (account)
      return text(
        "Your Steward test account is active. Wallet setup is pending. No wallet has been created or funded yet. Phone-number recipient lookup is off. Type Menu to return.",
      );
    // Invalidate older offers so only the newest account consent can be used.
    db.prepare(
      "UPDATE wa_account_consents SET consumed=?,outcome='superseded' WHERE sender=? AND consumed IS NULL",
    ).run(Date.now(), sender);
    const token = randomBytes(24).toString("hex");
    db.prepare(
      "INSERT INTO wa_account_consents(token_hash,sender,version,expires) VALUES(?,?,?,?)",
    ).run(digest(token), sender, CONSENT_VERSION, Date.now() + 10 * 60_000);
    return {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: DISCLOSURE },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "enroll:accept:" + token, title: "Create test account" },
            },
            { type: "reply", reply: { id: "enroll:cancel:" + token, title: "Cancel" } },
          ],
        },
      },
    };
  }
  if (["hi", "hello", "menu", "start"].includes(message.input.trim().toLowerCase()))
    return menu(!!account);
  if (action && ["balance", "send", "receive", "history", "contacts"].includes(action)) {
    return text(
      account
        ? "Your test account is ready, but wallet setup is pending. This action is not available yet; no payment was prepared or sent. Type Menu to return."
        : "Create your Steward test account first: type Create account to review the details. Wallet setup is still pending.",
    );
  }
  return null;
}
