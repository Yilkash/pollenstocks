import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address } from "viem";
import { Store } from "../src/server/store";
import { preflight } from "../src/server/payments";
import {
  amountUnits,
  transactionMatches,
  transferData,
  hasExpectedTransfer,
  validateForSigning,
  type Payment,
} from "../src/lib/shared";
import { isWalletRejection } from "../src/lib/browser";
const sender = "0x1111111111111111111111111111111111111111" as Address;
const recipient = "0x2222222222222222222222222222222222222222" as Address;
const token = "0x3333333333333333333333333333333333333333" as Address;
const config = {
  chainId: 46630,
  chainName: "Test",
  token,
  explorer: null,
  rpcUrl: "http://127.0.0.1",
  servReady: false,
};
const draft = (patch: Partial<Payment> = {}): Payment => ({
  id: randomUUID(),
  requestId: randomUUID(),
  sender,
  recipient,
  recipientName: "Sila",
  token,
  chainId: 46630,
  amount: "5",
  amountBase: "5000000",
  note: "",
  gas: "50000",
  gasPrice: "1000000",
  nonce: 2,
  createdAt: Date.now(),
  expiresAt: Date.now() + 300000,
  status: "draft",
  hash: null,
  error: null,
  ...patch,
});

test("decimal amounts remain exact; invalid precision and values are rejected", () => {
  assert.equal(amountUnits("5.000001"), 5000001n);
  for (const value of ["0", "-1", "1e3", "1.0000001", "1,000", "NaN"])
    assert.throws(() => amountUnits(value));
});
test("wallet rejection is recognized through nested wrappers; timeouts remain unknown", () => {
  assert.equal(isWalletRejection({ cause: { cause: { code: 4001 } } }), true);
  assert.equal(isWalletRejection(new Error("timeout")), false);
});
test("expired, wrong-network and altered-amount drafts cannot be signed", () => {
  const p = draft({ status: "signing" });
  validateForSigning(p, config, sender);
  for (const change of [
    { expiresAt: 0 },
    { chainId: 1 },
    { amountBase: "1" },
    { sender: recipient },
    { status: "included" as const },
  ])
    assert.throws(() => validateForSigning({ ...p, ...change }, config, sender));
});
test("atomic claim blocks duplicate clicks and a second pending payment", () => {
  const s = new Store(":memory:");
  try {
    const p = s.insert(draft());
    s.claim(p);
    assert.throws(() => s.claim(p), /already claimed/);
    const other = s.insert(draft());
    assert.throws(() => s.claim(other), /pending payment/);
  } finally {
    s.db.close();
  }
});
test("rejection releases the pending slot; unknown outcome keeps it blocked", () => {
  const s = new Store(":memory:");
  try {
    const p = s.claim(s.insert(draft()));
    s.transition({ ...p, status: "rejected" }, ["signing"]);
    const second = s.claim(s.insert(draft()));
    s.transition({ ...second, status: "unknown" }, ["signing"]);
    assert.throws(() => s.claim(s.insert(draft())), /pending payment/);
  } finally {
    s.db.close();
  }
});
test("expired drafts are rejected, request IDs deduplicate, and other wallets cannot read payments", () => {
  const s = new Store(":memory:");
  try {
    const p = s.insert(draft({ expiresAt: 0 }));
    assert.throws(() => s.claim(p), /expired/);
    assert.equal(s.insert({ ...p, id: randomUUID() }).id, p.id);
    assert.throws(() => s.payment(recipient, p.id), /not found/);
    assert.equal(s.history(sender, 46630)[0].status, "expired");
  } finally {
    s.db.close();
  }
});
test("session replay protection and explicit logout", () => {
  const s = new Store(":memory:");
  try {
    const challenge = s.challenge(sender, "http://localhost:3000", 46630);
    s.consumeChallenge(challenge.id);
    assert.throws(() => s.consumeChallenge(challenge.id), /already used/);
    const token = s.newSession(sender);
    assert.equal(s.session(token)?.wallet, sender);
    s.logout(token);
    assert.equal(s.session(token), undefined);
  } finally {
    s.db.close();
  }
});
test("reload preserves pending hash and linked chat without resending", () => {
  const dir = mkdtempSync(join(tmpdir(), "steward-test-"));
  const path = join(dir, "db.sqlite");
  let s = new Store(path);
  try {
    const p = s.claim(s.insert(draft()));
    const hash = ("0x" + "ab".repeat(32)) as `0x${string}`;
    s.transition({ ...p, hash, status: "submitted" }, ["signing"]);
    s.addMessage(sender, 46630, "assistant", "Draft ready", p.id);
    s.db.close();
    s = new Store(path);
    assert.equal(s.payment(sender, p.id).hash, hash);
    assert.equal(s.messages(sender, 46630)[0].paymentId, p.id);
    assert.throws(() => s.claim(s.insert(draft())), /pending payment/);
  } finally {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("receipt verification rejects wrong payload, nonce, token, recipient and amount", () => {
  const p = draft();
  const tx = { from: sender, to: token, input: transferData(p), value: 0n, nonce: 2 };
  assert.equal(transactionMatches(p, tx), true);
  for (const change of [
    { nonce: 3 },
    { to: recipient },
    { value: 1n },
    { input: "0x" },
    { from: recipient },
  ])
    assert.equal(transactionMatches(p, { ...tx, ...change }), false);
  const log = {
    address: token,
    data: encodeAbiParameters([{ type: "uint256" }], [5000000n]),
    topics: encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from: sender, to: recipient },
    }) as `0x${string}`[],
  };
  assert.equal(hasExpectedTransfer(p, [log]), true);
  assert.equal(hasExpectedTransfer(p, [{ ...log, address: sender }]), false);
  assert.equal(hasExpectedTransfer({ ...p, amountBase: "1" }, [log]), false);
  assert.equal(hasExpectedTransfer({ ...p, recipient: sender }, [log]), false);
});
test("preflight checks insufficient tokens, test ETH, wrong network and simulation failure", async () => {
  const old = { ...process.env };
  let tokenBalance = 1000000n;
  let eth = 10n ** 18n;
  let chain = 46630;
  let transfer = true;
  const word = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const answer = (r: any) => {
      let result: any;
      switch (r.method) {
        case "eth_chainId":
          result = "0x" + chain.toString(16);
          break;
        case "eth_getBalance":
          result = "0x" + eth.toString(16);
          break;
        case "eth_gasPrice":
          result = "0x3b9aca00";
          break;
        case "eth_estimateGas":
          result = "0xc350";
          break;
        case "eth_call": {
          const data = r.params[0].data;
          result = data.startsWith("0x313ce567")
            ? word(6n)
            : data.startsWith("0x70a08231")
              ? word(tokenBalance)
              : word(transfer ? 1n : 0n);
          break;
        }
        default:
          throw new Error(r.method);
      }
      return { jsonrpc: "2.0", id: r.id, result };
    };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(Array.isArray(input) ? input.map(answer) : answer(input)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  process.env.APP_CHAIN_ID = "46630";
  process.env.RPC_URL = "http://127.0.0.1:" + port;
  process.env.DEMO_TOKEN_ADDRESS = token;
  try {
    await assert.rejects(preflight(sender, recipient, 5000000n), /Not enough Demo USD/);
    tokenBalance = 10000000n;
    eth = 0n;
    await assert.rejects(preflight(sender, recipient, 5000000n), /Not enough test ETH/);
    eth = 10n ** 18n;
    chain = 1;
    await assert.rejects(preflight(sender, recipient, 5000000n), /RPC network/);
    chain = 46630;
    transfer = false;
    await assert.rejects(preflight(sender, recipient, 5000000n), /token rejected/);
    transfer = true;
    assert.equal((await preflight(sender, recipient, 5000000n)).gas, "60000");
  } finally {
    for (const key of ["APP_CHAIN_ID", "RPC_URL", "DEMO_TOKEN_ADDRESS"])
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
