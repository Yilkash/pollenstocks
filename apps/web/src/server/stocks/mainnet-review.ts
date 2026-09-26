import { formatEther, formatUnits } from "viem";
import { MAINNET_ASSETS, type MainnetStock } from "../networks/robinhood";
import type { MainnetPlan } from "./mainnet-trade";

// BigInt only: abbreviated outputs round down, displayed fee ceilings round up.
function shortAmount(raw: string, decimals: number, roundUp = false) {
  const value = BigInt(raw);
  const discarded = Math.max(0, value.toString().length - 6);
  const scale = 10n ** BigInt(discarded);
  const rounded = (roundUp ? (value + scale - 1n) / scale : value / scale) * scale;
  return formatUnits(rounded, decimals);
}
const feeCeiling = (p: MainnetPlan) =>
  p.steps.reduce((sum, step) => sum + BigInt(step.gas) * BigInt(step.gasPrice), 0n);
const expiry = (p: MainnetPlan) => new Date(p.deadline * 1000).toISOString().slice(11, 19) + " UTC";

export function mainnetTradeReviewText(p: MainnetPlan) {
  const buy = p.side === "buy",
    inputDecimals = buy ? 6 : 18,
    outputDecimals = buy ? 18 : 6;
  const inputUnit = buy ? "USDG" : `${p.symbol} tokens`,
    outputUnit = buy ? `${p.symbol} tokens` : "USDG";
  const company = MAINNET_ASSETS[p.symbol as MainnetStock].name;
  return [
    `*${buy ? "Buy" : "Sell"} ${company} (${p.symbol})*`,
    "Robinhood mainnet",
    "",
    `${buy ? "Pay" : "Sell"}: ${formatUnits(BigInt(p.amountIn), inputDecimals)} ${inputUnit}`,
    `Receive: ≈ ${shortAmount(p.expectedOutput, outputDecimals)} ${outputUnit}`,
    `Minimum: ${shortAmount(p.minimumOutput, outputDecimals)} ${outputUnit}`,
    ...(p.providerFee
      ? [
          `LI.FI fee: ${formatUnits(BigInt(p.providerFee.amount), inputDecimals)} ${buy ? "USDG" : p.symbol} (included)`,
        ]
      : []),
    `Network fee: up to ${shortAmount(feeCeiling(p).toString(), 18, true)} ETH`,
    `Expires: ${expiry(p)}`,
    "",
    "Includes token approval. Failed trades may still cost gas.",
  ].join("\n");
}
export function mainnetTradeDetailsText(p: MainnetPlan) {
  const buy = p.side === "buy",
    inputDecimals = buy ? 6 : 18,
    outputDecimals = buy ? 18 : 6;
  return [
    `*${buy ? "Buy" : "Sell"} ${p.symbol} · Details*`,
    `Provider: ${p.provider === "lifi" ? "LI.FI" : "KyberSwap"}`,
    `Input: ${formatUnits(BigInt(p.amountIn), inputDecimals)} ${buy ? "USDG" : p.symbol}`,
    `Estimated receive: ${formatUnits(BigInt(p.expectedOutput), outputDecimals)} ${buy ? p.symbol : "USDG"}`,
    `Minimum receive: ${formatUnits(BigInt(p.minimumOutput), outputDecimals)} ${buy ? p.symbol : "USDG"}`,
    "Price tolerance: 1%",
    "",
    ...(p.providerFee
      ? [
          `Provider fee: ${formatUnits(BigInt(p.providerFee.amount), inputDecimals)} ${buy ? "USDG" : p.symbol} (included in input)`,
        ]
      : []),
    `Estimated network fee: ${formatEther(BigInt(p.estimatedFee ?? feeCeiling(p).toString()))} ETH`,
    `Maximum network fee: ${formatEther(feeCeiling(p))} ETH`,
    "Network fees cover approvals and swap; you pay only gas used.",
    `Expires: ${expiry(p)}`,
    "",
    `Confirm authorizes ${p.steps.length} transactions with real assets, including exact token approval. Failed trades can cost gas and leave an approval.`,
    "The short review rounds received amounts down and the fee ceiling up. Exact amounts are shown here.",
    "",
    "Use Confirm or Cancel on the original review. Viewing details does not confirm or extend it.",
  ].join("\n");
}
