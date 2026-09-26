import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address, type Hex } from "viem";
import { Store } from "../src/server/store";
import { attachHash, refresh } from "../src/server/payments";
import { transferData, type Payment } from "../src/lib/shared";
const sender = "0x1111111111111111111111111111111111111111" as Address;
const recipient = "0x2222222222222222222222222222222222222222" as Address;
const token = "0x3333333333333333333333333333333333333333" as Address;
const oldHash = ("0x" + "ab".repeat(32)) as Hex,
  newHash = ("0x" + "cd".repeat(32)) as Hex,
  blockHash = ("0x" + "ef".repeat(32)) as Hex;
test("replacement recovery verifies chain evidence before releasing the payment", async (t) => {
  const previous = { ...process.env };
  const scope = globalThis as typeof globalThis & { stewardStore?: Store };
  const previousStore = scope.stewardStore;
  let tx: any,
    receipt: any,
    canonicalHash = blockHash,
    chain = 46630;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const answer = (r: any) => ({
      jsonrpc: "2.0",
      id: r.id,
      result:
        r.method === "eth_chainId"
          ? "0x" + chain.toString(16)
          : r.method === "eth_getTransactionByHash"
            ? tx
            : r.method === "eth_getTransactionReceipt"
              ? receipt
              : r.method === "eth_getBlockByNumber"
                ? {
                    hash: canonicalHash,
                    number: "0x1",
                    transactions: [],
                    timestamp: "0x1",
                    gasLimit: "0x100000",
                    gasUsed: "0x100",
                  }
                : null,
    });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(Array.isArray(input) ? input.map(answer) : answer(input)));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.RPC_URL = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  process.env.APP_CHAIN_ID = "46630";
  process.env.DEMO_TOKEN_ADDRESS = token;
  function setup() {
    scope.stewardStore?.db.close();
    scope.stewardStore = new Store(":memory:");
    const p: Payment = {
      id: randomUUID(),
      requestId: randomUUID(),
      sender,
      recipient,
      recipientName: "Sila",
      chainId: 46630,
      token,
      amount: "5",
      amountBase: "5000000",
      note: "",
      gas: "50000",
      gasPrice: "1",
      nonce: 2,
      createdAt: Date.now(),
      expiresAt: Date.now() + 300000,
      status: "submitted",
      hash: oldHash,
      error: null,
    };
    scope.stewardStore.insert(p);
    canonicalHash = blockHash;
    chain = 46630;
    tx = {
      hash: newHash,
      from: sender,
      to: sender,
      nonce: "0x2",
      input: "0x",
      value: "0x0",
      blockHash,
      blockNumber: "0x1",
      transactionIndex: "0x0",
      gas: "0xc350",
      gasPrice: "0x1",
      type: "0x0",
      v: "0x1b",
      r: "0x1",
      s: "0x1",
    };
    receipt = {
      transactionHash: newHash,
      blockHash,
      blockNumber: "0x1",
      transactionIndex: "0x0",
      from: sender,
      to: sender,
      contractAddress: null,
      cumulativeGasUsed: "0xc350",
      gasUsed: "0xc350",
      effectiveGasPrice: "0x1",
      logs: [],
      status: "0x1",
      type: "0x0",
    };
    return p;
  }
  try {
    await t.test("pending cancellation cannot unlock an intent", async () => {
      const p = setup();
      tx.blockHash = null;
      receipt = null;
      await assert.rejects(attachHash(sender, p.id, newHash), /still pending/);
      assert.equal(scope.stewardStore!.payment(sender, p.id).status, "submitted");
    });
    await t.test("mined self-transfer cancels and preserves original hash", async () => {
      const p = setup();
      const result = await attachHash(sender, p.id, newHash);
      assert.equal(result.status, "cancelled");
      assert.deepEqual(result.previousHashes, [oldHash]);
      scope.stewardStore!.claim(
        scope.stewardStore!.insert({
          ...p,
          id: randomUUID(),
          requestId: randomUUID(),
          hash: null,
          status: "draft",
        }),
      );
    });
    await t.test("changed recipient is replaced, never reported paid", async () => {
      const p = setup();
      tx.to = recipient;
      const result = await attachHash(sender, p.id, newHash);
      assert.equal(result.status, "replaced");
    });
    await t.test("speed-up needs the matching Transfer event", async () => {
      const p = setup();
      tx.to = token;
      tx.input = transferData(p);
      receipt.to = token;
      receipt.logs = [
        {
          address: token,
          data: encodeAbiParameters([{ type: "uint256" }], [5000000n]),
          topics: encodeEventTopics({
            abi: erc20Abi,
            eventName: "Transfer",
            args: { from: sender, to: recipient },
          }),
          blockHash,
          blockNumber: "0x1",
          transactionHash: newHash,
          transactionIndex: "0x0",
          logIndex: "0x0",
          removed: false,
        },
      ];
      const result = await attachHash(sender, p.id, newHash);
      assert.equal(result.status, "included");
      assert.deepEqual(result.previousHashes, [oldHash]);
    });
    await t.test("unrelated sender, nonce and chain are rejected", async () => {
      const p = setup();
      tx.from = recipient;
      await assert.rejects(attachHash(sender, p.id, newHash), /sender and nonce/);
      tx.from = sender;
      tx.nonce = "0x3";
      await assert.rejects(attachHash(sender, p.id, newHash), /sender and nonce/);
      chain = 1;
      await assert.rejects(attachHash(sender, p.id, newHash), /RPC network/);
    });
    await t.test("noncanonical replacement never releases the pending intent", async () => {
      const p = setup();
      canonicalHash = oldHash;
      await assert.rejects(attachHash(sender, p.id, newHash), /canonical block/);
      assert.equal(scope.stewardStore!.payment(sender, p.id).status, "submitted");
    });
    await t.test(
      "a reverted same-nonce replacement consumes nonce but is not called paid",
      async () => {
        const p = setup();
        receipt.status = "0x0";
        const result = await attachHash(sender, p.id, newHash);
        assert.equal(result.status, "replaced");
      },
    );
    await t.test("disappearing cancellation receipt returns to unknown", async () => {
      const p = setup();
      await attachHash(sender, p.id, newHash);
      receipt = null;
      const result = await refresh(sender, p.id);
      assert.equal(result.status, "unknown");
    });
  } finally {
    scope.stewardStore?.db.close();
    scope.stewardStore = previousStore;
    for (const key of ["RPC_URL", "APP_CHAIN_ID", "DEMO_TOKEN_ADDRESS"])
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    await new Promise<void>((r) => server.close(() => r()));
  }
});
