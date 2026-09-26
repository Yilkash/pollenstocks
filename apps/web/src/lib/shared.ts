import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

export const DECIMALS = 6;
export const TOKEN_LABEL = "Demo USD";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function address(value: string): Address {
  if (!isAddress(value, { strict: true }) || value.toLowerCase() === zeroAddress) {
    throw new AppError("Enter a valid, nonzero wallet address.");
  }
  return getAddress(value);
}
export function amountUnits(value: string): bigint {
  if (!/^(0|[1-9]\d{0,14})(\.\d{1,6})?$/.test(value)) {
    throw new AppError(
      "Use a positive amount with at most 6 decimal places. No commas or exponent notation.",
    );
  }
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (result <= 0n) throw new AppError("Amount must be greater than zero.");
  return result;
}
export type PaymentStatus =
  | "draft"
  | "signing"
  | "submitted"
  | "included"
  | "rejected"
  | "failed"
  | "unknown"
  | "expired"
  | "cancelled"
  | "replaced";
export interface Payment {
  id: string;
  requestId: string;
  sender: Address;
  chainId: number;
  token: Address;
  recipient: Address;
  recipientName: string;
  amount: string;
  amountBase: string;
  note: string;
  gas: string;
  gasPrice: string;
  nonce: number | null;
  createdAt: number;
  expiresAt: number;
  status: PaymentStatus;
  hash: Hex | null;
  previousHashes?: Hex[];
  error: string | null;
}
export interface Contact {
  name: string;
  address: Address;
}
export interface AppConfig {
  chainId: number;
  chainName: string;
  token: Address | null;
  explorer: string | null;
  rpcUrl: string;
  servReady: boolean;
}
export function transferData(payment: Pick<Payment, "recipient" | "amountBase">): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [payment.recipient, BigInt(payment.amountBase)],
  });
}
export function transactionMatches(
  p: Payment,
  tx: { from: string; to: string | null; input: string; value: bigint; nonce: number },
) {
  return (
    tx.from.toLowerCase() === p.sender.toLowerCase() &&
    tx.to?.toLowerCase() === p.token.toLowerCase() &&
    tx.input.toLowerCase() === transferData(p).toLowerCase() &&
    tx.value === 0n &&
    tx.nonce === p.nonce
  );
}
export function hasExpectedTransfer(
  p: Payment,
  logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[],
) {
  return logs.some((log) => {
    if (log.address.toLowerCase() !== p.token.toLowerCase()) return false;
    try {
      const event = decodeEventLog({
        abi: erc20Abi,
        eventName: "Transfer",
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
        strict: true,
      });
      return (
        event.args.from.toLowerCase() === p.sender.toLowerCase() &&
        event.args.to.toLowerCase() === p.recipient.toLowerCase() &&
        event.args.value === BigInt(p.amountBase)
      );
    } catch {
      return false;
    }
  });
}
export function validateForSigning(p: Payment, config: AppConfig, wallet: string) {
  if (
    p.chainId !== config.chainId ||
    !config.token ||
    p.token.toLowerCase() !== config.token.toLowerCase() ||
    p.sender.toLowerCase() !== wallet.toLowerCase() ||
    p.expiresAt <= Date.now() ||
    p.status !== "signing" ||
    p.nonce === null ||
    amountUnits(p.amount).toString() !== p.amountBase
  ) {
    throw new AppError(
      "The payment no longer matches this wallet, network or review. Prepare a new payment.",
    );
  }
  address(p.recipient);
}
