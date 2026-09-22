// One dedicated, user-authorized testnet proof. Never used by the WhatsApp worker.
// Run from apps/web: node --env-file=.env.local scripts/privy-proof.mjs send|verify|policy
import { PrivyClient } from "@privy-io/node";
import {
  readFileSync,
  existsSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import {
  createPublicClient,
  http,
  erc20Abi,
  encodeFunctionData,
  parseEventLogs,
  toHex,
  formatEther,
} from "viem";

const address = "0xf11aB0Ef7193461D7dBB04Ecd7653f32056d83ca";
const recipient = "0xB3144B301819EE517E7594b998b555c0dfdB7ded";
const token = "0x13800afeea6f8688547770052b395099758d9a5b";
const path = ".data/privy-transfer-proof.json";
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const check = (condition, code) => {
  if (!condition) throw new Error(code);
};
const rpc = createPublicClient({
  transport: http("https://rpc.testnet.chain.robinhood.com", { retryCount: 0, timeout: 15000 }),
});
const sdk = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET,
  maxRetries: 0,
  timeout: 20000,
  logLevel: "off",
});
const proof = JSON.parse(readFileSync(".data/privy-proof-wallet.json", "utf8"));
let journal = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : {
      walletId: proof.walletId,
      address,
      recipient,
      token,
      chain: 46630,
      amount: "1000000",
      attempts: {},
    };
function save() {
  writeFileSync(path + ".tmp", JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(path + ".tmp", path);
}
function safeError(e) {
  const raw = e.error?.code ?? e.code;
  return {
    status: Number.isInteger(e.status) ? e.status : null,
    code: typeof raw === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(raw) ? raw : null,
    policyDenied:
      /policy|policies/i.test(e.error?.message ?? e.message ?? "") &&
      /denied|violat|not allow|reject|fail/i.test(e.error?.message ?? e.message ?? ""),
  };
}
async function guard() {
  check(
    same(proof.address, address) &&
      journal.walletId === proof.walletId &&
      same(journal.address, address) &&
      same(journal.recipient, recipient) &&
      same(journal.token, token) &&
      journal.chain === 46630 &&
      journal.amount === "1000000",
    "proof_identity_mismatch",
  );
  const wallet = await sdk.wallets().get(proof.walletId);
  check(
    same(wallet.address, address) &&
      wallet.owner_id === process.env.PRIVY_WALLET_OWNER_ID &&
      wallet.external_id === proof.externalId &&
      wallet.policy_ids.length === 1 &&
      wallet.policy_ids[0] === process.env.PRIVY_WALLET_POLICY_ID,
    "wallet_configuration_mismatch",
  );
  check((await rpc.getChainId()) === 46630, "wrong_chain");
  const policy = await sdk.policies().get(process.env.PRIVY_WALLET_POLICY_ID);
  const rule = policy.rules[0];
  check(
    policy.rules.length === 1 &&
      rule.action === "ALLOW" &&
      rule.method === "eth_sendTransaction" &&
      rule.conditions.length === 4,
    "policy_mismatch",
  );
  const expected = [
    ["ethereum_transaction", "chain_id", "46630"],
    ["ethereum_transaction", "to", token],
    ["ethereum_transaction", "value", "0x0"],
    ["ethereum_calldata", "function_name", "transfer"],
  ];
  check(
    expected.every(([source, field, value]) =>
      rule.conditions.some(
        (c) =>
          c.field_source === source &&
          c.field === field &&
          c.operator === "eq" &&
          same(String(c.value), value),
      ),
    ),
    "policy_conditions_mismatch",
  );
}
async function attempt(name, transaction, caip2 = "eip155:46630") {
  check(!journal.attempts[name], "attempt_already_recorded_use_verify");
  const entry = {
    idempotencyKey: randomUUID(),
    referenceId: "steward_proof_" + randomUUID(),
    transaction,
    caip2,
    state: "started",
    startedAt: Date.now(),
  };
  journal.attempts[name] = entry;
  save(); // Persist before external side effect. Never auto-resend an ambiguous request.
  try {
    const result = await sdk
      .wallets()
      .ethereum()
      .sendTransaction(proof.walletId, {
        caip2,
        sponsor: false,
        params: { transaction },
        reference_id: entry.referenceId,
        idempotency_key: entry.idempotencyKey,
        request_expiry: Date.now() + 60000,
        authorization_context: {
          authorization_private_keys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY],
        },
      });
    Object.assign(entry, {
      state: "accepted",
      hash: result.hash,
      transactionId: result.transaction_id,
    });
  } catch (e) {
    Object.assign(entry, { state: "unresolved", error: safeError(e) });
    if ([400, 403].includes(entry.error.status) && entry.error.code === "policy_violation")
      entry.state = "policy_rejected";
  }
  save();
  console.log(JSON.stringify({ name, ...entry }));
  return entry;
}
async function verify() {
  const entry = journal.attempts.send;
  check(entry?.hash, "no_transaction_hash_reconcile_provider_reference");
  const receipt = await rpc.waitForTransactionReceipt({
    hash: entry.hash,
    timeout: 45000,
    confirmations: 2,
  });
  const tx = await rpc.getTransaction({ hash: entry.hash });
  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs.filter((l) => same(l.address, token)),
  });
  check(
    receipt.status === "success" &&
      same(tx.from, address) &&
      same(tx.to, token) &&
      tx.chainId === 46630 &&
      tx.value === 0n &&
      tx.input === entry.transaction.data &&
      tx.nonce === Number(BigInt(entry.transaction.nonce)),
    "transaction_mismatch",
  );
  check(
    transfers.length === 1 &&
      same(transfers[0].args.from, address) &&
      same(transfers[0].args.to, recipient) &&
      transfers[0].args.value === 1000000n,
    "transfer_event_mismatch",
  );
  const blockNumber = receipt.blockNumber;
  const [balance, eth] = await Promise.all([
    rpc.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
      blockNumber,
    }),
    rpc.getBalance({ address, blockNumber }),
  ]);
  entry.receipt = {
    block: String(blockNumber),
    status: receipt.status,
    nonce: tx.nonce,
    amount: "1 Demo USD",
    remainingDemoUsd: String(balance / 1000000n),
    testEth: formatEther(eth),
    verifiedAt: Date.now(),
  };
  save();
  console.log(JSON.stringify({ hash: entry.hash, ...entry.receipt }));
}
let lock;
try {
  lock = openSync(path + ".lock", "wx", 0o600);
  await guard();
  const mode = process.argv[2];
  if (mode === "send") {
    check(!journal.attempts.send, "send_already_recorded_use_verify");
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, 1000000n],
    });
    await rpc.simulateContract({
      address: token,
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, 1000000n],
      account: address,
    });
    const [nonce, gas, gasPrice, balance] = await Promise.all([
      rpc.getTransactionCount({ address, blockTag: "pending" }),
      rpc.estimateGas({ account: address, to: token, data }),
      rpc.getGasPrice(),
      rpc.getBalance({ address }),
    ]);
    const gasLimit = (gas * 120n) / 100n,
      price = gasPrice * 2n;
    check(
      gasLimit * price <= 100000000000000n && gasLimit * price < balance,
      "proof_gas_budget_exceeded",
    );
    const sent = await attempt("send", {
      chain_id: 46630,
      to: token,
      value: "0x0",
      data,
      nonce: toHex(nonce),
      gas_limit: toHex(gasLimit),
      gas_price: toHex(price),
      type: 0,
    });
    if (sent.state === "accepted") await verify();
    else process.exitCode = 1;
  } else if (mode === "verify") await verify();
  else if (mode === "policy") {
    check(journal.attempts.send?.receipt?.status === "success", "complete_allowed_proof_first");
    // Zero token amount; zero approval; no valuable transfers even if a condition fails.
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, 0n],
    });
    const base = {
      chain_id: 46630,
      to: token,
      value: "0x0",
      data,
      gas_limit: "0x186a0",
      gas_price: "0xf4240",
      type: 0,
    };
    for (const [name, tx, chain] of [
      ["wrong_chain", { ...base, chain_id: 11155111 }, "eip155:11155111"],
      ["wrong_contract", { ...base, to: address }, "eip155:46630"],
      [
        "wrong_function",
        {
          ...base,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [recipient, 0n],
          }),
        },
        "eip155:46630",
      ],
      ["nonzero_native_value", { ...base, value: "0x1" }, "eip155:46630"],
    ]) {
      const previous = journal.attempts[name];
      if (
        previous &&
        [400, 403].includes(previous.error?.status) &&
        previous.error?.code === "policy_violation"
      ) {
        previous.state = "policy_rejected";
        save();
      }
      if (previous?.state === "policy_rejected") continue;
      const result = await attempt(name, tx, chain);
      check(result.state === "policy_rejected", "policy_probe_requires_review");
    }
  } else throw new Error("usage_send_verify_policy");
} catch (e) {
  console.log(
    JSON.stringify({
      stopped: true,
      reason: /^[a-z_]+$/.test(e.message) ? e.message : "operation_failed",
      ...safeError(e),
    }),
  );
  process.exitCode = 1;
} finally {
  if (lock !== undefined) {
    closeSync(lock);
    unlinkSync(path + ".lock");
  }
}
