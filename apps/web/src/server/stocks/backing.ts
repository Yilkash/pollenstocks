import { createPublicClient, erc20Abi, http, type PublicClient } from "viem";
import {
  ARCSTOCKS_VAULT,
  MAINNET_ASSETS,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_CHAIN_RPC,
  type MainnetStock,
} from "../networks/chain";

// Proof of backing, read live before each trade review and again before sending.
// ArcStocks mints an Arc token only after its vault on Robinhood Chain holds the same stock
// token, and a sell burns on Arc before the vault sells, so the vault must always hold at
// least the Arc supply. A small tolerance covers rounding in transit.
const TOLERANCE_BPS = 10n; // 0.1%
const CACHE_MS = 60_000;

const robinhood = createPublicClient({
  transport: http(ROBINHOOD_CHAIN_RPC, { timeout: 10000, retryCount: 2, retryDelay: 400 }),
});

export class BackingError extends Error {
  constructor(public readonly code: "backing_unavailable" | "backing_short") {
    super(code);
  }
}
export type Backing = { symbol: MainnetStock; arcSupply: bigint; vaultHolds: bigint; at: number };

/** True when the vault holds at least the Arc supply, less the transit tolerance. */
export function fullyBacked(arcSupply: bigint, vaultHolds: bigint) {
  return vaultHolds * 10_000n >= arcSupply * (10_000n - TOLERANCE_BPS);
}

const cache = new Map<MainnetStock, Backing>();
export async function verifyBacking(arc: PublicClient, symbol: MainnetStock): Promise<Backing> {
  const saved = cache.get(symbol);
  if (saved && Date.now() - saved.at < CACHE_MS) return saved;
  const asset = MAINNET_ASSETS[symbol];
  let arcSupply: bigint, vaultHolds: bigint, chainId: number;
  try {
    [arcSupply, vaultHolds, chainId] = await Promise.all([
      arc.readContract({ address: asset.address, abi: erc20Abi, functionName: "totalSupply" }),
      robinhood.readContract({
        address: asset.underlying,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [ARCSTOCKS_VAULT],
      }),
      robinhood.getChainId(),
    ]);
  } catch {
    throw new BackingError("backing_unavailable");
  }
  if (chainId !== ROBINHOOD_CHAIN_ID) throw new BackingError("backing_unavailable");
  if (!fullyBacked(arcSupply, vaultHolds)) {
    console.warn("Stock backing short", {
      symbol,
      arcSupply: arcSupply.toString(),
      vaultHolds: vaultHolds.toString(),
    });
    throw new BackingError("backing_short");
  }
  const backing = { symbol, arcSupply, vaultHolds, at: Date.now() };
  cache.set(symbol, backing);
  return backing;
}
