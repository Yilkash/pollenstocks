import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
} from "viem";
import { z } from "zod";
import {
  MAINNET_ASSETS,
  KYBER_CHAIN_SLUG,
  MAINNET_CHAIN_ID,
  MAINNET_QUOTE,
  STOCK_ISSUER_OWNER,
  mainnetChain,
  type MainnetStock,
} from "../networks/chain";

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
    retryCount: 1,
    retryDelay: 300,
  }),
});
const ownerAbi = parseAbi(["function owner() view returns (address)"]);

let registryPending: Promise<typeof MAINNET_ASSETS> | undefined;
export function verifiedMainnetRegistry() {
  if (!registryPending)
    registryPending = readMainnetRegistry().finally(() => {
      registryPending = undefined;
    });
  return registryPending;
}
// Arc has no official stock-token registry, so each pinned token is verified on-chain:
// contract code, symbol, decimals and the issuer's owner address. Copycat tokens with the
// same name and symbol exist on Arc; only these exact addresses are ever traded.
async function readMainnetRegistry() {
  try {
    await Promise.all(
      Object.entries(MAINNET_ASSETS).map(async ([symbol, expected]) => {
        const [code, decimals, onchainSymbol, owner] = await Promise.all([
          client.getCode({ address: expected.address }),
          client.readContract({
            address: expected.address,
            abi: erc20Abi,
            functionName: "decimals",
          }),
          client.readContract({ address: expected.address, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address: expected.address, abi: ownerAbi, functionName: "owner" }),
        ]);
        if (
          !code ||
          code === "0x" ||
          decimals !== expected.decimals ||
          onchainSymbol !== symbol ||
          owner.toLowerCase() !== STOCK_ISSUER_OWNER
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
    ...Object.entries(MAINNET_ASSETS).map(([symbol, asset]) => ({ symbol, ...asset })),
    MAINNET_QUOTE,
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
      if (!code || code === "0x" || decimals !== token.decimals || symbol !== token.symbol)
        throw new MainnetReadError("registry_changed");
      return {
        symbol,
        address: token.address,
        decimals,
        balance,
        // Arc stock tokens carry no corporate-action multiplier: 1 token is 1 share.
        multiplier: 10n ** 18n,
        formatted: formatUnits(balance, decimals),
      };
    }),
  );
  const eth = await client.getBalance({ address: wallet, blockNumber: block.number });
  return { chainId: MAINNET_CHAIN_ID, wallet, block, balances, eth };
}
const integer = z.string().regex(/^\d{1,78}$/);
const priceSchema = z.object({
  code: z.literal(0),
  data: z.object({
    routeSummary: z.object({
      tokenIn: z.string(),
      tokenOut: z.string(),
      amountIn: integer,
      amountOut: integer,
      timestamp: z.number().int().positive(),
      gasUsd: z
        .string()
        .regex(/^\d{1,12}(?:\.\d{1,30})?$/)
        .optional(),
    }),
  }),
});
// Indicative price only. Never accept or expose API-provided signing calldata.
// No wallet/taker address is sent to the provider for this preview.
export async function mainnetPrice(symbol: MainnetStock, side: "buy" | "sell", amount: string) {
  try {
    return await readMainnetPrice(symbol, side, amount);
  } catch (error) {
    if (
      !(error instanceof MainnetReadError) ||
      !["quote_unavailable", "quote_busy", "registry_unavailable"].includes(error.code)
    )
      throw error;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return readMainnetPrice(symbol, side, amount);
  }
}
async function readMainnetPrice(symbol: MainnetStock, side: "buy" | "sell", amount: string) {
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
  const url = new URL(`https://aggregator-api.kyberswap.com/${KYBER_CHAIN_SLUG}/api/v1/routes`);
  url.search = new URLSearchParams({
    tokenIn: sell.address,
    tokenOut: buy.address,
    amountIn: sellAmount.toString(),
  }).toString();
  let body: unknown;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      redirect: "error",
      cache: "no-store",
    });
    if (response.status === 429 || response.status === 503)
      throw new MainnetReadError("quote_busy");
    if (!response.ok) throw new MainnetReadError("quote_unavailable");
    body = await response.json();
  } catch (error) {
    if (error instanceof MainnetReadError) throw error;
    throw new MainnetReadError("quote_unavailable");
  }
  const parsed = priceSchema.safeParse(body);
  if (!parsed.success) throw new MainnetReadError("invalid_response");
  const price = parsed.data.data.routeSummary;
  // Kyber's timestamp is provider-reported, not proof of a particular chain block.
  // A separate fresh RPC snapshot above confirms network availability.
  const age = Date.now() - price.timestamp * 1000;
  if (
    age > 120000 ||
    age < -30000 ||
    price.tokenIn.toLowerCase() !== sell.address.toLowerCase() ||
    price.tokenOut.toLowerCase() !== buy.address.toLowerCase() ||
    BigInt(price.amountIn) !== sellAmount
  )
    throw new MainnetReadError("invalid_response");
  if (BigInt(price.amountOut) <= 0n) throw new MainnetReadError("no_liquidity");
  return {
    chainId: MAINNET_CHAIN_ID,
    symbol,
    side,
    sellAmount,
    buyAmount: BigInt(price.amountOut),
    sellDecimals: sell.decimals,
    buyDecimals: buy.decimals,
    blockNumber: block.number,
    timestamp: BigInt(price.timestamp),
    networkFeeUsd: price.gasUsd ?? null,
    provider: "KyberSwap" as const,
    executionEnabled: false as const,
  };
}
