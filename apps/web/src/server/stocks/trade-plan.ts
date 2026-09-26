import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { STOCKS, USDG, EXCHANGE, type stockQuote } from "./market";

export const stockAdapterAbi = parseAbi([
  "function trade(bytes32 orderId,address stock,bool buy,uint256 amountIn,uint256 minAmountOut,uint256 deadline) returns (uint256)",
  "function usedOrders(address trader,bytes32 orderId) view returns (bool)",
  "function EXCHANGE() view returns (address)",
  "function USDG() view returns (address)",
  "event TradeExecuted(bytes32 indexed orderId,address indexed trader,address indexed stock,bool buy,uint256 amountIn,uint256 amountOut)",
]);
export type StockTradePlan = {
  chainId: 46630;
  wallet: Address;
  adapter: Address;
  orderId: Hex;
  inputToken: Address;
  outputToken: Address;
  amountIn: string;
  expectedOutput: string;
  minimumOutput: string;
  deadline: number;
  slippageBps: 100;
  steps: { kind: "reset_allowance" | "approve" | "trade"; to: Address; data: Hex; value: "0x0" }[];
};

// Internal unsigned construction only. Caller must independently verify the deployed
// adapter, wallet ownership, gas caps, balances and allowances before any review.
// Never expose this as an AI signing tool or treat an estimate as consent.
export function buildStockTradePlan(
  quote: Awaited<ReturnType<typeof stockQuote>>,
  wallet: Address,
  adapter: Address,
  requestId: string,
  existingAllowance: bigint,
): StockTradePlan {
  if (
    !isAddress(wallet) ||
    !isAddress(adapter) ||
    wallet === zeroAddress ||
    adapter === zeroAddress ||
    !/^[a-f0-9-]{36}$/i.test(requestId)
  )
    throw Error("invalid_trade_identity");
  const forbidden = [wallet, USDG, EXCHANGE, ...Object.values(STOCKS).map((a) => a.address)].map(
    (a) => a.toLowerCase(),
  );
  if (forbidden.includes(adapter.toLowerCase()) || existingAllowance < 0n)
    throw Error("invalid_trade_adapter");
  const now = Math.floor(Date.now() / 1000);
  const quoteTime = Number(quote.block.timestamp);
  if (!Number.isSafeInteger(quoteTime) || now - quoteTime > 60 || quoteTime > now + 30)
    throw Error("expired_stock_quote");
  const stock = STOCKS[quote.symbol].address;
  const inputToken = quote.side === "buy" ? USDG : stock;
  const outputToken = quote.side === "buy" ? stock : USDG;
  const limit = quote.side === "buy" ? 1000_000000n : 1000n * 10n ** 18n;
  const minOut = (quote.amountOut * 99n) / 100n;
  if (quote.amountIn <= 0n || quote.amountIn > limit || minOut <= 0n)
    throw Error("invalid_trade_amount");
  const orderId = keccak256(toBytes(`steward-stock-v1:46630:${wallet.toLowerCase()}:${requestId}`));
  const deadline = Math.min(now + 240, quoteTime + 240);
  const steps: StockTradePlan["steps"] = [];
  // No unlimited approvals. A stale allowance requires a separately checked reset.
  if (existingAllowance > 0n)
    steps.push({
      kind: "reset_allowance",
      to: inputToken,
      value: "0x0",
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [adapter, 0n] }),
    });
  steps.push({
    kind: "approve",
    to: inputToken,
    value: "0x0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [adapter, quote.amountIn],
    }),
  });
  steps.push({
    kind: "trade",
    to: adapter,
    value: "0x0",
    data: encodeFunctionData({
      abi: stockAdapterAbi,
      functionName: "trade",
      args: [orderId, stock, quote.side === "buy", quote.amountIn, minOut, BigInt(deadline)],
    }),
  });
  return {
    chainId: 46630,
    wallet: getAddress(wallet),
    adapter: getAddress(adapter),
    orderId,
    inputToken,
    outputToken,
    amountIn: quote.amountIn.toString(),
    expectedOutput: quote.amountOut.toString(),
    minimumOutput: minOut.toString(),
    deadline,
    slippageBps: 100,
    steps,
  };
}
