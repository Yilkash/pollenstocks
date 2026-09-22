import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError, type Contact, type Payment, type PaymentStatus } from "@/lib/shared";

export const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export class Store {
  db: DatabaseSync;
  constructor(path = process.env.DATABASE_PATH || ".data/steward.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, expires INTEGER NOT NULL, busy_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS contacts (wallet TEXT NOT NULL, alias TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL, PRIMARY KEY(wallet, alias));
      CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, chain INTEGER NOT NULL, request_id TEXT NOT NULL, status TEXT NOT NULL, hash TEXT UNIQUE, expires INTEGER NOT NULL, created INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(wallet, chain, request_id));
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_payment ON payments(wallet, chain) WHERE status IN ('signing', 'submitted', 'unknown');
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet TEXT NOT NULL, chain INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL);
    `);
  }
  challenge(wallet: string, origin: string, chain: number) {
    const id = randomBytes(24).toString("hex");
    const expires = Date.now() + 5 * 60_000;
    const message = [
      new URL(origin).host + " wants you to sign in to Steward Pay:",
      wallet,
      "",
      "Sign in to view your contacts and prepare testnet payments. This does not authorize a transfer.",
      "",
      "URI: " + origin,
      "Version: 1",
      "Chain ID: " + chain,
      "Nonce: " + id,
      "Issued At: " + new Date().toISOString(),
      "Expiration Time: " + new Date(expires).toISOString(),
    ].join("\n");
    this.db.prepare("DELETE FROM challenges WHERE expires < ?").run(Date.now());
    this.db
      .prepare("INSERT INTO challenges(id,wallet,message,expires) VALUES(?,?,?,?)")
      .run(id, wallet.toLowerCase(), message, expires);
    return { id, message, expires };
  }
  getChallenge(id: string) {
    const c = this.db
      .prepare("SELECT * FROM challenges WHERE id=? AND used=0 AND expires>?")
      .get(id, Date.now()) as { wallet: string; message: string } | undefined;
    if (!c) throw new AppError("Sign-in request expired or was already used. Connect again.", 401);
    return c;
  }
  consumeChallenge(id: string) {
    const result = this.db
      .prepare("UPDATE challenges SET used=1 WHERE id=? AND used=0 AND expires>?")
      .run(id, Date.now());
    if (!result.changes) throw new AppError("Sign-in request expired or was already used.", 401);
  }
  newSession(wallet: string) {
    const token = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    this.db
      .prepare("INSERT INTO sessions(id,wallet,expires) VALUES(?,?,?)")
      .run(digest(token), wallet.toLowerCase(), Date.now() + 86_400_000);
    return token;
  }
  session(token: string) {
    return this.db
      .prepare("SELECT id,wallet FROM sessions WHERE id=? AND expires>?")
      .get(digest(token), Date.now()) as { id: string; wallet: string } | undefined;
  }
  logout(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(digest(token));
  }
  lockChat(id: string) {
    const result = this.db
      .prepare("UPDATE sessions SET busy_until=? WHERE id=? AND busy_until<?")
      .run(Date.now() + 120_000, id, Date.now());
    if (!result.changes) throw new AppError("Please wait for the current message to finish.", 429);
  }
  unlockChat(id: string) {
    this.db.prepare("UPDATE sessions SET busy_until=0 WHERE id=?").run(id);
  }
  contacts(wallet: string): Contact[] {
    return this.db
      .prepare("SELECT name,address FROM contacts WHERE wallet=? ORDER BY alias")
      .all(wallet.toLowerCase()) as unknown as Contact[];
  }
  addContact(wallet: string, contact: Contact) {
    if (this.contacts(wallet).length >= 100) throw new AppError("Contact limit reached.");
    try {
      this.db
        .prepare("INSERT INTO contacts(wallet,alias,name,address) VALUES(?,?,?,?)")
        .run(wallet.toLowerCase(), contact.name.toLowerCase(), contact.name, contact.address);
    } catch {
      throw new AppError(
        "That contact name already exists. Remove it before saving a different address.",
        409,
      );
    }
    return contact;
  }
  removeContact(wallet: string, name: string) {
    this.db
      .prepare("DELETE FROM contacts WHERE wallet=? AND alias=?")
      .run(wallet.toLowerCase(), name.toLowerCase());
  }
  private hydrate(row: Record<string, unknown>): Payment {
    const p = JSON.parse(row.payload as string) as Payment;
    return { ...p, status: row.status as PaymentStatus, hash: row.hash as Payment["hash"] };
  }
  payment(wallet: string, id: string): Payment {
    const row = this.db
      .prepare("SELECT * FROM payments WHERE id=? AND wallet=?")
      .get(id, wallet.toLowerCase());
    if (!row) throw new AppError("Payment not found.", 404);
    return this.hydrate(row);
  }
  byRequest(wallet: string, chain: number, requestId: string) {
    const row = this.db
      .prepare("SELECT * FROM payments WHERE wallet=? AND chain=? AND request_id=?")
      .get(wallet.toLowerCase(), chain, requestId);
    return row ? this.hydrate(row) : null;
  }
  history(wallet: string, chain: number) {
    this.db
      .prepare(
        "UPDATE payments SET status='expired' WHERE wallet=? AND chain=? AND status='draft' AND expires<=?",
      )
      .run(wallet.toLowerCase(), chain, Date.now());
    return this.db
      .prepare("SELECT * FROM payments WHERE wallet=? AND chain=? ORDER BY created DESC LIMIT 50")
      .all(wallet.toLowerCase(), chain)
      .map((row) => this.hydrate(row));
  }
  insert(p: Payment) {
    try {
      this.db
        .prepare(
          "INSERT INTO payments(id,wallet,chain,request_id,status,hash,expires,created,payload) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          p.id,
          p.sender.toLowerCase(),
          p.chainId,
          p.requestId,
          p.status,
          p.hash,
          p.expiresAt,
          p.createdAt,
          JSON.stringify(p),
        );
    } catch {
      const existing = this.byRequest(p.sender, p.chainId, p.requestId);
      if (existing) return existing;
      throw new AppError("Could not store the payment.", 500);
    }
    return p;
  }
  claim(p: Payment) {
    try {
      const updated = this.db
        .prepare(
          "UPDATE payments SET status='signing', payload=? WHERE id=? AND wallet=? AND status='draft' AND expires>?",
        )
        .run(JSON.stringify(p), p.id, p.sender.toLowerCase(), Date.now());
      if (!updated.changes)
        throw new AppError("This payment was already claimed or has expired.", 409);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("Resolve the existing pending payment before starting another.", 409);
    }
    return this.payment(p.sender, p.id);
  }
  transition(p: Payment, from: PaymentStatus[]) {
    try {
      const result = this.db
        .prepare(
          "UPDATE payments SET status=?, hash=?, payload=? WHERE id=? AND wallet=? AND status IN (" +
            from.map(() => "?").join(",") +
            ")",
        )
        .run(p.status, p.hash, JSON.stringify(p), p.id, p.sender.toLowerCase(), ...from);
      if (!result.changes)
        throw new AppError("Payment state changed. Refresh before continuing.", 409);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("This transaction is already linked to another payment.", 409);
    }
    return this.payment(p.sender, p.id);
  }
  messages(wallet: string, chain: number) {
    return (
      this.db
        .prepare(
          "SELECT role,content FROM messages WHERE wallet=? AND chain=? ORDER BY id DESC LIMIT 12",
        )
        .all(wallet.toLowerCase(), chain) as unknown as {
        role: "user" | "assistant";
        content: string;
      }[]
    ).reverse();
  }
  addMessage(wallet: string, chain: number, role: "user" | "assistant", content: string) {
    this.db
      .prepare("INSERT INTO messages(wallet,chain,role,content) VALUES(?,?,?,?)")
      .run(wallet.toLowerCase(), chain, role, content.slice(0, 6000));
    this.db
      .prepare(
        "DELETE FROM messages WHERE wallet=? AND chain=? AND id NOT IN (SELECT id FROM messages WHERE wallet=? AND chain=? ORDER BY id DESC LIMIT 40)",
      )
      .run(wallet.toLowerCase(), chain, wallet.toLowerCase(), chain);
  }
}
const scope = globalThis as typeof globalThis & { stewardStore?: Store };
export const store = () => (scope.stewardStore ??= new Store());
export const newId = randomUUID;
