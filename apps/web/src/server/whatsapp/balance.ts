import type { DatabaseSync } from "node:sqlite";
import {
  createPublicClient,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseUnits,
} from "viem";
import { senderLookup } from "./config";
import { text } from "./menu";

// Read-only client: no signer, authorization key, transfer or funding capability.
const client = createPublicClient({
  transport: http("https://rpc.testnet.chain.robinhood.com", { timeout: 8000, retryCount: 1 }),
});
const token = "0x13800afeea6f8688547770052b395099758d9a5b";
export async function balanceReply(db: DatabaseSync, key: Buffer, phone: string, amount?: string) {
  const sender = senderLookup(phone, key);
  const wallet = db
    .prepare(
      `SELECT w.address,w.chain,a.status FROM wa_accounts a
    LEFT JOIN wa_managed_wallets w ON w.account_id=a.id WHERE a.sender=?`,
    )
    .get(sender) as { address: string | null; chain: number | null; status: string } | undefined;
  if (!wallet) return text("Create your Steward test account first. Type Menu to begin.");
  if (wallet.status !== "active")
    return text("This account is paused. Contact the Steward operator for recovery.");
  if (!wallet.address)
    return text("Your wallet is not ready yet. Choose My account to check setup.");
  try {
    if (wallet.chain !== 46630 || (await client.getChainId()) !== 46630)
      throw new Error("wrong_chain");
    const address = getAddress(wallet.address);
    const block = await client.getBlock();
    const [demoUsd, testEth, decimals] = await Promise.all([
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
        blockNumber: block.number,
      }),
      client.getBalance({ address, blockNumber: block.number }),
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "decimals",
        blockNumber: block.number,
      }),
    ]);
    if (decimals !== 6 || Date.now() - Number(block.timestamp) * 1000 > 120000)
      throw new Error("unreliable_snapshot");
    // Account may have been paused while waiting for RPC.
    const current = db.prepare("SELECT status FROM wa_accounts WHERE sender=?").get(sender) as
      | { status: string }
      | undefined;
    if (current?.status !== "active")
      return text("This account is paused. Contact the Steward operator for recovery.");
    if (amount !== undefined) {
      if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(amount) || parseUnits(amount, 6) <= 0n)
        return text("Enter a positive Demo USD amount to check.");
      const enough = demoUsd >= parseUnits(amount, 6);
      const reserve = 100000000000000n;
      return text(
        `For ${amount} Demo USD:\n\n${enough ? "Your Demo USD balance covers the amount." : "Your Demo USD balance is too low."}\n${testEth >= reserve ? "Your test ETH covers the conservative 0.0001 test ETH fee reserve." : "Your test ETH is below the conservative 0.0001 test ETH fee reserve; an exact payment review is needed."}\n\nBalance: ${formatUnits(demoUsd, decimals)} Demo USD\nNetwork fees: ${formatEther(testEth)} test ETH\n\nThis is a balance check, not a payment approval. The exact fee, pending payments and spending limits are checked during payment review. Nothing was prepared or sent.`,
      );
    }
    return text(
      `Your Steward balance\n\nDemo USD: ${formatUnits(demoUsd, decimals)}\nTest ETH (network fees): ${formatEther(testEth)}\n\nNetwork: Robinhood Chain testnet\nChecked at ${new Date(Number(block.timestamp) * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC")}\n\n${demoUsd === 0n && testEth === 0n ? "Your wallet currently has no Demo USD or test ETH. Choose Receive payment to see its address.\n\n" : ""}Test assets have no monetary value. Type Balance to refresh or Menu to return.`,
    );
  } catch {
    // Never turn an unavailable RPC or token response into an invented zero balance.
    return text(
      "I couldn’t retrieve your balance right now. Please try View balance again shortly. No payment was made.",
    );
  }
}
