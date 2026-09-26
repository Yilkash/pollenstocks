import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  type Address,
} from "viem";

// Read-only testnet registry. No signer, approval, or execution capability.
export const STOCKS = {
  TSLA: { name: "Tesla", address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" },
  AMD: { name: "AMD", address: "0x71178BAc73cBeb415514eB542a8995b82669778d" },
  NFLX: { name: "Netflix", address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93" },
  AMZN: { name: "Amazon", address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02" },
} as const;
export type StockSymbol = keyof typeof STOCKS;
export const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F" as const;
export const EXCHANGE = "0x9b7f76c75cBAEd5801766cfA99DE15D198773dfe" as const;
const EXCHANGE_HASH = "0x5b526a6dd20402646bdde589247f0e0020a9827f8e5beeb601f14199bbea7f8c";
const abi = parseAbi([
  "function usdg() view returns (address)",
  "function getPool(address stock) view returns (uint112 reserveStock,uint112 reserveUsdg)",
  "function getAmountOut(address stock,address tokenIn,uint256 amountIn) view returns (uint256)",
]);
const client = createPublicClient({
  transport: http("https://rpc.testnet.chain.robinhood.com", { timeout: 8000, retryCount: 1 }),
});
async function snapshot() {
  const [chain, block] = await Promise.all([client.getChainId(), client.getBlock()]);
  if (
    chain !== 46630 ||
    !block.number ||
    Date.now() - Number(block.timestamp) * 1000 > 120000 ||
    Number(block.timestamp) * 1000 > Date.now() + 30000
  )
    throw Error("unreliable_stock_snapshot");
  return block;
}
export async function stockPortfolio(wallet: Address) {
  const block = await snapshot();
  const tokens = [
    ...Object.entries(STOCKS).map(([symbol, asset]) => ({
      symbol,
      address: asset.address,
      decimals: 18,
    })),
    { symbol: "USDG", address: USDG, decimals: 6 },
  ];
  const balances = await Promise.all(
    tokens.map(async (token) => {
      const [balance, decimals] = await Promise.all([
        client.readContract({
          address: getAddress(token.address),
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet],
          blockNumber: block.number,
        }),
        client.readContract({
          address: getAddress(token.address),
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber: block.number,
        }),
      ]);
      if (decimals !== token.decimals) throw Error("stock_decimals_changed");
      return { ...token, balance };
    }),
  );
  return { block, balances };
}
export async function stockQuote(symbol: StockSymbol, side: "buy" | "sell", amount: string) {
  const decimalsIn = side === "buy" ? 6 : 18;
  if (!new RegExp(`^(?:0|[1-9]\\d{0,3})(?:\\.\\d{1,${decimalsIn}})?$`).test(amount))
    throw Error("invalid_stock_amount");
  const amountIn = parseUnits(amount, decimalsIn);
  if (amountIn <= 0n || amountIn > parseUnits("1000", decimalsIn))
    throw Error("invalid_stock_amount");
  const block = await snapshot();
  const stock = STOCKS[symbol].address;
  const tokenIn = side === "buy" ? USDG : stock;
  const [code, quoteAsset, pool, stockBalance, usdBalance, stockDecimals, usdDecimals, amountOut] =
    await Promise.all([
      client.getCode({ address: EXCHANGE, blockNumber: block.number }),
      client.readContract({
        address: EXCHANGE,
        abi,
        functionName: "usdg",
        blockNumber: block.number,
      }),
      client.readContract({
        address: EXCHANGE,
        abi,
        functionName: "getPool",
        args: [stock],
        blockNumber: block.number,
      }),
      client.readContract({
        address: stock,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [EXCHANGE],
        blockNumber: block.number,
      }),
      client.readContract({
        address: USDG,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [EXCHANGE],
        blockNumber: block.number,
      }),
      client.readContract({
        address: stock,
        abi: erc20Abi,
        functionName: "decimals",
        blockNumber: block.number,
      }),
      client.readContract({
        address: USDG,
        abi: erc20Abi,
        functionName: "decimals",
        blockNumber: block.number,
      }),
      client.readContract({
        address: EXCHANGE,
        abi,
        functionName: "getAmountOut",
        args: [stock, tokenIn, amountIn],
        blockNumber: block.number,
      }),
    ]);
  if (
    !code ||
    keccak256(code) !== EXCHANGE_HASH ||
    quoteAsset.toLowerCase() !== USDG.toLowerCase() ||
    stockDecimals !== 18 ||
    usdDecimals !== 6
  )
    throw Error("stock_market_changed");
  if (pool[0] <= 0n || pool[1] <= 0n || stockBalance < pool[0] || usdBalance < pool[1])
    throw Error("unbacked_stock_pool");
  const [reserveIn, reserveOut] = side === "buy" ? [pool[1], pool[0]] : [pool[0], pool[1]];
  const expected = (amountIn * 997n * reserveOut) / (reserveIn * 1000n + amountIn * 997n);
  if (
    expected !== amountOut ||
    amountOut <= 0n ||
    amountOut >= reserveOut ||
    reserveIn + amountIn >= 2n ** 112n
  )
    throw Error("invalid_stock_quote");
  // Quote is informational only: no user approval, deadline guarantee or gas estimate.
  return {
    symbol,
    side,
    amountIn,
    amountOut,
    decimalsIn,
    decimalsOut: side === "buy" ? 18 : 6,
    block,
    executionEnabled: false as const,
  };
}
