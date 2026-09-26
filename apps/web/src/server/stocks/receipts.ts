import {
  erc20Abi,
  parseEventLogs,
  type Hex,
  type Transaction,
  type TransactionReceipt,
} from "viem";
import { EXCHANGE, USDG } from "./market";
import { stockAdapterAbi, type StockTradePlan } from "./trade-plan";
const same = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
function check(value: unknown): asserts value {
  if (!value) throw Error("stock_receipt_mismatch");
}

// Pure verification only; caller fetches transaction, receipt, canonical receipt
// block hash and head from the verified chain. A timeout is never a failed trade.
export function verifyStockStepReceipt(
  plan: StockTradePlan,
  position: number,
  nonce: number,
  transaction: Transaction,
  receipt: TransactionReceipt,
  canonicalBlockHash: Hex,
  head: bigint,
) {
  const step = plan.steps[position];
  check(step && Number.isSafeInteger(nonce) && nonce >= 0);
  check(plan.chainId === 46630 && transaction.chainId === 46630);
  check(same(transaction.from, plan.wallet) && same(transaction.to, step.to));
  check(
    transaction.input.toLowerCase() === step.data.toLowerCase() &&
      transaction.value === 0n &&
      transaction.nonce === nonce,
  );
  check(
    same(receipt.transactionHash, transaction.hash) &&
      same(receipt.from, plan.wallet) &&
      same(receipt.to, step.to),
  );
  check(
    transaction.blockHash === receipt.blockHash && transaction.blockNumber === receipt.blockNumber,
  );
  check(receipt.blockHash === canonicalBlockHash && head >= receipt.blockNumber + 1n);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  if (receipt.status === "reverted") return { status: "reverted" as const, fee, amountOut: 0n };
  check(receipt.status === "success");
  if (step.kind !== "trade") {
    const approvals = parseEventLogs({
      abi: erc20Abi,
      eventName: "Approval",
      strict: true,
      logs: receipt.logs.filter((log) => same(log.address, plan.inputToken)),
    });
    const matching = approvals.filter(
      (event) => same(event.args.owner, plan.wallet) && same(event.args.spender, plan.adapter),
    );
    check(
      matching.length === 1 &&
        matching[0].args.value === (step.kind === "reset_allowance" ? 0n : BigInt(plan.amountIn)),
    );
    return { status: "confirmed" as const, fee, amountOut: 0n };
  }
  const buy = same(plan.inputToken, USDG);
  const stock = buy ? plan.outputToken : plan.inputToken;
  const events = parseEventLogs({
    abi: stockAdapterAbi,
    eventName: "TradeExecuted",
    strict: true,
    logs: receipt.logs.filter((log) => same(log.address, plan.adapter)),
  });
  check(events.length === 1);
  const event = events[0].args;
  check(
    event.orderId === plan.orderId &&
      same(event.trader, plan.wallet) &&
      same(event.stock, stock) &&
      event.buy === buy &&
      event.amountIn === BigInt(plan.amountIn) &&
      event.amountOut >= BigInt(plan.minimumOutput),
  );
  const flows = (token: string) =>
    parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      strict: true,
      logs: receipt.logs.filter((log) => same(log.address, token)),
    });
  const input = flows(plan.inputToken),
    output = flows(plan.outputToken);
  const moved = (logs: typeof input, from: string, to: string, amount: bigint) => {
    const matches = logs.filter((log) => same(log.args.from, from) && same(log.args.to, to));
    return matches.length === 1 && matches[0].args.value === amount;
  };
  check(
    moved(input, plan.wallet, plan.adapter, BigInt(plan.amountIn)) &&
      moved(input, plan.adapter, EXCHANGE, BigInt(plan.amountIn)),
  );
  check(
    moved(output, EXCHANGE, plan.adapter, event.amountOut) &&
      moved(output, plan.adapter, plan.wallet, event.amountOut),
  );
  // No extra debit or credit involving the caller can be hidden by a matching event.
  check(
    input.filter((log) => same(log.args.from, plan.wallet) || same(log.args.to, plan.wallet))
      .length === 1,
  );
  check(
    output.filter((log) => same(log.args.from, plan.wallet) || same(log.args.to, plan.wallet))
      .length === 1,
  );
  return { status: "confirmed" as const, fee, amountOut: event.amountOut };
}
