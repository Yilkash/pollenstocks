import { createPublicClient, http, erc20Abi, formatUnits, type Address, type Hex } from "viem";
import { z } from "zod";
import { settings } from "./config";
import { store, newId } from "./store";
import {
  address,
  amountUnits,
  AppError,
  hasExpectedTransfer,
  transactionMatches,
  type Payment,
} from "@/lib/shared";

export const paymentInput = z
  .object({
    recipient: z.string().trim().min(1).max(100),
    amount: z.string().max(30),
    note: z.string().trim().max(160).default(""),
    requestId: z.string().uuid(),
  })
  .strict();
export function client() {
  const { chain, rpc } = settings();
  return createPublicClient({ chain, transport: http(rpc, { timeout: 12_000, retryCount: 1 }) });
}
export async function checkedClient() {
  const c = client();
  if ((await c.getChainId()) !== settings().chain.id)
    throw new AppError("RPC network does not match the configured test network.", 503);
  return c;
}
export async function balances(wallet: Address) {
  const { token } = settings();
  const c = await checkedClient();
  const blockNumber = await c.getBlockNumber();
  const eth = await c.getBalance({ address: wallet, blockNumber });
  if (!token)
    return { eth: formatUnits(eth, 18), token: null, blockNumber: blockNumber.toString() };
  const [decimals, balance] = await Promise.all([
    c.readContract({ address: token, abi: erc20Abi, functionName: "decimals", blockNumber }),
    c.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
      blockNumber,
    }),
  ]);
  if (decimals !== 6) throw new AppError("The configured demo token must have six decimals.", 503);
  return {
    eth: formatUnits(eth, 18),
    token: formatUnits(balance, 6),
    blockNumber: blockNumber.toString(),
  };
}
export function recipientFor(wallet: string, input: string) {
  const contact = store()
    .contacts(wallet)
    .find(
      (c) =>
        c.name.toLowerCase() === input.toLowerCase() ||
        c.address.toLowerCase() === input.toLowerCase(),
    );
  if (contact) return { recipient: contact.address, recipientName: contact.name };
  if (input.startsWith("0x")) return { recipient: address(input), recipientName: "Wallet address" };
  throw new AppError('No saved contact named "' + input + '". Save the recipient address first.');
}
export async function preflight(wallet: Address, recipient: Address, units: bigint) {
  const { token } = settings();
  if (!token)
    throw new AppError(
      "The test token is not configured yet. Follow the deployment instructions.",
      503,
    );
  const c = await checkedClient();
  const [decimals, balance, eth, gasPrice] = await Promise.all([
    c.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    c.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
    c.getBalance({ address: wallet }),
    c.getGasPrice(),
  ]);
  if (decimals !== 6)
    throw new AppError("Unexpected token decimals. Check the test-token configuration.", 503);
  if (balance < units) throw new AppError("Not enough Demo USD for this payment.");
  const simulated = await c.simulateContract({
    account: wallet,
    address: token,
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, units],
  });
  if (simulated.result !== true) throw new AppError("The token rejected this transfer.");
  // On Arbitrum-based chains eth_estimateGas includes the L1 posting component.
  const estimate = await c.estimateContractGas({
    account: wallet,
    address: token,
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, units],
  });
  const gas = (estimate * 120n + 99n) / 100n;
  if (eth < gas * gasPrice) throw new AppError("Not enough test ETH for the network fee.");
  return { gas: gas.toString(), gasPrice: gasPrice.toString() };
}
export async function prepare(wallet: Address, input: z.infer<typeof paymentInput>) {
  const { chain, token } = settings();
  const existing = store().byRequest(wallet, chain.id, input.requestId);
  if (existing) return existing;
  const units = amountUnits(input.amount);
  const target = recipientFor(wallet, input.recipient);
  const fee = await preflight(wallet, target.recipient, units);
  const now = Date.now();
  const p: Payment = {
    id: newId(),
    requestId: input.requestId,
    sender: wallet,
    chainId: chain.id,
    token: token!,
    ...target,
    amount: formatUnits(units, 6),
    amountBase: units.toString(),
    note: input.note,
    ...fee,
    nonce: null,
    createdAt: now,
    expiresAt: now + 5 * 60_000,
    status: "draft",
    hash: null,
    error: null,
  };
  return store().insert(p);
}
export async function claim(wallet: Address, id: string) {
  const p = store().payment(wallet, id);
  if (
    p.chainId !== settings().chain.id ||
    p.token.toLowerCase() !== settings().token?.toLowerCase()
  )
    throw new AppError("Payment configuration changed. Prepare a new payment.", 409);
  if (p.status !== "draft" || p.expiresAt <= Date.now())
    throw new AppError("This draft expired or was already used.", 409);
  const fee = await preflight(wallet, p.recipient, BigInt(p.amountBase));
  const nonce = await client().getTransactionCount({ address: wallet, blockTag: "pending" });
  return store().claim({ ...p, ...fee, nonce });
}
export async function attachHash(wallet: Address, id: string, hash: Hex) {
  const p = store().payment(wallet, id);
  if (p.hash === hash) return refresh(wallet, id);
  if (!["signing", "unknown", "submitted"].includes(p.status))
    throw new AppError("This payment is not awaiting a transaction.", 409);
  // Attach only a transaction with the exact reviewed payload and reserved nonce.
  const c = await checkedClient();
  let tx;
  try {
    tx = await c.getTransaction({ hash });
  } catch {
    throw new AppError(
      "Transaction not visible yet. Keep this hash and retry receipt recovery shortly.",
      409,
    );
  }
  if (!transactionMatches(p, tx))
    throw new AppError("That transaction does not match this payment.", 409);
  store().transition({ ...p, hash, status: "submitted", error: null }, [
    "signing",
    "unknown",
    "submitted",
  ]);
  return refresh(wallet, id);
}
export async function refresh(wallet: Address, id: string) {
  const p = store().payment(wallet, id);
  if (p.chainId !== settings().chain.id)
    throw new AppError("This payment belongs to a different network.", 409);
  if (!p.hash || !["submitted", "unknown", "included"].includes(p.status)) return p;
  const c = await checkedClient();
  let receipt;
  try {
    receipt = await c.getTransactionReceipt({ hash: p.hash });
  } catch {
    if (p.status === "included")
      return store().transition(
        {
          ...p,
          status: "unknown",
          error: "Inclusion could not be reconfirmed. Check again before any retry.",
        },
        ["included"],
      );
    return p;
  }
  const tx = await c.getTransaction({ hash: p.hash });
  if (!transactionMatches(p, tx))
    return store().transition(
      { ...p, status: "failed", error: "Transaction payload does not match the reviewed payment." },
      [p.status],
    );
  if (receipt.status !== "success")
    return store().transition(
      {
        ...p,
        status: "failed",
        error: "The transaction reverted. No successful payment was confirmed.",
      },
      [p.status],
    );
  if (!hasExpectedTransfer(p, receipt.logs))
    return store().transition(
      { ...p, status: "failed", error: "No matching token transfer was found in this receipt." },
      [p.status],
    );
  return store().transition({ ...p, status: "included", error: null }, [p.status]);
}
