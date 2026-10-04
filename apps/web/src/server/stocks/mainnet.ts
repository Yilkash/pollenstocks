import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  type Address,
  type PublicClient,
} from "viem";
import {
  MAINNET_ASSETS,
  MAINNET_CHAIN_ID,
  MAINNET_QUOTE,
  mainnetChain,
  onchainSymbol,
  type MainnetStock,
} from "../networks/chain";
import { DeskError, checkDesk, deskQuote } from "./arcstocks-desk";

export class MainnetReadError extends Error {
  constructor(
    public code:
      | "rpc_unavailable"
      | "registry_unavailable"
      | "registry_changed"
      | "quote_not_configured"
      | "quote_unavailable"
      | "quote_busy"
      | "token_not_authorized"
      | "no_liquidity"
      | "invalid_amount"
      | "invalid_response",
  ) {
    super(code);
  }
}
const client = createPublicClient({
  chain: mainnetChain,
  transport: http(mainnetChain.rpcUrls.default.http[0], {
    timeout: 10000,
    retryCount: 3,
    retryDelay: 500,
    // One HTTP request per burst of reads: fewer rate-limit hits from shared cloud IPs, and
    // every read in a burst lands on the same RPC node.
    batch: { batchSize: 50, wait: 10 },
  }),
});
/** The shared Arc read client, for modules that take one (desk, backing). */
export const arcReader = client as PublicClient;

let registryPending: Promise<typeof MAINNET_ASSETS> | undefined;
export function verifiedMainnetRegistry() {
  if (!registryPending)
    registryPending = readMainnetRegistry().finally(() => {
      registryPending = undefined;
    });
  return registryPending;
}
// Each pinned ArcStocks token is verified on-chain before use: contract code, the
// "<TICKER>.arc" symbol and 18 decimals. Only these exact addresses are ever traded.
async function readMainnetRegistry() {
  try {
    await Promise.all(
      Object.entries(MAINNET_ASSETS).map(async ([symbol, expected]) => {
        const [code, decimals, onchain] = await Promise.all([
          client.getCode({ address: expected.address }),
          client.readContract({
            address: expected.address,
            abi: erc20Abi,
            functionName: "decimals",
          }),
          client.readContract({ address: expected.address, abi: erc20Abi, functionName: "symbol" }),
        ]);
        if (
          !code ||
          code === "0x" ||
          decimals !== expected.decimals ||
          onchain !== onchainSymbol(symbol)
        )
          throw new MainnetReadError("registry_changed");
      }),
    );
  } catch (error) {
    if (error instanceof MainnetReadError) throw error;
    throw new MainnetReadError("registry_unavailable");
  }
  return MAINNET_ASSETS;
}
let snapshotPending: ReturnType<typeof readMainnetSnapshot> | undefined;
function mainnetSnapshot() {
  if (!snapshotPending)
    snapshotPending = readMainnetSnapshot().finally(() => {
      snapshotPending = undefined;
    });
  return snapshotPending;
}
async function readMainnetSnapshot() {
  try {
    const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock()]);
    const age = Date.now() - Number(block.timestamp) * 1000;
    if (chainId !== MAINNET_CHAIN_ID || age > 120000 || age < -30000) throw Error("stale_mainnet");
    return block;
  } catch {
    throw new MainnetReadError("rpc_unavailable");
  }
}
export async function mainnetPortfolio(wallet: Address) {
  if (!isAddress(wallet)) throw new MainnetReadError("invalid_response");
  await verifiedMainnetRegistry();
  const block = await mainnetSnapshot();
  const tokens = [
    ...Object.entries(MAINNET_ASSETS).map(([symbol, asset]) => ({
      symbol,
      onchain: onchainSymbol(symbol),
      ...asset,
    })),
    { ...MAINNET_QUOTE, onchain: MAINNET_QUOTE.symbol },
  ];
  const balances = await Promise.all(
    tokens.map(async (token) => {
      const [code, decimals, symbol, balance] = await Promise.all([
        client.getCode({ address: token.address, blockNumber: block.number }),
        client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber: block.number,
        }),
        client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "symbol",
          blockNumber: block.number,
        }),
        client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet],
          blockNumber: block.number,
        }),
      ]);
      if (!code || code === "0x" || decimals !== token.decimals || symbol !== token.onchain)
        throw new MainnetReadError("registry_changed");
      return {
        symbol: token.symbol,
        address: token.address,
        decimals,
        balance,
        // ArcStocks tokens carry no corporate-action multiplier: 1 token is 1 share.
        multiplier: 10n ** 18n,
        formatted: formatUnits(balance, decimals),
      };
    }),
  );
  const eth = await client.getBalance({ address: wallet, blockNumber: block.number });
  return { chainId: MAINNET_CHAIN_ID, wallet, block, balances, eth };
}
// Indicative price only, read from the ArcStocks desk contract. No order is created.
export async function mainnetPrice(symbol: MainnetStock, side: "buy" | "sell", amount: string) {
  const stock = MAINNET_ASSETS[symbol];
  const sell = side === "buy" ? MAINNET_QUOTE : stock;
  const buy = side === "buy" ? stock : MAINNET_QUOTE;
  if (!new RegExp(`^(?:0|[1-9]\\d{0,3})(?:\\.\\d{1,${sell.decimals}})?$`).test(amount))
    throw new MainnetReadError("invalid_amount");
  const sellAmount = parseUnits(amount, sell.decimals);
  if (sellAmount <= 0n || sellAmount > parseUnits("1000", sell.decimals))
    throw new MainnetReadError("invalid_amount");
  await verifiedMainnetRegistry();
  const block = await mainnetSnapshot();
  let buyAmount: bigint;
  try {
    await checkDesk(arcReader);
    buyAmount = (await deskQuote(arcReader, symbol, side, sellAmount)).amountOut;
  } catch (error) {
    if (error instanceof DeskError && error.code === "desk_cannot_fill")
      throw new MainnetReadError("no_liquidity");
    if (error instanceof DeskError && error.code === "desk_unavailable")
      throw new MainnetReadError("quote_busy");
    throw new MainnetReadError("quote_unavailable");
  }
  return {
    chainId: MAINNET_CHAIN_ID,
    symbol,
    side,
    sellAmount,
    buyAmount,
    sellDecimals: sell.decimals,
    buyDecimals: buy.decimals,
    blockNumber: block.number,
    timestamp: block.timestamp,
    networkFeeUsd: null,
    provider: "ArcStocks desk" as const,
    executionEnabled: false as const,
  };
}
