import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Aggregate counts for the public landing page. Opens the WhatsApp database
// read-only and returns totals only; no identifiers leave this function.
export type PublicStats = { users: number; confirmed: number };

let cache: { at: number; value: PublicStats | null } | null = null;

export function publicStats(): PublicStats | null {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  let value: PublicStats | null = null;
  const path = process.env.WHATSAPP_DATABASE_PATH || ".data/whatsapp.sqlite";
  try {
    if (existsSync(/* turbopackIgnore: true */ path)) {
      const db = new DatabaseSync(/* turbopackIgnore: true */ path, { readOnly: true });
      try {
        const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
        value = {
          users: count("SELECT COUNT(*) AS n FROM wa_accounts WHERE status='active'"),
          confirmed: count("SELECT COUNT(*) AS n FROM wa_mainnet_orders WHERE state='confirmed'"),
        };
      } finally {
        db.close();
      }
    }
  } catch {
    value = null;
  }
  cache = { at: Date.now(), value };
  return value;
}
