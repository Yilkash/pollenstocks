import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { seal, unseal } from "../whatsapp/config";

export function migrateStockQuotes(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS wa_stock_quotes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL,
    UNIQUE(account_id,message_id)
  );`);
}
type StoredQuote = { id: string; payload: string; expires: number };
export function readStockQuote(db: DatabaseSync, key: Buffer, account: string, messageId: string) {
  const row = db
    .prepare("SELECT id,payload,expires FROM wa_stock_quotes WHERE account_id=? AND message_id=?")
    .get(account, messageId) as StoredQuote | undefined;
  return row
    ? { id: row.id, expires: row.expires, body: unseal<{ body: string }>(row.payload, key).body }
    : null;
}
// A durable informational snapshot, not a trade order or authorization. Values
// stay encrypted locally and are not added to the model's task/history context.
export function saveStockQuote(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  messageId: string,
  body: string,
  snapshot: Record<string, string | number>,
) {
  const id = randomUUID();
  const expires = Date.now() + 60000;
  db.prepare(
    "INSERT OR IGNORE INTO wa_stock_quotes(id,account_id,message_id,payload,created,expires) VALUES(?,?,?,?,?,?)",
  ).run(id, account, messageId, seal({ body, snapshot }, key), Date.now(), expires);
  const stored = readStockQuote(db, key, account, messageId);
  if (!stored) throw Error("stock_quote_not_saved");
  return stored;
}
