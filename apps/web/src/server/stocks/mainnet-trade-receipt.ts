import { erc20Abi, parseEventLogs, type Log } from "viem";
import { NATIVE_PER_QUOTE_UNIT, NATIVE_TRANSFER_LOGGER } from "../networks/chain";
import { deskAbi } from "./arcstocks-desk";
import { requireTrade as ensure, sameAddress as same, type MainnetPlan } from "./mainnet-trade";

const sum = (values: bigint[]) => values.reduce((n, v) => n + v, 0n);
/**
 * Verify a desk trade receipt: exactly one Bought or Sold event for this wallet and stock, and
 * token movements that match it. Returns stock tokens bought (18 decimals) or USDC received
 * (6 decimals, rounded down).
 */
export function mainnetTradeOutput(p: MainnetPlan, logs: Log[]): bigint {
  const buy = p.side === "buy";
  const stock = buy ? p.outputToken : p.inputToken;
  const deskLogs = logs.filter((l) => same(l.address, p.router));
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs });
  const moved = (token: string, from: string, to: string) =>
    sum(
      transfers
        .filter((t) => same(t.address, token) && same(t.args.from, from) && same(t.args.to, to))
        .map((t) => t.args.value),
    );
  const stockFromWallet = sum(
    transfers
      .filter((t) => same(t.address, stock) && same(t.args.from, p.wallet))
      .map((t) => t.args.value),
  );
  if (buy) {
    const events = parseEventLogs({ abi: deskAbi, eventName: "Bought", logs: deskLogs });
    ensure(events.length === 1);
    const e = events[0].args;
    ensure(
      same(e.stock, stock) &&
        same(e.buyer, p.wallet) &&
        same(e.to, p.wallet) &&
        e.usdcIn === BigInt(p.amountIn) * NATIVE_PER_QUOTE_UNIT &&
        e.sharesOut >= BigInt(p.minimumOutput),
    );
    ensure(
      moved(stock, p.router, p.wallet) === e.sharesOut &&
        stockFromWallet === 0n &&
        moved(NATIVE_TRANSFER_LOGGER, p.wallet, p.router) === e.usdcIn,
    );
    return e.sharesOut;
  }
  const events = parseEventLogs({ abi: deskAbi, eventName: "Sold", logs: deskLogs });
  ensure(events.length === 1);
  const e = events[0].args;
  ensure(
    same(e.stock, stock) &&
      same(e.seller, p.wallet) &&
      same(e.to, p.wallet) &&
      e.sharesIn === BigInt(p.amountIn) &&
      e.usdcOut >= BigInt(p.minimumOutput) * NATIVE_PER_QUOTE_UNIT,
  );
  ensure(
    stockFromWallet === BigInt(p.amountIn) &&
      moved(stock, p.wallet, p.router) === BigInt(p.amountIn) &&
      moved(NATIVE_TRANSFER_LOGGER, p.router, p.wallet) === e.usdcOut,
  );
  return e.usdcOut / NATIVE_PER_QUOTE_UNIT;
}
