import { hasExpectedTransfer, transactionMatches, type Payment } from "./shared";
import type { Hex } from "viem";
export type RecoveryTransaction = {
  from: string;
  to: string | null;
  input: string;
  value: bigint;
  nonce: number;
};
export function samePaymentNonce(p: Payment, tx: RecoveryTransaction) {
  return (
    p.nonce !== null && tx.nonce === p.nonce && tx.from.toLowerCase() === p.sender.toLowerCase()
  );
}
/** Only call after verifying that the receipt and transaction share a canonical block. */
export function minedOutcome(
  p: Payment,
  tx: RecoveryTransaction,
  receipt: {
    status: "success" | "reverted";
    logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[];
  },
): Pick<Payment, "status" | "error"> {
  if (!samePaymentNonce(p, tx))
    throw new Error("The transaction does not use this payment's sender and nonce.");
  if (transactionMatches(p, tx)) {
    if (receipt.status !== "success")
      return { status: "failed", error: "The token transfer reverted." };
    if (!hasExpectedTransfer(p, receipt.logs))
      return { status: "failed", error: "No matching token transfer was found in the receipt." };
    return { status: "included", error: null };
  }
  const cancellation =
    receipt.status === "success" &&
    tx.to?.toLowerCase() === p.sender.toLowerCase() &&
    tx.value === 0n &&
    tx.input === "0x";
  return cancellation
    ? {
        status: "cancelled",
        error: "A self-transfer using the same nonce was included. This payment was cancelled.",
      }
    : {
        status: "replaced",
        error:
          "A different transaction using the same nonce was included. The reviewed payment was not confirmed; inspect the replacement before preparing another payment.",
      };
}
