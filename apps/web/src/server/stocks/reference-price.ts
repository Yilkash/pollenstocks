import { createPublicClient, fallback, http, isAddress, parseAbi, parseUnits } from "viem";
import { z } from "zod";
import { MAINNET_ASSETS, robinhoodMainnet, type MainnetStock } from "../networks/robinhood";

// Display-only data. Never import this module into order preparation or execution.
// Oracle answers already include the corporate-action multiplier. REST bid/ask do not.
// Sources and units: docs.robinhood.com/chain/{oracles-and-price-feeds,stock-token-apis}/
const DIRECTORY = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
const CACHE_MS = 15_000;
const FALLBACK_MS = 5 * 60_000;
const MAX_OBSERVATION_MS = 96 * 60 * 60_000;
const DIRECTORY_MS = 60 * 60_000;
const decimal = z.string().regex(/^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/);
const deployment = z.object({ chainId: z.number(), contractAddress: z.string() });
const feedSchema = z.object({
  name: z.string(),
  proxyAddress: z.string().refine(isAddress),
  heartbeat: z.number().int().positive().max(604800),
  decimals: z.number().int().min(0).max(18),
  docs: z.object({
    baseAsset: z.string(),
    quoteAsset: z.string(),
    blockchainName: z.string(),
    productTypeCode: z.string(),
  }),
});
type Feed = z.infer<typeof feedSchema>;
const assetSchema = z.object({
  tokenSymbol: z.string(),
  tokenDecimals: z.number(),
  status: z.string(),
  deployments: z.array(deployment),
  currentMultiplier: decimal,
  pendingMultiplier: z.string().optional(),
});
const quoteSchema = z.object({
  tokenSymbol: z.string(),
  deployments: z.array(deployment),
  bid: decimal,
  ask: decimal,
  currency: z.literal("USD"),
  isTradingHalt: z.boolean(),
  generatedAt: z.string(),
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
const transient = (error: unknown) =>
  ["source_unavailable", "provider_busy"].includes(codeOf(error));

export type ReferencePrice = {
  symbol: MainnetStock;
  value: bigint;
  decimals: number;
  currency: "USD";
  source: "Chainlink" | "Robinhood";
  asOf: number;
  readAt: number;
  heartbeatMs: number;
  cachedFallback: boolean;
};
const prices = new Map<MainnetStock, ReferencePrice>();
const pending = new Map<MainnetStock, Promise<ReferencePrice>>();
let directory: { feeds: Feed[]; expires: number } | undefined;
let directoryPending: Promise<Feed[]> | undefined;
let assets: { rows: z.infer<typeof assetSchema>[]; expires: number } | undefined;
let assetsPending: Promise<z.infer<typeof assetSchema>[]> | undefined;

async function publicJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 429 || response.status === 503)
        throw new ReferencePriceError("provider_busy");
      if (!response.ok) throw new ReferencePriceError("source_unavailable");
      try {
        return await response.json();
      } catch {
        throw new ReferencePriceError("invalid_data");
      }
    } catch (error) {
      if (attempt === 1 || !transient(error))
        throw error instanceof ReferencePriceError
          ? error
          : new ReferencePriceError("source_unavailable");
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new ReferencePriceError("source_unavailable");
}

async function feeds(): Promise<Feed[]> {
  if (directory && directory.expires > Date.now()) return directory.feeds;
  if (!directoryPending)
    directoryPending = (async () => {
      const raw = await publicJson(DIRECTORY);
      if (!Array.isArray(raw)) throw new ReferencePriceError("invalid_data");
      // Ignore unrelated directory entries; each requested symbol must match exactly once.
      const entries = raw.flatMap((entry) => {
        const parsed = feedSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      });
      directory = { feeds: entries, expires: Date.now() + DIRECTORY_MS };
      return entries;
    })().finally(() => {
      directoryPending = undefined;
    });
  return directoryPending;
}

function rpcClient() {
  const configured = (process.env.MAINNET_REFERENCE_RPC_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  const urls = [...new Set([...configured, ...robinhoodMainnet.rpcUrls.default.http])];
  return createPublicClient({
    chain: robinhoodMainnet,
    transport: fallback(
      urls.map((url) => http(url, { timeout: 5000, retryCount: 0 })),
      { retryCount: 1, retryDelay: 400 },
    ),
  });
}
const oracleAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function oraclePaused() view returns (bool)",
]);
let snapshotPending:
  | Promise<{ client: ReturnType<typeof rpcClient>; blockNumber: bigint }>
  | undefined;
function snapshot() {
  if (!snapshotPending)
    snapshotPending = (async () => {
      const client = rpcClient();
      const [chain, block] = await Promise.all([client.getChainId(), client.getBlock()]);
      const age = Date.now() - Number(block.timestamp) * 1000;
      if (chain !== 4663) throw new ReferencePriceError("invalid_data");
      if (age < -30_000 || age > 120_000) throw new ReferencePriceError("source_unavailable");
      return { client, blockNumber: block.number };
    })().finally(() => {
      snapshotPending = undefined;
    });
  return snapshotPending;
}
function validTime(asOf: number, maxAge = MAX_OBSERVATION_MS) {
  const age = Date.now() - asOf;
  if (!Number.isFinite(asOf) || asOf <= 0 || age < -30_000)
    throw new ReferencePriceError("invalid_data");
  if (age > maxAge) throw new ReferencePriceError("observation_too_old");
}

async function oraclePrice(symbol: MainnetStock): Promise<ReferencePrice> {
  const [entries, { client, blockNumber }] = await Promise.all([feeds(), snapshot()]);
  const matches = entries.filter(
    (entry) =>
      entry.name === `Robinhood ${symbol} / USD` &&
      entry.docs.baseAsset === symbol &&
      entry.docs.quoteAsset === "USD" &&
      entry.docs.blockchainName === "Robinhood" &&
      entry.docs.productTypeCode === "primaryTokenizedPrice",
  );
  if (matches.length !== 1) throw new ReferencePriceError("invalid_data");
  const feed = matches[0];
  const paused = await client.readContract({
    address: MAINNET_ASSETS[symbol].address,
    abi: oracleAbi,
    functionName: "oraclePaused",
    blockNumber,
  });
  if (paused) throw new ReferencePriceError("oracle_paused");
  const [decimals, round] = await Promise.all([
    client.readContract({
      address: feed.proxyAddress,
      abi: oracleAbi,
      functionName: "decimals",
      blockNumber,
    }),
    client.readContract({
      address: feed.proxyAddress,
      abi: oracleAbi,
      functionName: "latestRoundData",
      blockNumber,
    }),
  ]);
  const [roundId, answer, , updatedAt, answeredInRound] = round;
  if (decimals !== feed.decimals || answer <= 0n || roundId <= 0n || answeredInRound < roundId)
    throw new ReferencePriceError("invalid_data");
  const asOf = Number(updatedAt) * 1000;
  validTime(asOf);
  return {
    symbol,
    value: answer,
    decimals,
    currency: "USD",
    source: "Chainlink",
    asOf,
    readAt: Date.now(),
    heartbeatMs: feed.heartbeat * 1000,
    cachedFallback: false,
  };
}

async function assetRows() {
  if (assets && assets.expires > Date.now()) return assets.rows;
  if (!assetsPending)
    assetsPending = (async () => {
      const raw = z
        .object({ assets: z.array(z.unknown()) })
        .safeParse(await publicJson("https://api.robinhood.com/rhj/assets"));
      if (!raw.success) throw new ReferencePriceError("invalid_data");
      // An unrelated inactive or malformed listing must not hide every supported price.
      const rows = raw.data.assets.flatMap((entry) => {
        const parsed = assetSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      });
      assets = { rows, expires: Date.now() + CACHE_MS };
      return assets.rows;
    })().finally(() => {
      assetsPending = undefined;
    });
  return assetsPending;
}
function matchesToken(symbol: MainnetStock, deployments: z.infer<typeof deployment>[]) {
  const rows = deployments.filter((row) => row.chainId === 4663);
  return (
    rows.length === 1 &&
    rows[0].contractAddress.toLowerCase() === MAINNET_ASSETS[symbol].address.toLowerCase()
  );
}
async function restPrice(symbol: MainnetStock): Promise<ReferencePrice> {
  const [rows, raw] = await Promise.all([
    assetRows(),
    publicJson(`https://api.robinhood.com/rhj/prices/${symbol}`),
  ]);
  const matching = rows.filter((row) => row.tokenSymbol === symbol);
  const asset = matching[0];
  if (
    matching.length !== 1 ||
    asset.status !== "ASSET_STATUS_ACTIVE" ||
    asset.tokenDecimals !== MAINNET_ASSETS[symbol].decimals ||
    !matchesToken(symbol, asset.deployments)
  )
    throw new ReferencePriceError("asset_changed");
  if (asset.pendingMultiplier) throw new ReferencePriceError("oracle_paused");
  const parsed = z.object({ quotes: z.array(quoteSchema) }).safeParse(raw);
  if (!parsed.success) throw new ReferencePriceError("invalid_data");
  const quotes = parsed.data.quotes.filter((quote) => quote.tokenSymbol === symbol);
  if (quotes.length !== 1 || !matchesToken(symbol, quotes[0].deployments))
    throw new ReferencePriceError("asset_changed");
  const quote = quotes[0];
  if (quote.isTradingHalt) throw new ReferencePriceError("trading_halted");
  const asOf = Date.parse(quote.generatedAt);
  // Do not multiply an old underlying-equity quote by today's corporate-action ratio.
  validTime(asOf, 120_000);
  const bid = parseUnits(quote.bid, 18),
    ask = parseUnits(quote.ask, 18);
  const multiplier = parseUnits(asset.currentMultiplier, 18);
  if (bid <= 0n || ask < bid || multiplier <= 0n) throw new ReferencePriceError("invalid_data");
  const value = ((bid + ask) * multiplier) / (2n * 10n ** 18n);
  if (value <= 0n) throw new ReferencePriceError("invalid_data");
  return {
    symbol,
    value,
    decimals: 18,
    currency: "USD",
    source: "Robinhood",
    asOf,
    readAt: Date.now(),
    heartbeatMs: 120_000,
    cachedFallback: false,
  };
}

async function refresh(symbol: MainnetStock): Promise<ReferencePrice> {
  try {
    let result: ReferencePrice;
    try {
      result = await oraclePrice(symbol);
    } catch (error) {
      console.warn("Stock reference source failed", {
        symbol,
        source: "Chainlink",
        code: codeOf(error),
      });
      // An explicit pause, identity mismatch or invalid answer must not be hidden by a fallback.
      if (!transient(error) && codeOf(error) !== "observation_too_old") throw error;
      result = await restPrice(symbol);
    }
    prices.set(symbol, result);
    return result;
  } catch (error) {
    const saved = prices.get(symbol);
    console.warn("Stock reference refresh failed", { symbol, code: codeOf(error) });
    if (
      transient(error) &&
      saved &&
      Date.now() - saved.readAt <= FALLBACK_MS &&
      Date.now() - saved.asOf <= MAX_OBSERVATION_MS
    )
      return { ...saved, cachedFallback: true };
    prices.delete(symbol);
    throw new ReferencePriceError(codeOf(error));
  }
}

export async function mainnetReferencePrice(symbol: MainnetStock, forceRefresh = false) {
  const saved = prices.get(symbol);
  if (
    !forceRefresh &&
    saved &&
    Date.now() - saved.readAt < CACHE_MS &&
    Date.now() - saved.asOf <= MAX_OBSERVATION_MS
  )
    return saved;
  let work = pending.get(symbol);
  if (!work) {
    work = refresh(symbol).finally(() => {
      pending.delete(symbol);
    });
    pending.set(symbol, work);
  }
  return work;
}

/** Integer rounding for display; never use floating point to scale a price. */
export function referenceDollars(value: bigint, decimals: number) {
  const scale = 10n ** BigInt(decimals);
  const cents = (value * 100n + scale / 2n) / scale;
  if (value > 0n && cents === 0n) return "< $0.01";
  return `$${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
