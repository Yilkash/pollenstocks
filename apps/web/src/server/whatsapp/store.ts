import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { seal, senderLookup, unseal } from "./config";
import { reply } from "./menu";
import { accountReply, migrateAccounts } from "./accounts";

export type Incoming = { id: string; from: string; input: string; timestamp: number };
export class WhatsAppStore {
  db: DatabaseSync;
  constructor(private key: Buffer) {
    const path = process.env.WHATSAPP_DATABASE_PATH || ".data/whatsapp.sqlite";
    mkdirSync(dirname(resolve(/* turbopackIgnore: true */ path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS wa_inbox(id TEXT PRIMARY KEY, sender TEXT NOT NULL, received INTEGER NOT NULL, payload TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS wa_inbox_sender ON wa_inbox(sender,received);
      CREATE TABLE IF NOT EXISTS wa_outbox(id TEXT PRIMARY KEY, payload TEXT NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', started INTEGER, provider_id TEXT, error TEXT);
    `);
    migrateAccounts(this.db);
  }
  accept(messages: Incoming[]) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const message of messages) {
        const sender = senderLookup(message.from, this.key);
        if (this.db.prepare("SELECT id FROM wa_inbox WHERE id=?").get(message.id)) continue;
        // Bound each sender in both allowlist and public modes.
        const count = this.db
          .prepare("SELECT COUNT(*) AS n FROM wa_inbox WHERE sender=? AND received>?")
          .get(sender, Date.now() - 60_000) as { n: number };
        if (count.n >= 20) continue;
        this.db
          .prepare("INSERT INTO wa_inbox(id,sender,received,payload) VALUES(?,?,?,?)")
          .run(message.id, sender, Date.now(), seal(message, this.key));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  prepare() {
    // Local work and outbox insertion commit together; a crash cannot enqueue the reply twice.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db
        .prepare(
          "SELECT id,payload FROM wa_inbox WHERE processed=0 ORDER BY received,rowid LIMIT 50",
        )
        .all() as { id: string; payload: string }[];
      for (const row of rows) {
        const message = unseal<Incoming>(row.payload, this.key);
        const response = accountReply(this.db, this.key, message) ?? reply(message.input);
        const setup = this.db
          .prepare(
            "SELECT account_id FROM wa_wallet_provisioning WHERE consent_message_id=? AND state='queued'",
          )
          .get(message.id) as { account_id: string } | undefined;
        if (setup)
          this.db
            .prepare(
              "INSERT OR IGNORE INTO wa_wallet_notices(account_id,recipient,expires) VALUES(?,?,?)",
            )
            .run(
              setup.account_id,
              seal({ to: message.from }, this.key),
              message.timestamp + 23 * 60 * 60_000,
            );
        this.db.prepare("INSERT OR IGNORE INTO wa_outbox(id,payload,expires) VALUES(?,?,?)").run(
          row.id,
          seal(
            {
              to: message.from,
              ...(setup ? { _steward_type: "typing", message_id: message.id } : response),
            },
            this.key,
          ),
          message.timestamp + 23 * 60 * 60_000,
        );
        this.db.prepare("UPDATE wa_inbox SET processed=1 WHERE id=?").run(row.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  claim() {
    this.db
      .prepare(
        "UPDATE wa_outbox SET state='unknown',error='delivery_interrupted' WHERE state='sending' AND started<?",
      )
      .run(Date.now() - 180_000);
    this.db
      .prepare("UPDATE wa_outbox SET state='expired' WHERE state='pending' AND expires<=?")
      .run(Date.now());
    return this.db
      .prepare(
        "UPDATE wa_outbox SET state='sending',started=? WHERE id=(SELECT id FROM wa_outbox WHERE state='pending' ORDER BY rowid LIMIT 1) RETURNING id,payload",
      )
      .get(Date.now()) as { id: string; payload: string } | undefined;
  }
  finish(id: string, state: string, providerId: string | null, error: string | null) {
    this.db
      .prepare("UPDATE wa_outbox SET state=?,provider_id=?,error=? WHERE id=? AND state='sending'")
      .run(state, providerId, error, id);
  }
  close() {
    this.db.close();
  }
}
