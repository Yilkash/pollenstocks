import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { PrivyClient } from "@privy-io/node";
import {
  createPublicClient,
  http,
  erc20Abi,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  parseEventLogs,
  toHex,
} from "viem";
import { seal, unseal, senderLookup } from "./config";
import { text } from "./menu";
import { paymentContactLabel } from "./contacts";
import {
  PAYMENT_TOKEN,
  PER_PAYMENT,
  digest,
  confirmationToken,
  paymentById,
  type Payment,
} from "./payments";
const rpc = createPublicClient({
  transport: http("https://rpc.testnet.chain.robinhood.com", { retryCount: 0, timeout: 8000 }),
});
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const dataFor = (p: Payment) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(p.destination), BigInt(p.amount)],
  });
const sdk = () =>
  new PrivyClient({
    appId: process.env.PRIVY_APP_ID!,
    appSecret: process.env.PRIVY_APP_SECRET!,
    maxRetries: 0,
    timeout: 15000,
    logLevel: "off",
  });
function ensure(ok: unknown) {
  if (!ok) throw new Error("payment_check_failed");
}
function localWallet(db: DatabaseSync, p: Payment) {
  const row = db
    .prepare(
      `SELECT a.status,w.* FROM wa_accounts a JOIN wa_managed_wallets w ON w.account_id=a.id WHERE a.id=?`,
    )
    .get(p.account_id) as
    | {
        status: string;
        address: string;
        provider_id: string;
        external_id: string;
        app_id: string;
        owner_id: string;
        policy_id: string;
        chain: number;
      }
    | undefined;
  ensure(
    row &&
      row.status === "active" &&
      row.chain === 46630 &&
      same(row.address, p.wallet) &&
      row.provider_id === p.provider_id &&
      row.external_id === p.external_id &&
      row.app_id === p.app_id &&
      row.owner_id === p.owner_id &&
      row.policy_id === p.policy_id,
  );
  ensure(
    p.app_id === process.env.PRIVY_APP_ID &&
      p.owner_id === process.env.PRIVY_WALLET_OWNER_ID &&
      p.policy_id === process.env.PRIVY_WALLET_POLICY_ID,
  );
}
async function chainChecks(p: Payment) {
  ensure((await rpc.getChainId()) === 46630);
  const block = await rpc.getBlock();
  ensure(Date.now() - Number(block.timestamp) * 1000 < 120000);
  const [balance, eth, decimals] = await Promise.all([
    rpc.readContract({
      address: PAYMENT_TOKEN,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [getAddress(p.wallet)],
      blockNumber: block.number,
    }),
    rpc.getBalance({ address: getAddress(p.wallet), blockNumber: block.number }),
    rpc.readContract({
      address: PAYMENT_TOKEN,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber: block.number,
    }),
  ]);
  ensure(
    decimals === 6 &&
      BigInt(p.amount) > 0n &&
      BigInt(p.amount) <= PER_PAYMENT &&
      balance >= BigInt(p.amount),
  );
  await rpc.simulateContract({
    address: PAYMENT_TOKEN,
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(p.destination), BigInt(p.amount)],
    account: getAddress(p.wallet),
  });
  return eth;
}
export async function reviewPayment(db: DatabaseSync, key: Buffer, phone: string, id: string) {
  const p = paymentById(db, id);
  if (!p || p.sender !== senderLookup(phone, key) || p.state !== "quoting")
    return text(
      "This payment review is no longer available. Choose Recent activity to check its status.",
    );
  try {
    localWallet(db, p);
    ensure(p.expires > Date.now());
    const eth = await chainChecks(p);
    const [estimate, price] = await Promise.all([
      rpc.estimateGas({ account: getAddress(p.wallet), to: PAYMENT_TOKEN, data: dataFor(p) }),
      rpc.getGasPrice(),
    ]);
    const gas = (estimate * 120n) / 100n,
      gasPrice = price * 2n,
      cap = gas * gasPrice;
    ensure(cap <= 100000000000000n && eth >= cap);
    localWallet(db, p);
    const token = confirmationToken();
    const changed = db
      .prepare(
        "UPDATE wa_payments SET state='review',gas=?,gas_price=?,confirmation_hash=?,expires=? WHERE id=? AND state='quoting' AND expires>?",
      )
      .run(
        gas.toString(),
        gasPrice.toString(),
        digest(token),
        Date.now() + 600000,
        p.id,
        Date.now(),
      );
    ensure(changed.changes === 1);
    return {
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: `Review payment\n\nSend: ${formatUnits(BigInt(p.amount), 6)} Demo USD\nTo: ${paymentContactLabel(db, key, p.id) ? paymentContactLabel(db, key, p.id) + "\n" : ""}${p.destination}\n\nNetwork: Robinhood Chain testnet\nEstimated fee: ${formatEther(estimate * price)} test ETH\nMaximum fee: ${formatEther(cap)} test ETH\n\nLimit: 1,000 per payment / 5,000 per rolling 24 hours. Test assets have no monetary value.\n\nConfirm within 10 minutes.`,
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: `pay:confirm:${p.id}:${token}`, title: "Confirm payment" },
            },
            { type: "reply", reply: { id: `pay:cancel:${p.id}:${token}`, title: "Cancel" } },
          ],
        },
      },
    };
  } catch {
    db.prepare(
      "UPDATE wa_payments SET state='failed',error='review_unavailable' WHERE id=? AND state='quoting'",
    ).run(p.id);
    return text(
      "I couldn’t prepare this payment. Check your Demo USD and test ETH balances, then try again. Nothing was sent.",
    );
  }
}
function notify(db: DatabaseSync, key: Buffer, p: Payment, kind: string, body: string) {
  if (p.reply_until <= Date.now()) return;
  const { to } = unseal<{ to: string }>(p.recipient, key);
  db.prepare("INSERT OR IGNORE INTO wa_outbox(id,payload,expires) VALUES(?,?,?)").run(
    `payment:${p.id}:${kind}`,
    seal({ to, ...text(body) }, key),
    p.reply_until,
  );
}
// No automatic resubmission after the durable 'submitting' boundary, including
// timeouts and process death. Recovery is exclusively by provider reference + receipt.
export async function processPayment(db: DatabaseSync, key: Buffer, allowed: Set<string>) {
  const allowedKeys = new Set([...allowed].map((p) => senderLookup(p, key)));
  const now = Date.now(),
    lease = randomUUID();
  let p: Payment | undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db
      .prepare(
        "SELECT * FROM wa_payments WHERE state IN ('queued','preflight','submitting','unknown','broadcast') AND next_check<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY created LIMIT 50",
      )
      .all(now, now) as Payment[];
    p = rows.find(
      (r) =>
        allowedKeys.has(r.sender) &&
        (!["queued", "preflight"].includes(r.state) ||
          process.env.WHATSAPP_PAYMENTS_ENABLED === "true"),
    );
    if (p)
      db.prepare("UPDATE wa_payments SET lease=?,lease_until=? WHERE id=?").run(
        lease,
        now + 180000,
        p.id,
      );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (!p) return;
  const payment = p;
  let submitted = !["queued", "preflight"].includes(p.state);
  function update(state: string, error: string | null, body?: string, kind = state) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          "UPDATE wa_payments SET state=?,error=?,lease=NULL,lease_until=NULL,next_check=? WHERE id=? AND lease=?",
        )
        .run(state, error, Date.now() + 15000, payment.id, lease);
      if (result.changes && body) notify(db, key, payment, kind, body);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  try {
    if (!submitted) {
      db.prepare("UPDATE wa_payments SET state='preflight' WHERE id=? AND lease=?").run(
        p.id,
        lease,
      );
      ensure(
        process.env.WHATSAPP_PAYMENTS_ENABLED === "true" &&
          p.confirmed_at !== null &&
          p.expires > Date.now(),
      );
      localWallet(db, p);
      ensure(p.gas && p.gas_price);
      const privy = sdk();
      const wallet = await privy.wallets().get(p.provider_id);
      ensure(
        same(wallet.address, p.wallet) &&
          wallet.external_id === p.external_id &&
          wallet.owner_id === p.owner_id &&
          wallet.policy_ids.length === 1 &&
          wallet.policy_ids[0] === p.policy_id,
      );
      const policy = await privy.policies().get(p.policy_id),
        rule = policy.rules[0];
      const expected = [
        ["ethereum_transaction", "chain_id", "46630"],
        ["ethereum_transaction", "to", PAYMENT_TOKEN],
        ["ethereum_transaction", "value", "0x0"],
        ["ethereum_calldata", "function_name", "transfer"],
      ];
      ensure(
        policy.rules.length === 1 &&
          rule.action === "ALLOW" &&
          rule.method === "eth_sendTransaction" &&
          rule.conditions.length === 4 &&
          expected.every(([source, field, value]) =>
            rule.conditions.some(
              (c) =>
                c.field_source === source &&
                c.field === field &&
                c.operator === "eq" &&
                same(String(c.value), value),
            ),
          ),
      );
      const eth = await chainChecks(p);
      const [gas, price, nonce, latestNonce] = await Promise.all([
        rpc.estimateGas({ account: getAddress(p.wallet), to: PAYMENT_TOKEN, data: dataFor(p) }),
        rpc.getGasPrice(),
        rpc.getTransactionCount({ address: getAddress(p.wallet), blockTag: "pending" }),
        rpc.getTransactionCount({ address: getAddress(p.wallet), blockTag: "latest" }),
      ]);
      ensure(
        nonce === latestNonce &&
          BigInt(p.gas!) * BigInt(p.gas_price!) <= 100000000000000n &&
          gas <= BigInt(p.gas!) &&
          price <= BigInt(p.gas_price!) &&
          eth >= BigInt(p.gas!) * BigInt(p.gas_price!),
      );
      localWallet(db, p);
      const changed = db
        .prepare(
          "UPDATE wa_payments SET state='submitting',nonce=? WHERE id=? AND lease=? AND lease_until>? AND state='preflight' AND expires>?",
        )
        .run(nonce, p.id, lease, Date.now(), Date.now());
      ensure(changed.changes === 1);
      submitted = true;
      p.nonce = nonce;
      const result = await privy
        .wallets()
        .ethereum()
        .sendTransaction(p.provider_id, {
          caip2: "eip155:46630",
          sponsor: false,
          reference_id: p.reference_id,
          idempotency_key: p.idempotency_key,
          request_expiry: Date.now() + 60000,
          params: {
            transaction: {
              chain_id: 46630,
              to: PAYMENT_TOKEN,
              value: "0x0",
              data: dataFor(p),
              nonce: toHex(nonce),
              gas_limit: toHex(BigInt(p.gas!)),
              gas_price: toHex(BigInt(p.gas_price!)),
              type: 0,
            },
          },
          authorization_context: {
            authorization_private_keys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY!],
          },
        });
      ensure(/^0x[a-fA-F0-9]{64}$/.test(result.hash));
      db.prepare("UPDATE wa_payments SET state='broadcast',tx_hash=? WHERE id=? AND lease=?").run(
        result.hash,
        p.id,
        lease,
      );
      p.tx_hash = result.hash;
    }
    if (!p.tx_hash) {
      ensure(p.app_id === process.env.PRIVY_APP_ID);
      const response = await fetch(
        "https://api.privy.io/v1/transactions?reference_id=" + encodeURIComponent(p.reference_id),
        {
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(process.env.PRIVY_APP_ID + ":" + process.env.PRIVY_APP_SECRET).toString(
                "base64",
              ),
            "privy-app-id": process.env.PRIVY_APP_ID!,
          },
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
      ensure(response.ok);
      const data = (await response.json()) as {
        transactions?: {
          transaction_hash: string | null;
          wallet_id: string;
          reference_id?: string;
          caip2: string;
        }[];
      };
      ensure(data.transactions?.length === 1);
      const tx = data.transactions![0];
      ensure(
        tx.wallet_id === p.provider_id &&
          tx.reference_id === p.reference_id &&
          tx.caip2 === "eip155:46630" &&
          tx.transaction_hash &&
          /^0x[a-fA-F0-9]{64}$/.test(tx.transaction_hash),
      );
      p.tx_hash = tx.transaction_hash!;
      db.prepare("UPDATE wa_payments SET tx_hash=? WHERE id=? AND lease=?").run(
        p.tx_hash,
        p.id,
        lease,
      );
    }
    ensure((await rpc.getChainId()) === 46630);
    const hash = p.tx_hash as `0x${string}`;
    const [receipt, tx, head] = await Promise.all([
      rpc.getTransactionReceipt({ hash }),
      rpc.getTransaction({ hash }),
      rpc.getBlockNumber(),
    ]);
    ensure(head >= receipt.blockNumber + 1n);
    ensure(
      same(tx.from, p.wallet) &&
        same(tx.to!, PAYMENT_TOKEN) &&
        tx.chainId === 46630 &&
        tx.value === 0n &&
        tx.input === dataFor(p) &&
        tx.nonce === p.nonce,
    );
    if (receipt.status !== "success") {
      update(
        "failed",
        "execution_reverted",
        "The payment failed on the network. No Demo USD was transferred; a network fee may have been charged.\n\nhttps://explorer.testnet.chain.robinhood.com/tx/" +
          hash,
      );
      return;
    }
    const events = parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: receipt.logs.filter((l) => same(l.address, PAYMENT_TOKEN)),
    });
    ensure(
      events.length === 1 &&
        same(events[0].args.from, p.wallet) &&
        same(events[0].args.to, p.destination) &&
        events[0].args.value === BigInt(p.amount),
    );
    update(
      "confirmed",
      null,
      `Payment complete ✅\n\n${formatUnits(BigInt(p.amount), 6)} Demo USD\nTo: ${paymentContactLabel(db, key, p.id) ? paymentContactLabel(db, key, p.id) + "\n" : ""}${p.destination}\nNetwork fee: ${formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} test ETH\n\nhttps://explorer.testnet.chain.robinhood.com/tx/${hash}`,
    );
  } catch {
    if (submitted)
      update(
        p.tx_hash ? "broadcast" : "unknown",
        "awaiting_reconciliation",
        Date.now() - (p.confirmed_at ?? p.created) >= 30000
          ? "Your payment is taking longer than expected. Please don’t send it again. I’ll send the receipt here when it is confirmed."
          : undefined,
        "checking",
      );
    else
      update(
        "failed",
        "preflight_failed",
        "This payment could not be sent. Your balance, fee estimate or setup may have changed. Choose Send payment to review a new payment. Nothing was submitted.",
      );
  }
}
