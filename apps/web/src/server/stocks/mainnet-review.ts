import { formatEther, formatUnits } from "viem";
import {
  MAINNET_ASSETS,
  MAINNET_NATIVE_SYMBOL,
  MAINNET_NETWORK_NAME,
  MAINNET_QUOTE,
  type MainnetStock,
} from "../networks/chain";
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
  const inputUnit = buy ? MAINNET_QUOTE.symbol : `${p.symbol} tokens`,
    outputUnit = buy ? `${p.symbol} tokens` : MAINNET_QUOTE.symbol;
  const company = MAINNET_ASSETS[p.symbol as MainnetStock].name;
  return [
    `*${buy ? "Buy" : "Sell"} ${company} (${p.symbol})*`,
    MAINNET_NETWORK_NAME,
    "",
    `${buy ? "Pay" : "Sell"}: ${formatUnits(BigInt(p.amountIn), inputDecimals)} ${inputUnit}`,
    `Receive: ≈ ${shortAmount(p.expectedOutput, outputDecimals)} ${outputUnit}`,
    `Minimum: ${shortAmount(p.minimumOutput, outputDecimals)} ${outputUnit}`,
    `Network fee: up to ${shortAmount(feeCeiling(p).toString(), 18, true)} ${MAINNET_NATIVE_SYMBOL}`,
    `Expires: ${expiry(p)}`,
    "",
    // The plan is only built after the vault check passes (stocks/backing.ts).
    "✅ Backed 1:1: vault verified on Robinhood Chain",
    buy
      ? "One transaction. Failed trades may still cost gas."
      : "Includes token approval. Failed trades may still cost gas.",
  ].join("\n");
}
export function mainnetTradeDetailsText(p: MainnetPlan) {
  const buy = p.side === "buy",
    inputDecimals = buy ? 6 : 18,
    outputDecimals = buy ? 18 : 6;
  return [
    `*${buy ? "Buy" : "Sell"} ${p.symbol} · Details*`,
    "Venue: ArcStocks desk on Arc",
    "Backing: the token's Arc supply is held 1:1 in ArcStocks' vault on Robinhood Chain, checked before review and again before sending",
    `Input: ${formatUnits(BigInt(p.amountIn), inputDecimals)} ${buy ? MAINNET_QUOTE.symbol : p.symbol}`,
    `Estimated receive: ${formatUnits(BigInt(p.expectedOutput), outputDecimals)} ${buy ? p.symbol : MAINNET_QUOTE.symbol}`,
    `Minimum receive: ${formatUnits(BigInt(p.minimumOutput), outputDecimals)} ${buy ? p.symbol : MAINNET_QUOTE.symbol}`,
    "Price tolerance: 1%",
    "",
    `Estimated network fee: ${formatEther(BigInt(p.estimatedFee ?? feeCeiling(p).toString()))} ${MAINNET_NATIVE_SYMBOL}`,
    `Maximum network fee: ${formatEther(feeCeiling(p))} ${MAINNET_NATIVE_SYMBOL}`,
    buy
      ? "You pay only the gas used."
      : "Network fees cover the approval and the sale; you pay only gas used.",
    `Expires: ${expiry(p)}`,
    "",
    buy
      ? "Confirm authorizes 1 transaction with real assets. Failed trades can cost gas."
      : `Confirm authorizes ${p.steps.length} transactions with real assets, including exact token approval. Failed trades can cost gas and leave an approval.`,
    "The short review rounds received amounts down and the fee ceiling up. Exact amounts are shown here.",
    "",
    "Use Confirm or Cancel on the original review. Viewing details does not confirm or extend it.",
  ].join("\n");
}
