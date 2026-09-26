import { z } from "zod";
import { isAddress, type Address, type Hex } from "viem";
import { MAINNET_ASSETS, MAINNET_USDG } from "../networks/robinhood";
import {
  LIFI_ROUTER,
  NORDSTERN_ROUTER,
  LIFI_FEE_FORWARDER,
  lifiEnsure as ensure,
  lifiSame as same,
  validateLifiCall,
} from "./lifi-contracts";

export type PreparedMainnetQuote = {
  provider: "kyber" | "lifi";
  router: Address;
  data: Hex;
  expectedOutput: string;
  minimumOutput: string;
  swapGas: string;
  deadline: number;
  providerFee?: { amount: string; token: Address };
  providerTransactionId?: Hex;
};
export type QuoteInput = {
  wallet: Address;
  inputToken: Address;
  outputToken: Address;
  amountIn: string;
};
const address = z.string().refine(isAddress);
const uint = z.string().regex(/^\d{1,78}$/);
const token = z.object({ address, chainId: z.literal(4663), decimals: z.number().int() });
const action = z.object({
  fromChainId: z.literal(4663),
  toChainId: z.literal(4663),
  fromToken: token,
  toToken: token,
  fromAmount: uint,
  fromAddress: address,
  toAddress: address,
  slippage: z.literal(0.01),
});
const fee = z.object({ token, amount: uint, included: z.literal(true) });
const quoteSchema = z.object({
  type: z.literal("lifi"),
  tool: z.literal("nordstern"),
  integrator: z.literal("steward-pay"),
  transactionId: z.string().regex(/^0x[0-9a-f]{64}$/i),
  action,
  estimate: z.object({
    tool: z.literal("nordstern"),
    fromAmount: uint,
    toAmount: uint,
    toAmountMin: uint,
    approvalAddress: address,
    feeCosts: z.array(fee).length(1),
    gasCosts: z.array(z.object({ type: z.literal("SEND"), estimate: uint })).length(1),
  }),
  includedSteps: z
    .array(
      z.object({
        type: z.enum(["protocol", "swap"]),
        tool: z.enum(["feeCollection", "nordstern"]),
        action,
        includedSteps: z.never().optional(),
        estimate: z.object({
          fromAmount: uint,
          toAmount: uint,
          toAmountMin: uint,
          approvalAddress: address,
          feeCosts: z.array(fee),
        }),
      }),
    )
    .length(2),
  transactionRequest: z.object({
    from: address,
    to: address,
    chainId: z.literal(4663),
    value: z.string().regex(/^(0x0+|0)$/),
    data: z
      .string()
      .regex(/^0x(?:[0-9a-f]{2})+$/i)
      .max(200000),
  }),
});
export function parseLifiQuote(
  raw: unknown,
  p: QuoteInput,
  requestedAt: number,
): PreparedMainnetQuote {
  ensure(Date.now() - requestedAt <= 30000 && requestedAt <= Date.now(), "route_expired");
  const q = quoteSchema.parse(raw),
    a = q.action,
    e = q.estimate,
    tx = q.transactionRequest;
  const tokens = [MAINNET_USDG, ...Object.values(MAINNET_ASSETS)];
  const checkToken = (t: z.infer<typeof token>, wanted: string) => {
    ensure(
      same(t.address, wanted) &&
        tokens.some((x) => same(x.address, wanted) && x.decimals === t.decimals),
    );
  };
  ensure(same(p.inputToken, MAINNET_USDG.address) !== same(p.outputToken, MAINNET_USDG.address));
  checkToken(a.fromToken, p.inputToken);
  checkToken(a.toToken, p.outputToken);
  ensure(
    same(a.fromAddress, p.wallet) &&
      same(a.toAddress, p.wallet) &&
      a.fromAmount === p.amountIn &&
      e.fromAmount === p.amountIn,
  );
  ensure(
    same(tx.from, p.wallet) && same(tx.to, LIFI_ROUTER) && same(e.approvalAddress, LIFI_ROUTER),
  );
  const f = e.feeCosts[0];
  checkToken(f.token, p.inputToken);
  const net = BigInt(p.amountIn) - BigInt(f.amount);
  const [feeStep, swapStep] = q.includedSteps;
  for (const step of q.includedSteps) {
    ensure(same(step.action.fromAddress, LIFI_ROUTER) && same(step.action.toAddress, LIFI_ROUTER));
    checkToken(step.action.fromToken, p.inputToken);
  }
  ensure(
    feeStep.tool === "feeCollection" &&
      feeStep.type === "protocol" &&
      same(feeStep.estimate.approvalAddress, LIFI_FEE_FORWARDER),
  );
  checkToken(feeStep.action.toToken, p.inputToken);
  ensure(
    feeStep.action.fromAmount === p.amountIn &&
      feeStep.estimate.fromAmount === p.amountIn &&
      BigInt(feeStep.estimate.toAmount) === net &&
      BigInt(feeStep.estimate.toAmountMin) === net,
  );
  ensure(
    feeStep.estimate.feeCosts.length === 1 && feeStep.estimate.feeCosts[0].amount === f.amount,
  );
  checkToken(feeStep.estimate.feeCosts[0].token, p.inputToken);
  ensure(
    swapStep.tool === "nordstern" &&
      swapStep.type === "swap" &&
      same(swapStep.estimate.approvalAddress, NORDSTERN_ROUTER),
  );
  checkToken(swapStep.action.toToken, p.outputToken);
  ensure(
    BigInt(swapStep.action.fromAmount) === net &&
      BigInt(swapStep.estimate.fromAmount) === net &&
      swapStep.estimate.toAmount === e.toAmount &&
      swapStep.estimate.toAmountMin === e.toAmountMin &&
      swapStep.estimate.feeCosts.length === 0,
  );
  // LI.FI rounds to an integer unit; never accept less than floor(99% output).
  ensure(
    BigInt(e.toAmountMin) >= (BigInt(e.toAmount) * 99n) / 100n &&
      BigInt(e.toAmountMin) <= (BigInt(e.toAmount) * 99n) / 100n + 1n &&
      BigInt(e.toAmountMin) > 0n,
  );
  const result: PreparedMainnetQuote = {
    provider: "lifi",
    router: LIFI_ROUTER,
    data: tx.data as Hex,
    expectedOutput: e.toAmount,
    minimumOutput: e.toAmountMin,
    swapGas: e.gasCosts[0].estimate,
    deadline: Math.floor(requestedAt / 1000) + 240,
    providerFee: { amount: f.amount, token: p.inputToken },
    providerTransactionId: q.transactionId as Hex,
  };
  validateLifiCall(
    {
      ...p,
      minimumOutput: result.minimumOutput,
      providerFee: result.providerFee!,
      providerTransactionId: result.providerTransactionId!,
    },
    result.data,
  );
  return result;
}
export async function prepareLifiQuote(p: QuoteInput): Promise<PreparedMainnetQuote> {
  const query = new URLSearchParams({
    fromChain: "4663",
    toChain: "4663",
    fromToken: p.inputToken,
    toToken: p.outputToken,
    fromAmount: p.amountIn,
    fromAddress: p.wallet,
    toAddress: p.wallet,
    slippage: "0.01",
    integrator: "steward-pay",
    allowExchanges: "nordstern",
    denyExchanges: "kyberswap",
  });
  const requestedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`https://li.quest/v1/quote?${query}`, {
      signal: AbortSignal.timeout(12000),
      redirect: "error",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    throw Error("lifi_quote_unavailable");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Error("lifi_quote_unavailable");
  }
  return parseLifiQuote(await response.json(), p, requestedAt);
}
