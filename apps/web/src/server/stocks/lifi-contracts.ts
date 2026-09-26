import {
  decodeFunctionData,
  encodeFunctionData,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

// LI.FI deployment manifest: lifinance/contracts/deployments/robinhood.json.
export const LIFI_ROUTER = "0xB477751B76CF82d00a686A1232f5fCD772414Af3" as const;
export const LIFI_FACET = "0xB129ce9C3fCD55726Ff314a2764d3937FA496071" as const;
export const LIFI_FEE_FORWARDER = "0xF4BFFE4dfC693f37715A47c15BdA8af9ed8f7Cf1" as const;
export const NORDSTERN_ROUTER = "0x603206D6105217DD972E4Ab30676A220CA393346" as const;
export const NORDSTERN_EXECUTOR = "0x2ca37ff95caf25366ef16fc2e655b78a165d125f" as const;
export const LIFI_FEE_RECIPIENT = "0xc06ebbefd94032b85424d51906e2a335efae264b" as const;
export const LIFI_SELECTOR = "0x5fd9ae2e" as const;
export const LIFI_FUNCTION = "swapTokensMultipleV3ERC20ToERC20" as const;
// Runtime bytecode observed on chain 4663 on 2026-09-25. Never learn pins from quotes.
export const LIFI_CODE_PINS: readonly (readonly [Address, Hex])[] = [
  [LIFI_ROUTER, "0xca0fd158089c97d9e77828a4254bc7037be8ee6f784e45d80204df0e56013101"],
  [LIFI_FACET, "0xdb3f706ca7f78237a197ccab9300628db168f0bc6c509835771200f9c163daa5"],
  [LIFI_FEE_FORWARDER, "0x7ee455a6853068874bfd201f93d6383ed6d88934a922316db5575b057e2ebe74"],
  [NORDSTERN_ROUTER, "0x5c9dd55aa2b736702f8cc44aef400fca06ea1b708f35f32978bc4ba37ec4d30f"],
  [NORDSTERN_EXECUTOR, "0x56bb014a053e10949003ac985e730a9e51e18f4734ad492841824941020ab20a"],
];
export const lifiRouterAbi = parseAbi([
  "struct SwapData { address callTo; address approveTo; address sendingAssetId; address receivingAssetId; uint256 fromAmount; bytes callData; bool requiresDeposit; }",
  "function swapTokensMultipleV3ERC20ToERC20(bytes32 transactionId,string integrator,string referrer,address receiver,uint256 minAmountOut,SwapData[] swapData)",
  "event LiFiGenericSwapCompleted(bytes32 indexed transactionId,string integrator,string referrer,address receiver,address fromAssetId,address toAssetId,uint256 fromAmount,uint256 toAmount)",
]);
export const lifiFeeAbi = parseAbi([
  "struct FeeDistribution { address recipient; uint256 amount; }",
  "function forwardERC20Fees(address token,FeeDistribution[] distributions)",
]);
export const lifiLoupeAbi = parseAbi([
  "function facetAddress(bytes4 selector) view returns (address)",
]);
export function lifiEnsure(ok: unknown, code = "lifi_validation_failed"): asserts ok {
  if (!ok) throw Error(code);
}
export const lifiSame = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export type LifiTerms = {
  wallet: Address;
  inputToken: Address;
  outputToken: Address;
  amountIn: string;
  minimumOutput: string;
  providerFee: { amount: string; token: Address };
  providerTransactionId: Hex;
};
/** Only the reviewed fee + Nordstern ERC20 route shape is supported. No bridges. */
export function validateLifiCall(p: LifiTerms, data: Hex) {
  const call = decodeFunctionData({ abi: lifiRouterAbi, data });
  lifiEnsure(call.functionName === LIFI_FUNCTION);
  lifiEnsure(
    encodeFunctionData({
      abi: lifiRouterAbi,
      functionName: LIFI_FUNCTION,
      args: call.args,
    }).toLowerCase() === data.toLowerCase(),
  );
  const [id, integrator, referrer, receiver, minimum, swaps] = call.args;
  lifiEnsure(id === p.providerTransactionId && /^0x[0-9a-f]{64}$/i.test(id));
  lifiEnsure(
    integrator === "steward-pay" && referrer === zeroAddress && lifiSame(receiver, p.wallet),
  );
  lifiEnsure(minimum === BigInt(p.minimumOutput) && minimum > 0n && swaps.length === 2);
  const [fee, swap] = swaps,
    input = BigInt(p.amountIn),
    feeAmount = BigInt(p.providerFee.amount);
  lifiEnsure(
    input > 0n && feeAmount > 0n && feeAmount * 10000n <= input * 25n,
    "lifi_fee_limit_exceeded",
  );
  lifiEnsure(lifiSame(p.providerFee.token, p.inputToken));
  lifiEnsure(
    lifiSame(fee.callTo, LIFI_FEE_FORWARDER) && lifiSame(fee.approveTo, LIFI_FEE_FORWARDER),
  );
  lifiEnsure(
    lifiSame(fee.sendingAssetId, p.inputToken) &&
      lifiSame(fee.receivingAssetId, p.inputToken) &&
      fee.fromAmount === input &&
      fee.requiresDeposit,
  );
  const feeCall = decodeFunctionData({ abi: lifiFeeAbi, data: fee.callData });
  lifiEnsure(
    encodeFunctionData({
      abi: lifiFeeAbi,
      functionName: "forwardERC20Fees",
      args: feeCall.args,
    }).toLowerCase() === fee.callData.toLowerCase(),
  );
  const [feeToken, distributions] = feeCall.args;
  lifiEnsure(
    lifiSame(feeToken, p.inputToken) &&
      distributions.length === 1 &&
      lifiSame(distributions[0].recipient, LIFI_FEE_RECIPIENT) &&
      distributions[0].amount === feeAmount,
  );
  lifiEnsure(lifiSame(swap.callTo, NORDSTERN_ROUTER) && lifiSame(swap.approveTo, NORDSTERN_ROUTER));
  lifiEnsure(
    lifiSame(swap.sendingAssetId, p.inputToken) &&
      lifiSame(swap.receivingAssetId, p.outputToken) &&
      swap.fromAmount === input - feeAmount &&
      !swap.requiresDeposit,
  );
  // Byte offsets from exact-match Sourcify AggregatorGuard source, chain 4663.
  // The remaining pool instruction stream is trusted to the pinned executor,
  // while the guard enforces token/recipient/minimum; this is not an executor audit.
  const packed = swap.callData;
  lifiEnsure(
    /^0x3f0bde25[0-9a-f]+$/i.test(packed) && packed.length >= 280 && packed.length <= 100002,
  );
  const part = (start: number, end: number) => `0x${packed.slice(2 + start * 2, 2 + end * 2)}`;
  lifiEnsure(
    lifiSame(part(6, 26), NORDSTERN_EXECUTOR) && lifiSame(part(59, 79), NORDSTERN_EXECUTOR),
  );
  lifiEnsure(
    BigInt(part(26, 42)) === input - feeAmount &&
      BigInt(part(42, 58)) >= minimum &&
      BigInt(part(42, 58)) <= minimum + 1n,
  );
  lifiEnsure(
    lifiSame(part(79, 99), LIFI_ROUTER) &&
      lifiSame(part(99, 119), p.inputToken) &&
      lifiSame(part(119, 139), p.outputToken),
  );
  // V3 has no on-chain deadline; application review expiry gates every submission.
}
