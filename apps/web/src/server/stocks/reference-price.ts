import { z } from "zod";
import { MAINNET_QUOTE, type MainnetStock } from "../networks/chain";

// Reference prices for Arc stock tokens. The issuer backs each Arc token 1:1 with the
// Robinhood Chain stock token of the same symbol, so Robinhood's public token bid/ask is
// the fair market for both. Docs: docs.robinhood.com/chain/stock-token-apis/
const API = "https://api.robinhood.com/rhj/prices/";
const CACHE_MS = 15_000;
const FALLBACK_MS = 5 * 60_000;
/** A route more than this many basis points worse than the market is refused. */
export const MAX_DEVIATION_BPS = 200n;

const decimal = z.string().regex(/^(?:0|[1-9]\d{0,19})(?:\.\d{1,30})?$/);
const quoteSchema = z.object({
  quotes: z
    .array(
      z.object({
        tokenSymbol: z.string(),
        bid: decimal,
        ask: decimal,
        tokenBid: decimal.optional(),
        tokenAsk: decimal.optional(),
        currency: z.literal("USD"),
        isTradingHalt: z.boolean(),
        generatedAt: z.string(),
      }),
    )
    .min(1),
});

export class ReferencePriceError extends Error {
  constructor(
    public readonly code:
      | "source_unavailable"
      | "provider_busy"
      | "invalid_data"
      | "asset_changed"
      | "oracle_paused"
      | "trading_halted"
      | "observation_too_old",
  ) {
    super(code);
  }
}
const codeOf = (error: unknown) =>
  error instanceof ReferencePriceError ? error.code : "source_unavailable";

export type ReferencePrice = {
  symbol: MainnetStock;
  /** Mid price, 18-decimal fixed point. */
  value: bigint;
  bid: bigint;
  ask: bigint;
  decimals: number;
  currency: "USD";
  source: "Robinhood";
  marketOpen: boolean;
  asOf: number;
  readAt: number;
  heartbeatMs: number;
  cachedFallback: boolean;
};

/** Parse a decimal string to an 18-decimal integer, truncating extra precision. */
export function toFixed18(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.slice(0, 18).padEnd(18, "0"));
}

const prices = new Map<MainnetStock, ReferencePrice>();
const pending = new Map<MainnetStock, Promise<ReferencePrice>>();

async function readPrice(symbol: MainnetStock): Promise<ReferencePrice> {
  let response: Response;
  try {
    response = await fetch(API + encodeURIComponent(symbol), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ReferencePriceError("source_unavailable");
  }
  if (response.status === 429 || response.status === 503)
    throw new ReferencePriceError("provider_busy");
  if (!response.ok) throw new ReferencePriceError("source_unavailable");
  const parsed = quoteSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ReferencePriceError("invalid_data");
  const q = parsed.data.quotes[0];
  if (q.tokenSymbol !== symbol) throw new ReferencePriceError("asset_changed");
  // Token prices include any corporate-action multiplier; fall back to share prices.
  const bid = toFixed18(q.tokenBid ?? q.bid),
    ask = toFixed18(q.tokenAsk ?? q.ask);
  const asOf = Date.parse(q.generatedAt);
  if (bid <= 0n || ask < bid || !Number.isFinite(asOf))
    throw new ReferencePriceError("invalid_data");
  return {
    symbol,
    value: (bid + ask) / 2n,
    bid,
    ask,
    decimals: 18,
    currency: "USD",
    source: "Robinhood",
    marketOpen: !q.isTradingHalt,
    asOf,
    readAt: Date.now(),
    heartbeatMs: 10 * 60_000,
    cachedFallback: false,
  };
}

async function refresh(symbol: MainnetStock): Promise<ReferencePrice> {
  try {
    const result = await readPrice(symbol);
    prices.set(symbol, result);
    return result;
  } catch (error) {
    const saved = prices.get(symbol);
    console.warn("Stock reference refresh failed", { symbol, code: codeOf(error) });
    if (
      ["source_unavailable", "provider_busy"].includes(codeOf(error)) &&
      saved &&
      Date.now() - saved.readAt <= FALLBACK_MS
    )
      return { ...saved, cachedFallback: true };
    prices.delete(symbol);
    throw error instanceof ReferencePriceError ? error : new ReferencePriceError(codeOf(error));
  }
}

export async function mainnetReferencePrice(symbol: MainnetStock, forceRefresh = false) {
  const saved = prices.get(symbol);
  if (!forceRefresh && saved && Date.now() - saved.readAt < CACHE_MS) return saved;
  let work = pending.get(symbol);
  if (!work) {
    work = refresh(symbol).finally(() => {
      pending.delete(symbol);
    });
    pending.set(symbol, work);
  }
  return work;
}

/**
 * How much worse the route's effective price is than the market, in basis points, measured
 * against the user: a buy paying more than the ask, or a sell receiving less than the bid.
 * Amounts: USDC (6 decimals) and stock tokens (18 decimals); prices are 18-decimal.
 */
export function priceDeviationBps(
  side: "buy" | "sell",
  amountIn: bigint,
  amountOut: bigint,
  market: { bid: bigint; ask: bigint },
) {
  const toUsd18 = 10n ** BigInt(18 - MAINNET_QUOTE.decimals);
  const scale = 10n ** 18n;
  if (amountIn <= 0n || amountOut <= 0n) return 10_000n;
  if (side === "buy") {
    // Off-hours quotes can show a very wide ask (AMC: bid $2.72, ask $11.80 on a weekend),
    // which would wave any price through. Never judge a buy against more than bid + 5%.
    const capped = (market.bid * 105n) / 100n;
    const ask = market.ask < capped ? market.ask : capped;
    const paid = (amountIn * toUsd18 * scale) / amountOut;
    const worse = paid - ask;
    return worse <= 0n ? 0n : (worse * 10_000n + ask - 1n) / ask;
  }
  const received = (amountOut * toUsd18 * scale) / amountIn;
  const worse = market.bid - received;
  return worse <= 0n ? 0n : (worse * 10_000n + market.bid - 1n) / market.bid;
}

/** Refuse routes far from the real market, and trades while the stock is halted. */
export async function fairPriceCheck(
  symbol: MainnetStock,
  side: "buy" | "sell",
  amountIn: bigint,
  expectedOut: bigint,
) {
  let market: ReferencePrice;
  try {
    market = await mainnetReferencePrice(symbol, true);
  } catch {
    throw Error("reference_unavailable");
  }
  if (market.cachedFallback) throw Error("reference_unavailable");
  if (!market.marketOpen) throw Error("stock_not_trading");
  if (priceDeviationBps(side, amountIn, expectedOut, market) > MAX_DEVIATION_BPS)
    throw Error("no_fair_price");
}

/** Integer rounding for display; never use floating point to scale a price. */
export function referenceDollars(value: bigint, decimals: number) {
  const scale = 10n ** BigInt(decimals);
  const cents = (value * 100n + scale / 2n) / scale;
  if (value > 0n && cents === 0n) return "< $0.01";
  return `$${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
