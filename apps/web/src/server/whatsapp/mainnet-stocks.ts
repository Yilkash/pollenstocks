import { ensureMainnetWallet } from "../stocks/mainnet-wallet";
import { mainnetWallet } from "../stocks/mainnet-orders";
import type { DatabaseSync } from "node:sqlite";
import { formatEther, formatUnits, getAddress } from "viem";
import { MAINNET_ASSETS, MAINNET_EXECUTION_READY, type MainnetStock } from "../networks/chain";
import {
  MainnetReadError,
  mainnetPortfolio,
  mainnetPrice,
  verifiedMainnetRegistry,
} from "../stocks/mainnet";
import { text } from "./menu";
import {
  mainnetReferencePrice,
  ReferencePriceError,
  referenceDollars,
} from "../stocks/reference-price";

export const mainnetTradingMessage = () =>
  MAINNET_EXECUTION_READY && process.env.MAINNET_STOCK_TRADING_ENABLED === "true"
    ? "Trades need your confirmation."
    : "Trading is currently disabled.";

function priceAge(asOf: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - asOf) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export async function mainnetReferencePriceReply(symbol?: MainnetStock, forceRefresh = false) {
  const symbols = symbol ? [symbol] : (Object.keys(MAINNET_ASSETS) as MainnetStock[]);
  const lines = await Promise.all(
    symbols.map(async (ticker) => {
      try {
        const price = await mainnetReferencePrice(ticker, forceRefresh);
        const status = price.cachedFallback
          ? "; saved price — refresh temporarily unavailable"
          : Date.now() - price.asOf > price.heartbeatMs
            ? "; older reference — not a live quote"
            : "";
        return `${MAINNET_ASSETS[ticker].name} (${ticker}): *≈ ${referenceDollars(price.value, price.decimals)} / token*\nUpdated ${priceAge(price.asOf)}${status}`;
      } catch (error) {
        const code = error instanceof ReferencePriceError ? error.code : "source_unavailable";
        console.warn("Stock reference price unavailable", { symbol: ticker, code });
        const reason =
          code === "provider_busy"
            ? "price provider temporarily busy"
            : code === "oracle_paused" || code === "trading_halted"
              ? "pricing paused for this asset"
              : code === "observation_too_old"
                ? "latest reference is too old to show"
                : code === "asset_changed" || code === "invalid_data"
                  ? "could not verify the price data"
                  : "price sources temporarily unreachable";
        return `${ticker}: price unavailable (${reason})`;
      }
    }),
  );
  return text(
    "📈 *Stock token prices · USD*\n\n" +
      lines.join("\n\n") +
      "\n\nEstimated prices. Your final quote, including fees, appears before you confirm." +
      "\nReply ‘try again’ to refresh, or ‘all’ for every stock.",
  );
}

export async function mainnetStockListReply() {
  try {
    await verifiedMainnetRegistry();
    return text(
      "Stock tokens on Arc\n\n" +
        Object.entries(MAINNET_ASSETS)
          .map(([symbol, a]) => `• ${a.name} (${symbol})`)
          .join("\n") +
        "\n\nAsk for prices, your holdings, or a trade.\n" +
        mainnetTradingMessage(),
    );
  } catch {
    return text(
      "I couldn’t verify the mainnet token registry right now. Please try again. No transaction was submitted.",
    );
  }
}
export async function mainnetPortfolioReply(db: DatabaseSync, account: string) {
  const read = () => {
    const trading = mainnetWallet(db, account);
    if (trading) return { status: "active", address: trading.address };
    return undefined;
  };
  const wallet = read();
  if (wallet?.status !== "active" || !wallet.address)
    return text("Ask ‘Show my mainnet wallet’ to set up your mainnet wallet first.");
  try {
    const result = await mainnetPortfolio(getAddress(wallet.address));
    const current = read();
    if (current?.status !== "active" || current.address !== wallet.address)
      return text("Your account changed. Please request the portfolio again.");
    // List held stocks only; the catalogue is long and zero rows add noise.
    const stocks = result.balances.filter((a) => a.symbol !== "USDC" && a.formatted !== "0");
    const usdg = result.balances.find((a) => a.symbol === "USDC");
    const stockLines = stocks.length
      ? stocks.map((a) => `${a.symbol}: ${a.formatted} tokens`).join("\n")
      : "No stock tokens yet.";
    return text(
      `Your Pollenstocks holdings · Arc\n\n${stockLines}\nUSDC: ${usdg?.formatted ?? "0"}\n\nWallet: ${wallet.address}\nStock quantities shown are raw token balances.`,
    );
  } catch (error) {
    console.warn("Balance read failed", {
      reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      cause:
        error instanceof Error && error.cause instanceof Error
          ? error.cause.message.slice(0, 200)
          : null,
    });
    return text(
      "I couldn’t read reliable mainnet balances right now. Please try again. No transaction was submitted.",
    );
  }
}
export async function mainnetPriceReply(
  symbol: MainnetStock,
  side: "buy" | "sell",
  amount: string,
) {
  try {
    const p = await mainnetPrice(symbol, side, amount);
    return text(
      `${symbol} · ${side} preview\nArc\n\nSpend: ${formatUnits(p.sellAmount, p.sellDecimals)} ${side === "buy" ? "USDC" : symbol}\nEstimated receive: ${formatUnits(p.buyAmount, p.buyDecimals)} ${side === "buy" ? symbol : "USDC"}\n${p.networkFeeUsd && Number(p.networkFeeUsd) > 0 ? `Estimated network fee: $${Number(p.networkFeeUsd).toFixed(4)}` : "Network fee calculated at trade review"}\n\n${p.provider} · ${new Date(Number(p.timestamp) * 1000).toISOString().slice(11, 19)} UTC\nEstimate only; no trade created.`,
    );
  } catch (error) {
    const code = error instanceof MainnetReadError ? error.code : "unavailable";
    if (code === "quote_busy")
      return text(
        "The price provider is temporarily busy. Please request the preview again shortly. No order was created.",
      );
    if (code === "no_liquidity")
      return text(
        "The provider returned no mainnet liquidity for this pair and amount. No order was created.",
      );
    if (code === "invalid_amount")
      return text(
        "Give a positive input amount up to 1,000: USDC for a buy, or stock-token quantity for a sell. USDC supports 6 decimal places; stock tokens support 18.",
      );
    return text(
      "I couldn’t get a verified mainnet price preview. The service or requested route may be unavailable. No order was created.",
    );
  }
}

export async function mainnetReceiveReply(db: DatabaseSync, account: string) {
  try {
    const wallet = await ensureMainnetWallet(db, account);
    return text(
      `💵 *How to add money*\n\nSend *USDC on the Arc network* to your Pollenstocks wallet:\n\n${wallet.address}\n\n*Already have USDC on another network* (Base, Arbitrum, Ethereum…)? Move it to Arc with a bridge such as Circle's (CCTP) or relay.link. Choose *Arc* as the destination and paste the address above.\n\n*From an exchange?* Withdraw USDC and pick the *Arc* network if it is offered; if not, withdraw to another network and bridge it.\n\n⚠️ Only USDC on Arc (chain 5042). Other coins or networks can be lost.\nUSDC also pays the tiny network fee, so it is the only coin you need. Start with a few dollars, then say “Buy NVIDIA with 1 USDC”.`,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "mainnet_policy_required")
      return text("Mainnet wallet setup is not available yet. Your testnet wallet is separate.");
    if (code === "account_not_active")
      return text("An active Pollenstocks account is required. Type Menu to get started.");
    return text(
      "I couldn’t finish checking your mainnet wallet. Ask ‘Show my mainnet wallet’ again shortly. No funds were sent.",
    );
  }
}
