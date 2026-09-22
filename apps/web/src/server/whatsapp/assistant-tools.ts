import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { isAddress, parseUnits } from "viem";
import { seal, unseal } from "./config";
import { text, actionFor } from "./menu";
import { balanceReply } from "./balance";
import { paymentReply } from "./payments";
import { reviewPayment } from "./payment-runner";
import { contactsReply, contactByName, contactList } from "./contacts";
import { readyAccount, walletAddress } from "./wallet-setup";

type Task = {
  kind: "payment" | "contact";
  recipient?: string;
  amount?: string;
  name?: string;
  address?: string;
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const field = z.string().trim().min(1).max(100);
const amountField = z.string().regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/);
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, required, additionalProperties: false },
  },
});
export const assistantTools = [
  tool("get_balance", "Read actual Demo USD and test ETH balances."),
  tool(
    "get_recent_payments",
    "Read latest payment statuses and receipts; use for whether a payment went through.",
  ),
  tool("get_receive_address", "Show the user's own receiving address and testnet."),
  tool("get_account", "Show account wallet readiness."),
  tool("list_contacts", "Display the user's saved contacts locally."),
  tool("find_contact", "Look up a saved contact locally by name.", { name: { type: "string" } }, [
    "name",
  ]),
  tool(
    "check_affordability",
    "Check a Demo USD amount against balance and a conservative fee reserve; never prepares or sends a payment.",
    { amount: { type: "string" } },
    ["amount"],
  ),
  tool(
    "prepare_payment",
    "Collect a payment recipient and amount; omit missing fields. Reuse the current payment task. Always requires separate Confirm payment; never sends.",
    { recipient: { type: "string" }, amount: { type: "string" } },
  ),
  tool(
    "prepare_contact",
    "Collect a contact name and wallet address. Omit missing fields. Prepares Save contact confirmation; never saves directly.",
    { name: { type: "string" }, address: { type: "string" } },
  ),
  tool(
    "delete_contact",
    "Prepare a delete confirmation for an explicitly requested saved contact.",
    { name: { type: "string" } },
    ["name"],
  ),
  tool(
    "cancel_task",
    "Discard an unfinished draft or unconfirmed review. Never cancels a submitted transaction.",
  ),
];
export function currentTask(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  consent: string,
): Task | null {
  const row = db
    .prepare(
      "SELECT payload FROM wa_assistant_tasks WHERE account_id=? AND consent_hash=? AND expires>?",
    )
    .get(account, consent, Date.now()) as { payload: string } | undefined;
  return row ? unseal<Task>(row.payload, key) : null;
}
export async function runAssistantTool(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  phone: string,
  messageId: string,
  consent: string,
  input: string,
  evidence: string,
  name: string,
  args: unknown,
) {
  const task = currentTask(db, key, account, consent);
  const clear = () => db.prepare("DELETE FROM wa_assistant_tasks WHERE account_id=?").run(account);
  const save = (t: Task) =>
    db
      .prepare(
        "INSERT INTO wa_assistant_tasks(account_id,consent_hash,payload,expires) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET consent_hash=excluded.consent_hash,payload=excluded.payload,expires=excluded.expires",
      )
      .run(account, consent, seal(t, key), Date.now() + 600000);
  const literal = (s: string) =>
    new RegExp(
      "(?<![\\p{L}\\p{N}])" + escape(s.normalize("NFKC")) + "(?![\\p{L}\\p{N}])",
      "iu",
    ).test(evidence.normalize("NFKC"));
  const amountLiteral = (s: string) =>
    new RegExp("(?<![\\p{L}\\p{N}.])" + escape(s) + "(?![\\d.])", "iu").test(
      evidence.replace(/0x[a-f0-9]{40}/gi, ""),
    );
  const pay = (value: string) =>
    paymentReply(db, key, { from: phone, id: messageId, input: value });
  if (
    [
      "get_balance",
      "get_recent_payments",
      "get_receive_address",
      "get_account",
      "list_contacts",
      "cancel_task",
    ].includes(name)
  ) {
    z.object({}).strict().parse(args);
    if (name === "get_balance") return balanceReply(db, key, phone);
    if (name === "get_recent_payments")
      return pay("Recent activity") ?? text("Create your wallet first to see payment activity.");
    if (name === "get_receive_address" || name === "get_account") {
      const wallet = walletAddress(db, account);
      return wallet
        ? readyAccount(wallet.address)
        : text(
            "Your account is created, but the wallet is not ready. Choose My account from Menu to finish wallet setup.",
          );
    }
    if (name === "list_contacts") return contactList(db, key, account, "manage");
    clear();
    db.prepare("DELETE FROM wa_contact_sessions WHERE account_id=?").run(account);
    db.prepare("DELETE FROM wa_payment_language_entries WHERE account_id=?").run(account);
    return pay("Cancel") ?? text("Draft cancelled. Nothing was sent.");
  }
  if (name === "find_contact" || name === "delete_contact") {
    const a = z.object({ name: field }).strict().parse(args);
    if (!literal(a.name)) return text("What is the saved contact’s name?");
    const c = contactByName(db, key, account, a.name);
    if (!c)
      return text("I couldn’t find that saved contact. Check the name or open Manage contacts.");
    if (name === "find_contact") return text(`${c.name}\n${c.address}\nRobinhood Chain testnet`);
    if (!/\b(?:delete|remove|forget)\b/i.test(input))
      return text("To remove a contact, tell me which saved contact you want to delete.");
    clear();
    return contactsReply(db, key, account, "contact:delete:" + c.id)!;
  }
  if (name === "check_affordability") {
    const a = z.object({ amount: amountField }).strict().parse(args);
    if (!amountLiteral(a.amount) || parseUnits(a.amount, 6) <= 0n)
      return text("What Demo USD amount would you like me to check?");
    return balanceReply(db, key, phone, a.amount);
  }
  if (name === "prepare_contact") {
    const a = z.object({ name: field.optional(), address: field.optional() }).strict().parse(args);
    if (task?.kind !== "contact" && !/\b(?:save|add|store|remember|contact)\b/i.test(input))
      return text("Tell me the contact name and address you want to save.");
    if (
      (a.name && !literal(a.name)) ||
      (a.address && (!literal(a.address) || !isAddress(a.address)))
    )
      return text("Please provide the contact name and a valid full 0x wallet address.");
    const draft: Task = { ...(task?.kind === "contact" ? task : {}), kind: "contact", ...a };
    save(draft);
    if (!draft.name) return text("What name should I save this contact under?");
    if (!draft.address)
      return text(`What is ${draft.name}’s full 0x wallet address on Robinhood testnet?`);
    if (
      draft.name.length > 24 ||
      !/[\p{L}]/u.test(draft.name) ||
      !/^[\p{L}\p{N} .'-]+$/u.test(draft.name) ||
      actionFor(draft.name) ||
      /^(?:menu|cancel|send|help|settings|activity)$/i.test(draft.name)
    )
      return text(
        "Use a contact name up to 24 characters with letters, numbers, spaces, dots, apostrophes or hyphens.",
      );
    if (contactByName(db, key, account, draft.name))
      return text("That name is already saved. Use another name or edit it in Manage contacts.");
    const count = db
      .prepare("SELECT count(*) n FROM wa_contacts WHERE account_id=?")
      .get(account) as { n: number };
    if (count.n >= 100)
      return text("You have reached 100 contacts. Remove one before adding another.");
    // Existing contact tool validates the address and generates the confirmation.
    db.exec("SAVEPOINT assistant_contact");
    try {
      db.prepare("DELETE FROM wa_contact_sessions WHERE account_id=?").run(account);
      let result = contactsReply(db, key, account, "contact:add");
      const stage = () => {
        const r = db
          .prepare("SELECT payload FROM wa_contact_sessions WHERE account_id=?")
          .get(account) as { payload: string } | undefined;
        return r ? unseal<{ stage: string }>(r.payload, key).stage : null;
      };
      if (stage() === "name") result = contactsReply(db, key, account, draft.name);
      if (stage() === "address") result = contactsReply(db, key, account, draft.address);
      if (stage() === "review") clear();
      db.exec("RELEASE assistant_contact");
      return result ?? text("Use Manage contacts to continue.");
    } catch (e) {
      db.exec("ROLLBACK TO assistant_contact");
      db.exec("RELEASE assistant_contact");
      throw e;
    }
  }
  if (name !== "prepare_payment") throw Error("unsupported_tool");
  const a = z
    .object({ recipient: field.optional(), amount: amountField.optional() })
    .strict()
    .parse(args);
  if (task?.kind !== "payment" && !/\b(?:send|pay|transfer|give)\b/i.test(input))
    return text(
      "Tell me who you want to pay and how much. A payment always needs the Confirm payment button.",
    );
  if (/(?<![a-z])(?:usdc|usdt|usdg|eth|btc|eur|gbp|ngn|naira|mainnet)(?![a-z])/i.test(input))
    return text("Only Demo USD on Robinhood testnet is supported. Nothing was prepared.");
  if ((a.recipient && !literal(a.recipient)) || (a.amount && !amountLiteral(a.amount)))
    return text(
      "Please specify the recipient and numeric amount so I can prepare the exact payment.",
    );
  const draft: Task = { ...(task?.kind === "payment" ? task : {}), kind: "payment", ...a };
  save(draft);
  if (!draft.recipient)
    return text(
      "Who should receive the Demo USD? Give a saved name, full international phone number or full 0x address.",
    );
  if (!draft.amount) return text(`How much Demo USD would you like to send to ${draft.recipient}?`);
  if (
    actionFor(draft.recipient) ||
    /^(?:menu|cancel|send|help|settings|activity)$/i.test(draft.recipient) ||
    draft.recipient.includes(":")
  )
    return text("Please give the recipient’s full 0x address.");
  let result: ReturnType<typeof paymentReply>;
  db.exec("BEGIN IMMEDIATE");
  try {
    const active = db
      .prepare(
        "SELECT id FROM wa_payments WHERE account_id=? AND state IN ('quoting','review','queued','preflight','submitting','unknown','broadcast') AND (expires>? OR state NOT IN ('quoting','review'))",
      )
      .get(account, Date.now());
    if (active) {
      db.exec("ROLLBACK");
      return text(
        "A payment is already in progress. Use its confirmation buttons or ask for its status.",
      );
    }
    db.prepare("DELETE FROM wa_payment_sessions WHERE account_id=?").run(account);
    result = pay("Send payment");
    const stage = () =>
      (
        db.prepare("SELECT stage FROM wa_payment_sessions WHERE account_id=?").get(account) as
          | { stage: string }
          | undefined
      )?.stage;
    if (stage() === "address") result = pay(draft.recipient);
    if (stage() === "amount") result = pay(draft.amount);
    if (result && "payment_id" in result && typeof result.payment_id === "string") {
      db.prepare(
        "UPDATE wa_assistant_requests SET payment_id=? WHERE message_id=? AND account_id=?",
      ).run(result.payment_id, messageId, account);
      clear();
    }
    db.prepare("DELETE FROM wa_payment_sessions WHERE account_id=?").run(account);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (result && "payment_id" in result && typeof result.payment_id === "string")
    return reviewPayment(db, key, phone, result.payment_id);
  return result ?? text("I couldn’t prepare that payment. Nothing was sent.");
}
