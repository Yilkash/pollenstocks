import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  fairPriceCheck,
  mainnetReferencePrice,
  priceDeviationBps,
  toFixed18,
} from "../src/server/stocks/reference-price";

afterEach(() => mock.restoreAll());
const e18 = 10n ** 18n;
const usdc = (n: number) => BigInt(Math.round(n * 1e6));

// Robinhood quote for NVDA on 2026-10-04 (rhj/prices/NVDA).
const nvda = {
  quotes: [
    {
      tokenSymbol: "NVDA",
      bid: "231.71",
      ask: "234.23",
      tokenBid: "231.889612130036555167",
      tokenAsk: "234.411565531131424267",
      currency: "USD",
      isTradingHalt: false,
      generatedAt: new Date().toISOString(),
    },
  ],
};

test("deviation compares USDC (6 decimals) with 18-decimal stock amounts", () => {
  const market = { bid: 100n * e18, ask: 100n * e18 };
  assert.equal(priceDeviationBps("buy", usdc(100), e18, market), 0n);
  assert.equal(priceDeviationBps("buy", usdc(102), e18, market), 200n);
  assert.equal(priceDeviationBps("sell", e18, usdc(97), market), 300n);
  assert.equal(priceDeviationBps("sell", e18, usdc(101), market), 0n);
});

test("the live Arc quotes of 4 October pass; a short sell from a thin pool is refused", async () => {
  mock.method(globalThis, "fetch", async () => Response.json(nvda));
  // 5 USDC bought ~0.021612 NVDA on Arc (~$231.35 each): within the ask.
  await fairPriceCheck("NVDA", "buy", usdc(5), 21_612_000_000_000_000n);
  // Selling 0.01 NVDA for 2.2855 USDC (~$228.55): 1.4% under the bid, allowed.
  await fairPriceCheck("NVDA", "sell", e18 / 100n, usdc(2.2855));
  // A thin pool paying ~$215 is refused.
  await assert.rejects(fairPriceCheck("NVDA", "sell", e18 / 100n, usdc(2.15)), /no_fair_price/);
});

test("a very wide off-hours ask does not wave an overpriced buy through", () => {
  // AMC on 4 October: bid $2.72, ask $11.80. Paying $3.50 must be refused.
  const market = { bid: toFixed18("2.72"), ask: toFixed18("11.80") };
  assert.ok(priceDeviationBps("buy", usdc(3.5), e18, market) > 200n);
  // The live Arc price of ~$2.82 (3.7% over the bid) is accepted.
  assert.equal(priceDeviationBps("buy", usdc(2.82), e18, market), 0n);
});

test("halted stocks and unreachable prices refuse to trade", async () => {
  mock.method(console, "warn", () => undefined);
  mock.method(globalThis, "fetch", async () =>
    Response.json({ quotes: [{ ...nvda.quotes[0], tokenSymbol: "GME", isTradingHalt: true }] }),
  );
  await assert.rejects(fairPriceCheck("GME", "buy", usdc(5), e18), /stock_not_trading/);
  mock.restoreAll();
  mock.method(console, "warn", () => undefined);
  mock.method(globalThis, "fetch", async () => new Response(null, { status: 500 }));
  await assert.rejects(fairPriceCheck("AMC", "buy", usdc(5), e18), /reference_unavailable/);
});

test("a quote for a different symbol is rejected", async () => {
  mock.method(console, "warn", () => undefined);
  mock.method(globalThis, "fetch", async () => Response.json(nvda));
  await assert.rejects(mainnetReferencePrice("CRCL", true), /asset_changed/);
  assert.equal(toFixed18("231.71"), 231_710000000000000000n);
});
