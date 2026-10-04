import { randomUUID } from "node:crypto";
import {
  createPublicClient,
  http,
  erc20Abi,
  encodeFunctionData,
  decodeFunctionData,
  getAddress,
  zeroAddress,
  isAddress,
  keccak256,
  toBytes,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  ARCSTOCKS_DESK,
  MAINNET_ASSETS,
  MAINNET_CHAIN_ID,
  MAINNET_QUOTE,
  NATIVE_PER_QUOTE_UNIT,
  mainnetChain,
  type MainnetStock,
} from "../networks/chain";
import { fairPriceCheck } from "./reference-price";
import { verifiedMainnetRegistry } from "./mainnet";
import { checkDesk, deskAbi, deskQuote } from "./arcstocks-desk";
import { verifyBacking } from "./backing";

export const mainnetRpc = createPublicClient({
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
const arc = mainnetRpc as PublicClient;
/** Desk trades fit well within this; observed ~92k gas for a buy and ~87k for a sell. */
const DESK_TRADE_GAS = 150000n;
export function requireTrade(ok: unknown, code = "mainnet_validation_failed"): asserts ok {
  if (!ok) throw Error(code);
}
// The user confirms a maximum network fee per step (reviewed gas x reviewed price
// ceiling), not a gas-unit count. Provider swap-gas figures can run low, so a
// higher fresh estimate is accepted when, with a 10% margin, it still fits the
// confirmed fee at the price actually used. Returns null when it does not fit.
export function executionGasLimit(
  estimate: bigint,
  reviewedGas: bigint,
  reviewedPrice: bigint,
  actualPrice: bigint,
): bigint | null {
  if (estimate <= 0n || actualPrice <= 0n || actualPrice > reviewedPrice) return null;
  if (estimate <= reviewedGas) return reviewedGas;
  const limit = (estimate * 110n + 99n) / 100n;
  return limit * actualPrice <= reviewedGas * reviewedPrice ? limit : null;
}
// Gas price to broadcast with. The base fee can tick up between reading it and inclusion,
// and a bid below the new base fee is rejected ("max fee per gas less than block base
// fee"), so bid 5% above the current price. Never exceed the price ceiling the user
// confirmed; the gas-limit check below bounds the worst case by the confirmed fee.
export function broadcastGasPrice(suggested: bigint, baseFee: bigint, ceiling: bigint) {
  const current = suggested > baseFee ? suggested : baseFee;
  const bid = (current * 105n + 99n) / 100n;
  return bid < ceiling ? bid : ceiling;
}
export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function mainnetTradeConfig() {
  const policy = process.env.PRIVY_MAINNET_POLICY_ID?.trim();
  const maxInput = process.env.MAINNET_MAX_USDC_PER_TRADE?.trim();
  const maxFees = process.env.MAINNET_MAX_FEE_WEI?.trim();
  requireTrade(policy, "mainnet_setup_required");
  requireTrade(maxInput && /^\d+(\.\d{1,6})?$/.test(maxInput), "mainnet_limits_required");
  requireTrade(!maxFees || /^[1-9]\d{0,18}$/.test(maxFees), "mainnet_fee_limit_invalid");
  const inputCap = parseUnits(maxInput, 6),
    feeCap = maxFees ? BigInt(maxFees) : undefined;
  requireTrade(
    // The ArcStocks desk fills up to 500 USDC per trade.
    inputCap > 0n &&
      inputCap <= 500_000000n &&
      // Arc gas is USDC in 18-decimal native units: 0.1 USDC per trade at most.
      (feeCap === undefined || feeCap <= 100000000000000000n),
    "mainnet_limits_invalid",
  );
  return { policy, inputCap, feeCap };
}
/** Fresh Arc chain head, and the ArcStocks desk exactly as pinned and not paused. */
export async function checkMainnetVenue() {
  const c = mainnetTradeConfig();
  requireTrade((await mainnetRpc.getChainId()) === MAINNET_CHAIN_ID);
  const block = await mainnetRpc.getBlock();
  requireTrade(Math.abs(Date.now() - Number(block.timestamp) * 1000) < 120000);
  try {
    await checkDesk(arc);
  } catch (error) {
    throw Error(error instanceof Error ? error.message : "desk_unavailable");
  }
  return c;
}
export type MainnetPlan = {
  provider?: "arcstocks-desk";
  id: string;
  orderId: Hex;
  wallet: Address;
  /** The ArcStocks desk for trades (and a fixed placeholder for USDC payments). */
  router: Address;
  symbol: MainnetStock | typeof MAINNET_QUOTE.symbol;
  transferTo?: Address;
  side: "buy" | "sell" | "send";
  inputToken: Address;
  outputToken: Address;
  amountIn: string;
  expectedOutput: string;
  minimumOutput: string;
  estimatedFee?: string;
  deadline: number;
  steps: {
    kind: "reset" | "approve" | "trade" | "transfer";
    to: Address;
    data: Hex;
    /** Native USDC sent with the step, 18 decimals; only a desk buy sends any. */
    value?: string;
    gas: string;
    gasPrice: string;
  }[];
};
/** Exact desk calldata for a reviewed trade. Minimums are in each side's output units. */
export function deskTradeData(
  p: Pick<MainnetPlan, "side" | "symbol" | "wallet" | "amountIn" | "minimumOutput">,
) {
  const stock = MAINNET_ASSETS[p.symbol as MainnetStock].address;
  return p.side === "buy"
    ? encodeFunctionData({
        abi: deskAbi,
        functionName: "buy",
        args: [stock, BigInt(p.minimumOutput), p.wallet],
      })
    : encodeFunctionData({
        abi: deskAbi,
        functionName: "sell",
        args: [
          stock,
          BigInt(p.amountIn),
          BigInt(p.minimumOutput) * NATIVE_PER_QUOTE_UNIT,
          p.wallet,
        ],
      });
}
// Trades go through the pinned ArcStocks desk; every step's calldata is built here.
export async function prepareMainnetPlan(
  wallet: Address,
  symbol: MainnetStock,
  side: "buy" | "sell",
  amount: string,
): Promise<MainnetPlan> {
  requireTrade(isAddress(wallet) && symbol in MAINNET_ASSETS && ["buy", "sell"].includes(side));
  const c = await checkMainnetVenue();
  await verifiedMainnetRegistry();
  const stock = MAINNET_ASSETS[symbol];
  const input = side === "buy" ? MAINNET_QUOTE : stock,
    output = side === "buy" ? stock : MAINNET_QUOTE;
  requireTrade(
    new RegExp(`^(?:0|[1-9]\\d{0,3})(?:\\.\\d{1,${input.decimals}})?$`).test(amount),
    "invalid_amount",
  );
  const amountIn = parseUnits(amount, input.decimals);
  requireTrade(amountIn > 0n && amountIn <= parseUnits("1000", input.decimals), "invalid_amount");
  if (side === "buy") requireTrade(amountIn <= c.inputCap, "trade_limit_exceeded");
  // Never trade a token whose Arc supply is not fully held in the vault on Robinhood Chain.
  await verifyBacking(arc, symbol).catch((error: unknown) => {
    throw Error(error instanceof Error ? error.message : "backing_unavailable");
  });
  const quote = await deskQuote(arc, symbol, side, amountIn).catch((error: unknown) => {
    throw Error(error instanceof Error ? error.message : "desk_unavailable");
  });
  const expected = quote.amountOut,
    minimum = (expected * 99n) / 100n;
  requireTrade(minimum > 0n && (side !== "sell" || expected <= c.inputCap));
  // Refuse a desk price far from the real market.
  await fairPriceCheck(symbol, side, amountIn, expected);
  const [balance, eth, allowance, suggestedPrice, decimals, block] = await Promise.all([
    side === "buy"
      ? mainnetRpc.getBalance({ address: wallet }).then((n) => n / NATIVE_PER_QUOTE_UNIT)
      : mainnetRpc.readContract({
          address: input.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet],
        }),
    mainnetRpc.getBalance({ address: wallet }),
    side === "sell"
      ? mainnetRpc.readContract({
          address: input.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet, ARCSTOCKS_DESK],
        })
      : Promise.resolve(0n),
    mainnetRpc.getGasPrice(),
    mainnetRpc.readContract({ address: input.address, abi: erc20Abi, functionName: "decimals" }),
    mainnetRpc.getBlock(),
  ]);
  requireTrade(decimals === input.decimals && balance >= amountIn, "insufficient_tokens");
  const id = randomUUID(),
    orderId = keccak256(toBytes(`pollenstocks-arc-v1:${wallet.toLowerCase()}:${id}`));
  const steps: MainnetPlan["steps"] = [];
  requireTrade(
    typeof block.baseFeePerGas === "bigint" && block.baseFeePerGas >= 0n && suggestedPrice > 0n,
    "gas_price_unavailable",
  );
  const gasPrice = suggestedPrice > block.baseFeePerGas ? suggestedPrice : block.baseFeePerGas;
  // Reserve a modest fee allowance in the review; the runner uses the current
  // suggested price within this ceiling, rather than always charging the ceiling.
  const price = (gasPrice * 125n + 99n) / 100n;
  let estimatedFee = 0n;
  const gasLimit = (estimate: bigint) => (estimate * 125n + 99n) / 100n;
  // A sell approves the desk for exactly the shares sold. The runner simulates every step
  // immediately before sending, and never raises the reviewed limits.
  const approval = async (value: bigint, kind: "reset" | "approve") => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [ARCSTOCKS_DESK, value],
    });
    let estimate = await mainnetRpc.estimateGas({
      account: wallet,
      to: input.address,
      data,
      value: 0n,
    });
    // A subsequent zero-to-nonzero allowance write can cost more than this
    // simulation against the current nonzero allowance. Reserve conservatively.
    if (kind === "approve" && allowance > 0n && estimate < 100000n) estimate = 100000n;
    requireTrade(estimate > 0n && estimate <= 200000n, "approval_gas_unavailable");
    estimatedFee += estimate * gasPrice;
    steps.push({
      kind,
      to: input.address,
      data,
      gas: gasLimit(estimate).toString(),
      gasPrice: price.toString(),
    });
  };
  if (side === "sell") {
    if (allowance > 0n) await approval(0n, "reset");
    await approval(amountIn, "approve");
  }
  const tradeData = deskTradeData({
    side,
    symbol,
    wallet,
    amountIn: amountIn.toString(),
    minimumOutput: minimum.toString(),
  });
  const value = side === "buy" ? amountIn * NATIVE_PER_QUOTE_UNIT : 0n;
  // A buy can be simulated now; a sell cannot until its approval is mined.
  const tradeGas =
    side === "buy"
      ? await mainnetRpc.estimateGas({
          account: wallet,
          to: ARCSTOCKS_DESK,
          data: tradeData,
          value,
        })
      : DESK_TRADE_GAS;
  requireTrade(tradeGas > 0n && tradeGas <= 400000n, "swap_gas_unavailable");
  estimatedFee += tradeGas * gasPrice;
  steps.push({
    kind: "trade",
    to: ARCSTOCKS_DESK,
    data: tradeData,
    ...(value > 0n ? { value: value.toString() } : {}),
    gas: gasLimit(tradeGas).toString(),
    gasPrice: price.toString(),
  });
  const fee = steps.reduce((sum, step) => sum + BigInt(step.gas) * BigInt(step.gasPrice), 0n);
  requireTrade(c.feeCap === undefined || fee <= c.feeCap, "operator_fee_limit_exceeded");
  // Arc pays gas in USDC: a buy spends USDC for the trade and the fee from one balance.
  requireTrade(eth >= fee + value, "insufficient_eth_for_network_fee");
  const plan: MainnetPlan = {
    id,
    orderId,
    wallet,
    router: ARCSTOCKS_DESK,
    provider: "arcstocks-desk",
    symbol,
    side,
    inputToken: input.address,
    outputToken: output.address,
    amountIn: amountIn.toString(),
    expectedOutput: expected.toString(),
    minimumOutput: minimum.toString(),
    estimatedFee: estimatedFee.toString(),
    deadline: Math.floor(Date.now() / 1000) + 240,
    steps,
  };
  validateMainnetPlan(plan);
  return plan;
}
export async function prepareMainnetTransfer(
  wallet: Address,
  recipient: Address,
  amount: string,
): Promise<MainnetPlan> {
  await checkMainnetVenue();
  requireTrade(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(amount), "invalid_amount");
  const amountIn = parseUnits(amount, 6);
  requireTrade(amountIn > 0n && amountIn <= 1000_000000n, "invalid_amount");
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, amountIn],
  });
  const [balance, eth, suggestedPrice, decimals, simulated, block] = await Promise.all([
    mainnetRpc.readContract({
      address: MAINNET_QUOTE.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
    }),
    mainnetRpc.getBalance({ address: wallet }),
    mainnetRpc.getGasPrice(),
    mainnetRpc.readContract({
      address: MAINNET_QUOTE.address,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    mainnetRpc.simulateContract({
      account: wallet,
      address: MAINNET_QUOTE.address,
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, amountIn],
    }),
    mainnetRpc.getBlock(),
  ]);
  requireTrade(balance >= amountIn, "insufficient_tokens");
  requireTrade(decimals === 6 && simulated.result === true);
  const gas = await mainnetRpc.estimateGas({
    account: wallet,
    to: MAINNET_QUOTE.address,
    data,
    value: 0n,
  });
  requireTrade(
    typeof block.baseFeePerGas === "bigint" && block.baseFeePerGas >= 0n && suggestedPrice > 0n,
    "gas_price_unavailable",
  );
  const price = suggestedPrice > block.baseFeePerGas ? suggestedPrice : block.baseFeePerGas;
  requireTrade(gas > 0n && gas <= 200000n);
  const gasLimit = (gas * 125n + 99n) / 100n,
    ceiling = (price * 125n + 99n) / 100n;
  requireTrade(
    eth >= gasLimit * ceiling + amountIn * NATIVE_PER_QUOTE_UNIT,
    "insufficient_eth_for_network_fee",
  );
  const id = randomUUID();
  const plan: MainnetPlan = {
    id,
    orderId: keccak256(toBytes(`pollenstocks-arc-v1:${wallet.toLowerCase()}:${id}`)),
    wallet,
    router: ARCSTOCKS_DESK,
    symbol: MAINNET_QUOTE.symbol,
    side: "send",
    transferTo: recipient,
    inputToken: MAINNET_QUOTE.address,
    outputToken: MAINNET_QUOTE.address,
    amountIn: amountIn.toString(),
    expectedOutput: amountIn.toString(),
    minimumOutput: amountIn.toString(),
    estimatedFee: (gas * price).toString(),
    deadline: Math.floor(Date.now() / 1000) + 240,
    steps: [
      {
        kind: "transfer",
        to: MAINNET_QUOTE.address,
        data,
        gas: gasLimit.toString(),
        gasPrice: ceiling.toString(),
      },
    ],
  };
  validateMainnetPlan(plan);
  return plan;
}
export function validateMainnetPlan(p: MainnetPlan) {
  requireTrade(p.provider === undefined || p.provider === "arcstocks-desk");
  if (p.side === "send") {
    const c = mainnetTradeConfig(),
      recipient = p.transferTo;
    requireTrade(
      p.symbol === MAINNET_QUOTE.symbol && isAddress(p.wallet) && recipient && isAddress(recipient),
    );
    requireTrade(
      ![
        zeroAddress,
        p.wallet,
        MAINNET_QUOTE.address,
        ARCSTOCKS_DESK,
        ...Object.values(MAINNET_ASSETS).map((a) => a.address),
      ].some((a) => sameAddress(a, recipient)),
    );
    requireTrade(
      /^[a-f0-9-]{36}$/.test(p.id) &&
        p.orderId === keccak256(toBytes(`pollenstocks-arc-v1:${p.wallet.toLowerCase()}:${p.id}`)),
    );
    requireTrade(Number.isSafeInteger(p.deadline) && p.deadline > 0 && p.steps.length === 1);
    requireTrade(
      /^[1-9]\d{0,9}$/.test(p.amountIn) &&
        BigInt(p.amountIn) <= c.inputCap &&
        BigInt(p.amountIn) <= 1000_000000n,
    );
    requireTrade(p.expectedOutput === p.amountIn && p.minimumOutput === p.amountIn);
    requireTrade(
      sameAddress(p.inputToken, MAINNET_QUOTE.address) &&
        sameAddress(p.outputToken, MAINNET_QUOTE.address) &&
        sameAddress(p.router, ARCSTOCKS_DESK),
    );
    const step = p.steps[0];
    requireTrade(
      step.kind === "transfer" && sameAddress(step.to, MAINNET_QUOTE.address) && !step.value,
    );
    requireTrade(
      /^[1-9]\d{0,9}$/.test(step.gas) &&
        BigInt(step.gas) <= 250000n &&
        /^[1-9]\d{0,17}$/.test(step.gasPrice),
    );
    const expected = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, BigInt(p.amountIn)],
    });
    requireTrade(step.data.toLowerCase() === expected.toLowerCase());
    const fee = BigInt(step.gas) * BigInt(step.gasPrice);
    requireTrade(c.feeCap === undefined || fee <= c.feeCap);
    requireTrade(
      p.estimatedFee && /^[1-9]\d{0,30}$/.test(p.estimatedFee) && BigInt(p.estimatedFee) <= fee,
    );
    return;
  }
  const c = mainnetTradeConfig(),
    stock = MAINNET_ASSETS[p.symbol as MainnetStock];
  requireTrade(stock && ["buy", "sell"].includes(p.side) && isAddress(p.wallet));
  requireTrade(p.provider === "arcstocks-desk");
  requireTrade(
    /^[a-f0-9-]{36}$/.test(p.id) &&
      p.orderId === keccak256(toBytes(`pollenstocks-arc-v1:${p.wallet.toLowerCase()}:${p.id}`)),
  );
  requireTrade(Number.isSafeInteger(p.deadline) && p.deadline > 0);
  requireTrade(BigInt(p.amountIn) <= (p.side === "buy" ? 1000_000000n : 1000n * 10n ** 18n));
  requireTrade(
    sameAddress(p.router, ARCSTOCKS_DESK) &&
      sameAddress(p.inputToken, p.side === "buy" ? MAINNET_QUOTE.address : stock.address) &&
      sameAddress(p.outputToken, p.side === "buy" ? stock.address : MAINNET_QUOTE.address),
  );
  requireTrade(
    BigInt(p.amountIn) > 0n &&
      BigInt(p.minimumOutput) > 0n &&
      BigInt(p.minimumOutput) === (BigInt(p.expectedOutput) * 99n) / 100n,
  );
  requireTrade((p.side === "buy" ? BigInt(p.amountIn) : BigInt(p.expectedOutput)) <= c.inputCap);
  // A buy is one payable desk call; a sell is an exact approval (after a reset) then the call.
  const kinds =
    p.side === "buy"
      ? ["trade"]
      : p.steps.length === 3
        ? ["reset", "approve", "trade"]
        : ["approve", "trade"];
  requireTrade(p.steps.length === kinds.length);
  let fees = 0n;
  p.steps.forEach((step, index) => {
    requireTrade(
      step.kind === kinds[index] &&
        /^[1-9]\d{0,9}$/.test(step.gas) &&
        /^[1-9]\d{0,17}$/.test(step.gasPrice),
    );
    fees += BigInt(step.gas) * BigInt(step.gasPrice);
    if (step.kind !== "trade") {
      requireTrade(!step.value);
      const call = decodeFunctionData({ abi: erc20Abi, data: step.data });
      requireTrade(sameAddress(step.to, p.inputToken) && call.functionName === "approve");
      requireTrade(
        sameAddress(call.args[0], ARCSTOCKS_DESK) &&
          call.args[1] === (step.kind === "reset" ? 0n : BigInt(p.amountIn)),
      );
    } else {
      requireTrade(sameAddress(step.to, ARCSTOCKS_DESK));
      requireTrade(step.data.toLowerCase() === deskTradeData(p).toLowerCase());
      const value = p.side === "buy" ? BigInt(p.amountIn) * NATIVE_PER_QUOTE_UNIT : 0n;
      requireTrade((step.value ? BigInt(step.value) : 0n) === value);
    }
  });
  requireTrade(c.feeCap === undefined || fees <= c.feeCap);
  if (p.estimatedFee !== undefined)
    requireTrade(/^[1-9]\d{0,30}$/.test(p.estimatedFee) && BigInt(p.estimatedFee) <= fees);
}
