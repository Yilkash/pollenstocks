import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { decodeFunctionData, erc20Abi, formatEther, formatUnits } from "viem";
import { seal, unseal } from "../whatsapp/config";
import { text } from "../whatsapp/menu";
import { STOCKS, USDG, type StockSymbol } from "./market";
import { stockAdapterAbi, type StockTradePlan } from "./trade-plan";

// Deliberate code gate: an environment variable alone cannot enable incomplete signing.
export const STOCK_EXECUTION_READY = false;
export const STOCK_DISCLOSURE_VERSION = "steward-test-stock-v1";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type StockOrderState =
  | "review"
  | "queued"
  | "submitting"
  | "unknown"
  | "broadcast"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "failed";
export type StockReview = {
  symbol: StockSymbol;
  side: "buy" | "sell";
  plan: StockTradePlan;
  providerId: string;
  externalId: string;
  appId: string;
  ownerId: string;
  policyId: string;
  // Each authorized transaction has its own fee ceiling. No fee-free approval claim.
  fees: { gas: string; gasPrice: string }[];
};
export type StockOrder = {
  id: string;
  account_id: string;
  source_message: string;
  payload: string;
  state: StockOrderState;
  created: number;
  expires: number;
  confirmation_hash: string | null;
  confirmed_at: number | null;
};
export function migrateStockOrders(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS wa_stock_orders (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, source_message TEXT NOT NULL,
    payload TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('review','queued','submitting','unknown','broadcast','confirmed','cancelled','expired','failed')),
    created INTEGER NOT NULL, expires INTEGER NOT NULL, confirmation_hash TEXT, confirmed_at INTEGER,
    confirmation_message TEXT, disclosure_version TEXT, error TEXT,
    UNIQUE(account_id,source_message)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS wa_stock_one_active ON wa_stock_orders(account_id)
    WHERE state IN ('review','queued','submitting','unknown','broadcast');
  CREATE TABLE IF NOT EXISTS wa_stock_steps (
    order_id TEXT NOT NULL REFERENCES wa_stock_orders(id), position INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','submitting','unknown','broadcast','confirmed','failed')),
    reference_id TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL UNIQUE,
    nonce INTEGER, tx_hash TEXT, error TEXT, PRIMARY KEY(order_id,position)
  );`);
}
export function stockOrder(db: DatabaseSync, account: string, id: string) {
  return db
    .prepare("SELECT * FROM wa_stock_orders WHERE id=? AND account_id=?")
    .get(id, account) as StockOrder | undefined;
}
function activeWalletMatches(db: DatabaseSync, account: string, review: StockReview) {
  const row = db
    .prepare(
      `SELECT a.status,w.address,w.chain,w.provider_id,w.external_id,w.app_id,w.owner_id,w.policy_id
    FROM wa_accounts a JOIN wa_managed_wallets w ON w.account_id=a.id WHERE a.id=?`,
    )
    .get(account) as
    | {
        status: string;
        address: string;
        chain: number;
        provider_id: string;
        external_id: string;
        app_id: string;
        owner_id: string;
        policy_id: string;
      }
    | undefined;
  return (
    row?.status === "active" &&
    row.chain === 46630 &&
    row.address.toLowerCase() === review.plan.wallet.toLowerCase() &&
    row.provider_id === review.providerId &&
    row.external_id === review.externalId &&
    row.app_id === review.appId &&
    row.owner_id === review.ownerId &&
    row.policy_id === review.policyId
  );
}
function validateReviewPlan(review: StockReview) {
  const p = review.plan;
  const stock = STOCKS[review.symbol]?.address;
  const buy = review.side === "buy";
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (
    !stock ||
    !["buy", "sell"].includes(review.side) ||
    p.chainId !== 46630 ||
    p.slippageBps !== 100 ||
    !same(p.inputToken, buy ? USDG : stock) ||
    !same(p.outputToken, buy ? stock : USDG) ||
    !/^[1-9]\d{0,29}$/.test(p.amountIn) ||
    !/^[1-9]\d{0,59}$/.test(p.expectedOutput) ||
    !/^[1-9]\d{0,59}$/.test(p.minimumOutput) ||
    BigInt(p.amountIn) > (buy ? 1000_000000n : 1000n * 10n ** 18n) ||
    BigInt(p.minimumOutput) !== (BigInt(p.expectedOutput) * 99n) / 100n ||
    ![2, 3].includes(p.steps.length)
  )
    throw Error("invalid_stock_plan");
  const kinds =
    p.steps.length === 3 ? ["reset_allowance", "approve", "trade"] : ["approve", "trade"];
  for (const [i, step] of p.steps.entries()) {
    if (step.kind !== kinds[i] || step.value !== "0x0") throw Error("invalid_stock_step");
    if (step.kind !== "trade") {
      const call = decodeFunctionData({ abi: erc20Abi, data: step.data });
      if (
        !same(step.to, p.inputToken) ||
        call.functionName !== "approve" ||
        !same(call.args[0], p.adapter) ||
        call.args[1] !== (step.kind === "approve" ? BigInt(p.amountIn) : 0n)
      )
        throw Error("invalid_stock_approval");
    } else {
      const call = decodeFunctionData({ abi: stockAdapterAbi, data: step.data });
      if (
        !same(step.to, p.adapter) ||
        call.functionName !== "trade" ||
        call.args[0] !== p.orderId ||
        !same(call.args[1], stock) ||
        call.args[2] !== buy ||
        call.args[3] !== BigInt(p.amountIn) ||
        call.args[4] !== BigInt(p.minimumOutput) ||
        call.args[5] !== BigInt(p.deadline)
      )
        throw Error("invalid_stock_trade");
    }
  }
}
function feeCap(review: StockReview) {
  if (review.fees.length !== review.plan.steps.length) throw Error("stock_fee_plan_mismatch");
  return review.fees.reduce((total, fee) => {
    if (!/^[1-9]\d{0,17}$/.test(fee.gas) || !/^[1-9]\d{0,17}$/.test(fee.gasPrice))
      throw Error("invalid_stock_fee");
    return total + BigInt(fee.gas) * BigInt(fee.gasPrice);
  }, 0n);
}
function reviewBody(review: StockReview) {
  const p = review.plan,
    buy = review.side === "buy";
  return `Review testnet ${review.side} — ${review.symbol}\n\nSpend: ${formatUnits(BigInt(p.amountIn), buy ? 6 : 18)} ${buy ? "USDG" : review.symbol}\nExpected: ${formatUnits(BigInt(p.expectedOutput), buy ? 18 : 6)} ${buy ? review.symbol : "USDG"}\nMinimum received: ${formatUnits(BigInt(p.minimumOutput), buy ? 18 : 6)} ${buy ? review.symbol : "USDG"}\nSlippage: 1%\nMaximum total network fees: ${formatEther(feeCap(review))} test ETH\nTransactions: ${p.steps.length} (includes token approval)\nExpires: ${new Date(p.deadline * 1000).toISOString()}\n\nRobinhood Chain testnet. Pool prices are not real stock prices.\nConfirm authorizes these exact approvals and this trade from your Steward wallet. If the trade fails, network fees and token approval may remain. Test tokens have no monetary value.`;
}
// Only call after adapter/code, wallet, balances, fee caps and every calldata step
// have been checked by the eventual execution preflight. Not exposed to AI tools.
export function createStockReview(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  messageId: string,
  review: StockReview,
) {
  if (!STOCK_EXECUTION_READY)
    return text(
      "Stock trading is not enabled yet. You can request a quote or view your portfolio. Nothing was submitted.",
    );
  validateReviewPlan(review);
  const body = reviewBody(review);
  const now = Date.now();
  if (
    !activeWalletMatches(db, account, review) ||
    review.plan.chainId !== 46630 ||
    review.plan.deadline * 1000 <= now + 30000 ||
    review.plan.deadline * 1000 > now + 300000 ||
    feeCap(review) > 100000000000000n
  )
    throw Error("invalid_stock_review");
  db.exec("SAVEPOINT stock_review");
  try {
    db.prepare(
      "UPDATE wa_stock_orders SET state='expired',confirmation_hash=NULL WHERE account_id=? AND state='review' AND expires<=?",
    ).run(account, now);
    const previous = db
      .prepare("SELECT id FROM wa_stock_orders WHERE account_id=? AND source_message=?")
      .get(account, messageId) as { id: string } | undefined;
    if (previous) {
      db.exec("RELEASE stock_review");
      return text("This stock review already exists. Request its status before starting another.");
    }
    const active = db
      .prepare(
        "SELECT id FROM wa_stock_orders WHERE account_id=? AND state IN ('review','queued','submitting','unknown','broadcast')",
      )
      .get(account);
    const payment = db
      .prepare(
        "SELECT id FROM wa_payments WHERE account_id=? AND state IN ('quoting','review','queued','preflight','submitting','unknown','broadcast')",
      )
      .get(account);
    if (active || payment) {
      db.exec("RELEASE stock_review");
      return text(
        "Finish or cancel your existing review or transaction before starting a stock trade.",
      );
    }
    const id = randomUUID(),
      token = randomBytes(24).toString("hex");
    db.prepare(
      "INSERT INTO wa_stock_orders(id,account_id,source_message,payload,state,created,expires,confirmation_hash) VALUES(?,?,?,?,'review',?,?,?)",
    ).run(id, account, messageId, seal(review, key), now, review.plan.deadline * 1000, hash(token));
    for (let position = 0; position < review.plan.steps.length; position++) {
      db.prepare(
        "INSERT INTO wa_stock_steps(order_id,position,state,reference_id,idempotency_key) VALUES(?,?,'pending',?,?)",
      ).run(id, position, `stock:${id}:${position}`, randomUUID());
    }
    db.exec("RELEASE stock_review");
    return {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: `stock:confirm:${id}:${token}`, title: "Confirm trade" },
            },
            { type: "reply", reply: { id: `stock:cancel:${id}:${token}`, title: "Cancel trade" } },
          ],
        },
      },
    };
  } catch (error) {
    db.exec("ROLLBACK TO stock_review");
    db.exec("RELEASE stock_review");
    throw error;
  }
}
// Called from deterministic inbox routing, never from inference or a plain "yes".
// Inbox/outbox transaction makes consuming a confirmation and its reply atomic.
export function stockConfirmationReply(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  input: string,
  messageId: string,
) {
  const match = /^stock:(confirm|cancel):([a-f0-9-]{36}):([a-f0-9]{48})$/.exec(input);
  const order = match ? stockOrder(db, account, match[2]) : undefined;
  if (
    !match ||
    !order ||
    !order.confirmation_hash ||
    !timingSafeEqual(Buffer.from(hash(match[3])), Buffer.from(order.confirmation_hash))
  )
    return text("This trade confirmation is invalid or already used. Nothing new was submitted.");
  if (order.state !== "review")
    return text("This trade review was already handled. Nothing new was submitted.");
  if (order.expires <= Date.now()) {
    db.prepare(
      "UPDATE wa_stock_orders SET state='expired',confirmation_hash=NULL WHERE id=? AND state='review'",
    ).run(order.id);
    return text("That trade quote expired. Request a fresh quote. Nothing was submitted.");
  }
  if (match[1] === "cancel") {
    db.prepare(
      "UPDATE wa_stock_orders SET state='cancelled',confirmation_hash=NULL WHERE id=? AND state='review'",
    ).run(order.id);
    return text("Trade review cancelled. No approval or trade was submitted.");
  }
  if (!STOCK_EXECUTION_READY)
    return text("Stock trading is not enabled yet. Nothing was submitted.");
  const review = unseal<StockReview>(order.payload, key);
  validateReviewPlan(review);
  if (!activeWalletMatches(db, account, review))
    return text("Your wallet setup changed. Request a new review. Nothing was submitted.");
  const busy = db
    .prepare(
      "SELECT id FROM wa_payments WHERE account_id=? AND state IN ('queued','preflight','submitting','unknown','broadcast')",
    )
    .get(account);
  if (busy)
    return text("Your wallet has another transaction in progress. Nothing new was submitted.");
  const changed = db
    .prepare(
      "UPDATE wa_stock_orders SET state='queued',confirmation_hash=NULL,confirmed_at=?,confirmation_message=?,disclosure_version=? WHERE id=? AND account_id=? AND state='review' AND expires>?",
    )
    .run(Date.now(), messageId, STOCK_DISCLOSURE_VERSION, order.id, account, Date.now());
  return text(
    changed.changes === 1
      ? "Trade confirmed. I’ll report the result after the network confirms it."
      : "This review changed or expired. Nothing new was submitted.",
  );
}
