import type { DatabaseSync } from "node:sqlite";
import { seal, unseal } from "./config";

export function migrateWalletNotices(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS wa_wallet_notices (
    account_id TEXT PRIMARY KEY, recipient TEXT NOT NULL, expires INTEGER NOT NULL
  )`);
}
// Caller owns the transaction. A stable outbox ID prevents duplicate completion
// messages across worker restarts, including reconciliation after provider timeouts.
export function queueWalletNotice(
  db: DatabaseSync,
  key: Buffer,
  accountId: string,
  kind: "ready" | "delayed",
  reply: object,
) {
  const notice = db
    .prepare("SELECT recipient,expires FROM wa_wallet_notices WHERE account_id=?")
    .get(accountId) as { recipient: string; expires: number } | undefined;
  if (!notice || notice.expires <= Date.now()) return;
  const account = db.prepare("SELECT status FROM wa_accounts WHERE id=?").get(accountId) as
    | { status: string }
    | undefined;
  if (account?.status !== "active") return;
  const { to } = unseal<{ to: string }>(notice.recipient, key);
  db.prepare("INSERT OR IGNORE INTO wa_outbox(id,payload,expires) VALUES(?,?,?)").run(
    `wallet:${kind}:${accountId}`,
    seal({ to, ...reply }, key),
    notice.expires,
  );
}
