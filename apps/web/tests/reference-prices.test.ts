import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { encodeAbiParameters, parseAbiParameters, toFunctionSelector, toHex } from "viem";
import { MAINNET_ASSETS, type MainnetStock } from "../src/server/networks/robinhood";
import { mainnetReferencePrice, referenceDollars } from "../src/server/stocks/reference-price";
import { mainnetReferencePriceReply } from "../src/server/whatsapp/mainnet-stocks";
import { referencePriceFollowup } from "../src/server/whatsapp/assistant-tools";

// Entirely offline. Unknown URLs and all non-read RPC methods fail immediately.
const symbols = Object.keys(MAINNET_ASSETS) as MainnetStock[];
const feeds = {
  AAPL: "0x1111111111111111111111111111111111111111",
  NVDA: "0x2222222222222222222222222222222222222222",
  TSLA: "0x3333333333333333333333333333333333333333",
};
let now = Date.now();
let oracleDown: boolean, restDown: boolean, paused: Set<string>, reads: string[];
let answer: bigint, observationAge: number, invalidRound: boolean, directoryBusy: number;
let wrongChain: boolean, badAddress: boolean, halted: boolean, multiplierPending: boolean;
let quoteAge: number, restBid: string, restAsk: string, badDirectory: boolean;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const rpcResult = (value: unknown) => json(value);

beforeEach(() => {
  // Age out all process caches without a production-only reset hook.
  now += 5 * 24 * 60 * 60_000;
  oracleDown =
    restDown =
    invalidRound =
    wrongChain =
    badAddress =
    halted =
    multiplierPending =
    badDirectory =
      false;
  paused = new Set();
  reads = [];
  answer = 33_630_526_799n;
  observationAge = 30_000;
  quoteAge = 10_000;
  directoryBusy = 0;
  restBid = "100.00";
  restAsk = "102.00";
  mock.method(Date, "now", () => now);
  mock.method(console, "warn", () => undefined);
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = (input instanceof Request ? input.url : String(input)).replace(/\/$/, "");
    reads.push(url);
    if (url.includes("reference-data-directory.vercel.app")) {
      if (directoryBusy-- > 0) return json({}, 429);
      return json(
        symbols.map((symbol) => ({
          name: `Robinhood ${symbol} / USD`,
          proxyAddress: feeds[symbol],
          heartbeat: 86400,
          decimals: 8,
          docs: {
            baseAsset: symbol,
            quoteAsset: "USD",
            blockchainName: badDirectory ? "Base" : "Robinhood",
            productTypeCode: "primaryTokenizedPrice",
          },
        })),
      );
    }
    if (url === "https://api.robinhood.com/rhj/assets") {
      if (restDown) return json({}, 503);
      return json({
        assets: [
          { tokenSymbol: "UNRELATED", currentMultiplier: "" },
          ...symbols.map((symbol) => ({
            tokenSymbol: symbol,
            tokenDecimals: 18,
            status: "ASSET_STATUS_ACTIVE",
            deployments: [{ chainId: 4663, contractAddress: MAINNET_ASSETS[symbol].address }],
            currentMultiplier: "1.5",
            pendingMultiplier: multiplierPending ? "2" : "",
          })),
        ],
      });
    }
    if (url.startsWith("https://api.robinhood.com/rhj/prices/")) {
      if (restDown) return json({}, 503);
      const symbol = url.split("/").at(-1) as MainnetStock;
      return json({
        quotes: [
          {
            tokenSymbol: symbol,
            deployments: [
              {
                chainId: 4663,
                contractAddress: badAddress ? feeds.AAPL : MAINNET_ASSETS[symbol].address,
              },
            ],
            bid: restBid,
            ask: restAsk,
            currency: "USD",
            isTradingHalt: halted,
            generatedAt: new Date(now - quoteAge).toISOString(),
          },
        ],
      });
    }
    assert.equal(url, "https://rpc.mainnet.chain.robinhood.com");
    if (oracleDown) return json({}, 503);
    const request = JSON.parse(
      input instanceof Request ? await input.clone().text() : String(init?.body),
    );
    const respond = (r: {
      id: number;
      method: string;
      params: Array<{ to: string; data: string }>;
    }) => {
      let result: unknown;
      if (r.method === "eth_chainId") result = toHex(wrongChain ? 1 : 4663);
      else if (r.method === "eth_getBlockByNumber")
        result = {
          number: "0x100",
          timestamp: toHex(Math.floor(now / 1000)),
          transactions: [],
          hash: "0x" + "01".repeat(32),
          gasLimit: "0x100000",
          gasUsed: "0x100",
        };
      else {
        assert.equal(r.method, "eth_call", "no signing or transaction methods allowed");
        const call = r.params[0];
        if (call.data === toFunctionSelector("oraclePaused()")) {
          const symbol = symbols.find(
            (s) => MAINNET_ASSETS[s].address.toLowerCase() === call.to.toLowerCase(),
          );
          assert.ok(symbol);
          result = encodeAbiParameters(parseAbiParameters("bool"), [paused.has(symbol)]);
        } else if (call.data === toFunctionSelector("decimals()")) {
          result = encodeAbiParameters(parseAbiParameters("uint8"), [8]);
        } else {
          assert.equal(call.data, toFunctionSelector("latestRoundData()"));
          result = encodeAbiParameters(parseAbiParameters("uint80,int256,uint256,uint256,uint80"), [
            2n,
            answer,
            BigInt(Math.floor((now - observationAge) / 1000)),
            BigInt(Math.floor((now - observationAge) / 1000)),
            invalidRound ? 1n : 2n,
          ]);
        }
      }
      return { jsonrpc: "2.0", id: r.id, result };
    };
    return rpcResult(Array.isArray(request) ? request.map(respond) : respond(request));
  });
});
afterEach(() => mock.restoreAll());

const isCode = (code: string) => (error: unknown) =>
  error instanceof Error && "code" in error && error.code === code;

test("oracle reference uses USD and reuses a successful 15-second cache", async () => {
  const p = await mainnetReferencePrice("AAPL", true);
  assert.equal(p.source, "Chainlink");
  assert.equal(p.currency, "USD");
  assert.equal(referenceDollars(p.value, p.decimals), "$336.31");
  const count = reads.length;
  await mainnetReferencePrice("AAPL");
  assert.equal(reads.length, count);
  await mainnetReferencePrice("AAPL", true);
  assert.ok(reads.length > count);
  assert.ok(reads.every((url) => !url.includes("kyberswap")));
});
test("concurrent requests share one lookup", async () => {
  const [a, b] = await Promise.all([
    mainnetReferencePrice("AAPL", true),
    mainnetReferencePrice("AAPL", true),
  ]);
  assert.equal(a, b);
  assert.equal(reads.filter((url) => url.includes("reference-data-directory")).length, 1);
});
test("transient directory rate limit is retried", async () => {
  directoryBusy = 1;
  assert.equal((await mainnetReferencePrice("AAPL", true)).source, "Chainlink");
  assert.equal(reads.filter((url) => url.includes("reference-data-directory")).length, 2);
});
test("RPC outage falls back to official REST midpoint with multiplier applied once", async () => {
  oracleDown = true;
  const p = await mainnetReferencePrice("NVDA", true);
  assert.equal(p.source, "Robinhood");
  assert.equal(referenceDollars(p.value, p.decimals), "$151.50");
  assert.equal(p.cachedFallback, false);
});
test("both providers failing returns bounded saved data without extending its age", async () => {
  const first = await mainnetReferencePrice("AAPL", true);
  now += 20_000;
  oracleDown = restDown = true;
  const saved = await mainnetReferencePrice("AAPL", true);
  assert.equal(saved.cachedFallback, true);
  assert.equal(saved.readAt, first.readAt);
  const reply = await mainnetReferencePriceReply("AAPL", true);
  assert.match(reply.text.body, /saved price/);
  now += 301_000;
  await assert.rejects(mainnetReferencePrice("AAPL", true));
});
test("oracle pause invalidates saved data and never falls back", async () => {
  await mainnetReferencePrice("TSLA", true);
  paused.add("TSLA");
  await assert.rejects(mainnetReferencePrice("TSLA", true), isCode("oracle_paused"));
  assert.ok(!reads.some((url) => url.includes("api.robinhood.com")));
  oracleDown = restDown = true;
  await assert.rejects(mainnetReferencePrice("TSLA", true));
});
test("one paused asset leaves other chat price rows visible", async () => {
  paused.add("NVDA");
  const body = (await mainnetReferencePriceReply(undefined, true)).text.body;
  assert.match(body, /Apple \(AAPL\): \*≈ \$336.31 \/ token\*/);
  assert.match(body, /NVIDIA|NVDA: price unavailable \(pricing paused/);
  assert.match(body, /Tesla \(TSLA\): \*≈ \$336.31 \/ token\*/);
  assert.match(body, /Stock token prices · USD/);
  assert.match(body, /Updated just now/);
  assert.doesNotMatch(body, /Chainlink|UTC/);
  assert.match(body, /final quote, including fees, appears before you confirm/);
});
test("previous-session references are labelled; observations older than 96 hours are rejected", async () => {
  observationAge = 60 * 60 * 60_000;
  assert.match((await mainnetReferencePriceReply("AAPL", true)).text.body, /older reference/);
  observationAge = 97 * 60 * 60_000;
  quoteAge = 180_000;
  await assert.rejects(mainnetReferencePrice("AAPL", true), isCode("observation_too_old"));
});
for (const kind of [
  "zero",
  "negative",
  "future",
  "incomplete",
  "wrong_chain",
  "wrong_feed",
] as const) {
  test(`rejects ${kind} oracle data without hiding it with REST`, async () => {
    if (kind === "zero") answer = 0n;
    if (kind === "negative") answer = -1n;
    if (kind === "future") observationAge = -60_000;
    if (kind === "incomplete") invalidRound = true;
    if (kind === "wrong_chain") wrongChain = true;
    if (kind === "wrong_feed") badDirectory = true;
    await assert.rejects(mainnetReferencePrice("AAPL", true), isCode("invalid_data"));
    assert.ok(!reads.some((url) => url.includes("api.robinhood.com")));
  });
}
for (const kind of ["address", "halt", "pending", "old", "crossed", "zero"] as const) {
  test(`REST rejects ${kind} quote`, async () => {
    oracleDown = true;
    if (kind === "address") badAddress = true;
    if (kind === "halt") halted = true;
    if (kind === "pending") multiplierPending = true;
    if (kind === "old") quoteAge = 180_000;
    if (kind === "crossed") restAsk = "99";
    if (kind === "zero") restBid = "0";
    await assert.rejects(mainnetReferencePrice("AAPL", true));
  });
}
test("try again preserves scope, all expands scope, and trade tasks cannot be retried", () => {
  const task = { kind: "mainnet_stock" as const, priceScope: "AAPL" as const };
  assert.deepEqual(referencePriceFollowup(task, "try again"), { symbol: "AAPL" });
  assert.deepEqual(referencePriceFollowup(task, "all"), {});
  assert.equal(
    referencePriceFollowup({ kind: "mainnet_stock", side: "buy", amount: "5" }, "retry"),
    null,
  );
});
test("price formatting preserves cents for large integers and tiny values", () => {
  assert.equal(referenceDollars(9_007_199_254_740_993_99n, 2), "$9007199254740993.99");
  assert.equal(referenceDollars(1n, 8), "< $0.01");
  assert.equal(referenceDollars(12345n, 3), "$12.35");
});

for (const [age, label] of [
  [60_000, "1 minute ago"],
  [5 * 60_000, "5 minutes ago"],
  [60 * 60_000, "1 hour ago"],
  [2 * 60 * 60_000, "2 hours ago"],
  [24 * 60 * 60_000, "1 day ago"],
  [60 * 60 * 60_000, "2 days ago"],
] as const) {
  test(`chat shows the observation age as ${label}`, async () => {
    observationAge = age;
    const body = (await mainnetReferencePriceReply("AAPL", true)).text.body;
    assert.ok(body.includes(`Updated ${label}`));
    assert.doesNotMatch(body, /Chainlink|UTC/);
  });
}
