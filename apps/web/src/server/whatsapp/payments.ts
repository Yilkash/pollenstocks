import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAddress, zeroAddress, formatUnits, parseUnits } from "viem";
import { seal, senderLookup } from "./config";
import { actionFor, text } from "./menu";

export const PAYMENT_TOKEN = "0x13800afeea6f8688547770052b395099758d9a5b";
export const PER_PAYMENT = 1000_000000n,
  PER_DAY = 5000_000000n;
export const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export type Payment = {
  id: string;
  account_id: string;
  sender: string;
  destination: string;
  amount: string;
  wallet: string;
  provider_id: string;
  external_id: string;
  owner_id: string;
  policy_id: string;
  app_id: string;
  state: string;
  created: number;
  expires: number;
  confirmed_at: number | null;
  gas: string | null;
  gas_price: string | null;
  nonce: number | null;
  confirmation_hash: string | null;
  recipient: string;
  reply_until: number;
  idempotency_key: string;
  reference_id: string;
  tx_hash: string | null;
  lease: string | null;
  lease_until: number | null;
  next_check: number;
};
export function migratePayments(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS wa_payment_sessions(account_id TEXT PRIMARY KEY,stage TEXT NOT NULL,destination TEXT,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS wa_payments(
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL,sender TEXT NOT NULL,destination TEXT NOT NULL,amount TEXT NOT NULL,
 wallet TEXT NOT NULL,provider_id TEXT NOT NULL,external_id TEXT NOT NULL,owner_id TEXT NOT NULL,policy_id TEXT NOT NULL,app_id TEXT NOT NULL,
 state TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,confirmed_at INTEGER,
 gas TEXT,gas_price TEXT,nonce INTEGER,confirmation_hash TEXT,recipient TEXT NOT NULL,reply_until INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE,reference_id TEXT NOT NULL UNIQUE,tx_hash TEXT,
 lease TEXT,lease_until INTEGER,next_check INTEGER NOT NULL DEFAULT 0,error TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS wa_payment_one_active ON wa_payments(account_id)
 WHERE state IN ('quoting','review','queued','preflight','submitting','unknown','broadcast');`);
}
export function paymentById(db: DatabaseSync, id: string) {
  return db.prepare("SELECT * FROM wa_payments WHERE id=?").get(id) as Payment | undefined;
}
export function confirmationToken() {
  return randomBytes(24).toString("hex");
}
// Synchronous routing; called within the durable inbox transaction.
export function paymentReply(
  db: DatabaseSync,
  key: Buffer,
  message: { from: string; input: string; id: string; timestamp?: number },
) {
  const command = message.input.trim(),
    lower = command.toLowerCase().replace(/^\//, "");
  let action = actionFor(lower);
  const sender = senderLookup(message.from, key);
  const wallet = db
    .prepare(
      `SELECT a.id,a.status,w.* FROM wa_accounts a LEFT JOIN wa_managed_wallets w ON w.account_id=a.id WHERE a.sender=?`,
    )
    .get(sender) as
    | {
        id: string;
        status: string;
        address?: string;
        provider_id: string;
        external_id: string;
        owner_id: string;
        policy_id: string;
        app_id: string;
        chain: number;
      }
    | undefined;
  if (!wallet?.address || wallet.status !== "active") return null;
  const session = db
    .prepare("SELECT stage,destination,expires FROM wa_payment_sessions WHERE account_id=?")
    .get(wallet.id) as { stage: string; destination: string | null; expires: number } | undefined;
  // During amount entry, numbers are amounts rather than numbered menu commands.
  if (session && /^\d+(?:\.\d+)?$/.test(command)) action = undefined;
  const now = Date.now();
  db.prepare(
    "UPDATE wa_payments SET state='expired' WHERE account_id=? AND state IN ('quoting','review') AND expires<=?",
  ).run(wallet.id, now);
  const active = db
    .prepare(
      "SELECT * FROM wa_payments WHERE account_id=? AND state IN ('quoting','review','queued','preflight','submitting','unknown','broadcast')",
    )
    .get(wallet.id) as Payment | undefined;
  if (command.startsWith("pay:")) {
    const match = /^pay:(confirm|cancel):([a-f0-9-]{36}):([a-f0-9]{48})$/.exec(command);
    const p = match ? paymentById(db, match[2]) : undefined;
    if (
      !match ||
      !p ||
      p.sender !== sender ||
      p.account_id !== wallet.id ||
      p.confirmation_hash !== digest(match[3])
    )
      return text("This payment confirmation is invalid. Choose Send payment to start again.");
    if (p.state !== "review" || p.expires <= now)
      return text(
        p.state === "confirmed"
          ? "This payment is already complete. Choose Recent activity for its receipt."
          : "This confirmation has expired or was already used. Choose Recent activity to check the payment.",
      );
    if (match[1] === "cancel") {
      db.prepare("UPDATE wa_payments SET state='cancelled' WHERE id=? AND state='review'").run(
        p.id,
      );
      return text("Payment cancelled. Nothing was sent.");
    }
    if (process.env.WHATSAPP_PAYMENTS_ENABLED !== "true")
      return text("Payment review is ready, but sending is not enabled yet. Nothing was sent.");
    const spending = db
      .prepare(
        "SELECT amount FROM wa_payments WHERE account_id=? AND (state IN ('queued','preflight','submitting','unknown','broadcast') OR (state='confirmed' AND confirmed_at>?))",
      )
      .all(wallet.id, now - 86400000) as { amount: string }[];
    if (
      BigInt(p.amount) > PER_PAYMENT ||
      spending.reduce((n, r) => n + BigInt(r.amount), 0n) + BigInt(p.amount) > PER_DAY
    )
      return text(
        "This would exceed your 5,000 Demo USD limit for a rolling 24 hours. Nothing was sent.",
      );
    db.prepare(
      "UPDATE wa_payments SET state='queued',confirmed_at=? WHERE id=? AND state='review'",
    ).run(now, p.id);
    return { _steward_type: "typing", message_id: message.id };
  }
  if (action === "history" || lower === "activity") {
    const rows = db
      .prepare(
        "SELECT id,amount,destination,state,tx_hash FROM wa_payments WHERE account_id=? ORDER BY created DESC LIMIT 5",
      )
      .all(wallet.id) as Payment[];
    return text(
      rows.length
        ? "Recent payments\n\n" +
            rows
              .map(
                (p) =>
                  `${formatUnits(BigInt(p.amount), 6)} Demo USD → ${p.destination}\n${p.state}${p.tx_hash ? "\nhttps://explorer.testnet.chain.robinhood.com/tx/" + p.tx_hash : ""}`,
              )
              .join("\n\n")
        : "No WhatsApp payments yet.",
    );
  }
  if (lower === "cancel" || lower === "menu") {
    db.prepare("DELETE FROM wa_payment_sessions WHERE account_id=?").run(wallet.id);
    if (active && ["quoting", "review"].includes(active.state))
      db.prepare("UPDATE wa_payments SET state='cancelled' WHERE id=?").run(active.id);
    if (lower === "cancel")
      return text(
        active && !["quoting", "review"].includes(active.state)
          ? "This payment was already confirmed and cannot be cancelled here. Choose Recent activity for its status."
          : "Payment entry cancelled. Nothing was sent.",
      );
    return null;
  }
  if (action === "send" || lower === "send") {
    if (active)
      return text(
        "You already have a payment awaiting review or confirmation from the network. Use its Confirm/Cancel buttons, or choose Recent activity for its status.",
      );
    db.prepare(
      "INSERT INTO wa_payment_sessions(account_id,stage,expires) VALUES(?,'address',?) ON CONFLICT(account_id) DO UPDATE SET stage='address',destination=NULL,expires=excluded.expires",
    ).run(wallet.id, now + 600000);
    return text(
      "Where should I send Demo USD?\n\nEnter the recipient’s 0x wallet address on Robinhood Chain testnet. Type Cancel to stop.",
    );
  }
  if (
    action ||
    ["my account", "account", "hi", "hello", "start", "help"].includes(lower) ||
    command.startsWith("walletsetup:") ||
    command.startsWith("enroll:")
  )
    return null;
  if (!session) return null;
  if (session.expires <= now) {
    db.prepare("DELETE FROM wa_payment_sessions WHERE account_id=?").run(wallet.id);
    return text("Payment entry expired. Choose Send payment to start again.");
  }
  if (session.stage === "address") {
    try {
      const address = getAddress(command);
      if (
        address === zeroAddress ||
        address.toLowerCase() === PAYMENT_TOKEN ||
        address.toLowerCase() === wallet.address.toLowerCase()
      )
        throw Error();
      db.prepare(
        "UPDATE wa_payment_sessions SET stage='amount',destination=?,expires=? WHERE account_id=?",
      ).run(address, now + 600000, wallet.id);
      return text(
        `Recipient:\n${address}\n\nHow much Demo USD? Enter an amount up to 1,000, with no more than 6 decimal places.`,
      );
    } catch {
      return text(
        "Enter a valid 0x wallet address. It must be different from your own address and the Demo USD contract.",
      );
    }
  }
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(command))
    return text(
      "Enter a positive amount up to 1,000 Demo USD, using at most 6 decimal places and no commas.",
    );
  const amount = parseUnits(command, 6);
  if (amount <= 0n || amount > PER_PAYMENT)
    return text("The amount must be greater than zero and no more than 1,000 Demo USD.");
  if (active) return text("A payment is already in progress. Choose Recent activity to check it.");
  const id = randomUUID();
  db.prepare(
    `INSERT INTO wa_payments(id,account_id,sender,destination,amount,wallet,provider_id,external_id,owner_id,policy_id,app_id,state,created,expires,recipient,reply_until,idempotency_key,reference_id)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,'quoting',?,?,?,?,?,?)`,
  ).run(
    id,
    wallet.id,
    sender,
    session.destination,
    amount.toString(),
    wallet.address,
    wallet.provider_id,
    wallet.external_id,
    wallet.owner_id,
    wallet.policy_id,
    wallet.app_id,
    now,
    now + 600000,
    seal({ to: message.from }, key),
    (message.timestamp || now) + 23 * 3600000,
    randomUUID(),
    "steward_pay_" + id,
  );
  db.prepare("DELETE FROM wa_payment_sessions WHERE account_id=?").run(wallet.id);
  return { _steward_type: "payment_review", payment_id: id };
}
