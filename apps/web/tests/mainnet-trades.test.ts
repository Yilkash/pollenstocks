import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseAbiParameters,
  toBytes,
  type Address,
  type Log,
} from "viem";
import { DatabaseSync } from "node:sqlite";
import {
  deskTradeData,
  validateMainnetPlan,
  type MainnetPlan,
} from "../src/server/stocks/mainnet-trade";
import { mainnetTradeOutput } from "../src/server/stocks/mainnet-trade-receipt";
import { deskAbi } from "../src/server/stocks/arcstocks-desk";
import { fullyBacked } from "../src/server/stocks/backing";
import {
  mainnetPolicyRules,
  validateMainnetPolicyRules,
} from "../src/server/stocks/mainnet-policy";
import {
  ARCSTOCKS_DESK,
  MAINNET_ASSETS,
  MAINNET_QUOTE,
  NATIVE_TRANSFER_LOGGER,
} from "../src/server/networks/chain";
import {
  mainnetConfirmationReply,
  migrateMainnetOrders,
  orderDigest,
} from "../src/server/stocks/mainnet-orders";
const stranger = "0x1111111111111111111111111111111111111111" as Address;
const wallet = "0x2222222222222222222222222222222222222222" as Address;
const NVDA = MAINNET_ASSETS.NVDA.address;
process.env.PRIVY_MAINNET_POLICY_ID = "test-policy";
process.env.MAINNET_MAX_USDC_PER_TRADE = "10";
process.env.MAINNET_MAX_FEE_WEI = "1000000000000000";
const id = "11111111-1111-4111-8111-111111111111";
const base = () => ({
  provider: "arcstocks-desk" as const,
  id,
  orderId: keccak256(toBytes(`pollenstocks-arc-v1:${wallet.toLowerCase()}:${id}`)),
  wallet,
  router: ARCSTOCKS_DESK as Address,
  symbol: "NVDA" as const,
  deadline: Math.floor(Date.now() / 1000) + 200,
});
// Buy NVDA with 1 USDC: one payable desk call carrying 1 USDC (18-decimal native value).
function buyPlan(): MainnetPlan {
  const p = {
    ...base(),
    side: "buy" as const,
    inputToken: MAINNET_QUOTE.address as Address,
    outputToken: NVDA as Address,
    amountIn: "1000000",
    expectedOutput: "4242983906768669",
    minimumOutput: ((4242983906768669n * 99n) / 100n).toString(),
  };
  return {
    ...p,
    steps: [
      {
        kind: "trade",
        to: ARCSTOCKS_DESK,
        data: deskTradeData(p),
        value: "1000000000000000000",
        gas: "120000",
        gasPrice: "1000000",
      },
    ],
  };
}
// Sell 0.01 NVDA: an exact approval to the desk, then the desk sell.
function sellPlan(): MainnetPlan {
  const p = {
    ...base(),
    side: "sell" as const,
    inputToken: NVDA as Address,
    outputToken: MAINNET_QUOTE.address as Address,
    amountIn: "10000000000000000",
    expectedOutput: "2337296",
    minimumOutput: ((2337296n * 99n) / 100n).toString(),
  };
  return {
    ...p,
    steps: [
      {
        kind: "approve",
        to: NVDA,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [ARCSTOCKS_DESK, 10000000000000000n],
        }),
        gas: "100000",
        gasPrice: "1000000",
      },
      {
        kind: "trade",
        to: ARCSTOCKS_DESK,
        data: deskTradeData(p),
        gas: "150000",
        gasPrice: "1000000",
      },
    ],
  };
}
test("valid desk buy and sell plans pass structural checks", () => {
  assert.doesNotThrow(() => validateMainnetPlan(buyPlan()));
  assert.doesNotThrow(() => validateMainnetPlan(sellPlan()));
});
test("rejects recipient, pair, amount, minimum, value, venue and fee mutations", () => {
  const mutate: [() => MainnetPlan, (p: MainnetPlan) => void][] = [
    [buyPlan, (p) => void (p.wallet = stranger)],
    [buyPlan, (p) => void (p.outputToken = MAINNET_QUOTE.address)],
    [buyPlan, (p) => void (p.amountIn = "11000000")],
    [buyPlan, (p) => void (p.minimumOutput = "1")],
    [buyPlan, (p) => void (p.steps[0].value = "2000000000000000000")],
    [buyPlan, (p) => void delete p.steps[0].value],
    [buyPlan, (p) => void (p.steps[0].to = stranger)],
    [buyPlan, (p) => void (p.router = stranger)],
    [buyPlan, (p) => void (p.steps[0].gasPrice = "99999999999999999")],
    [
      buyPlan,
      (p) =>
        void (p.steps[0].data = encodeFunctionData({
          abi: deskAbi,
          functionName: "buy",
          args: [NVDA, BigInt(p.minimumOutput), stranger],
        })),
    ],
    [sellPlan, (p) => void (p.steps[0].value = "1")],
    [
      sellPlan,
      (p) =>
        void (p.steps[0].data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [stranger, 10000000000000000n],
        })),
    ],
    [
      sellPlan,
      (p) =>
        void (p.steps[0].data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [ARCSTOCKS_DESK, 2n ** 256n - 1n],
        })),
    ],
    [sellPlan, (p) => void (p.steps = [p.steps[1]])],
    [
      sellPlan,
      (p) =>
        void (p.steps[1].data = encodeFunctionData({
          abi: deskAbi,
          functionName: "sell",
          args: [NVDA, BigInt(p.amountIn), 0n, wallet],
        })),
    ],
  ];
  for (const [make, change] of mutate) {
    const p = make();
    change(p);
    assert.throws(() => validateMainnetPlan(p));
  }
});

const transferLog = (token: Address, from: Address, to: Address, value: bigint) =>
  ({
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }),
    data: encodeAbiParameters(parseAbiParameters("uint256"), [value]),
  }) as unknown as Log;
const deskLog = (name: "Bought" | "Sold", who: Address, a: bigint, b: bigint) =>
  ({
    address: ARCSTOCKS_DESK,
    topics: encodeEventTopics({
      abi: deskAbi,
      eventName: name,
      args: name === "Bought" ? { stock: NVDA, buyer: who } : { stock: NVDA, seller: who },
    }),
    data: encodeAbiParameters(parseAbiParameters("address,uint256,uint256,uint256"), [
      who,
      a,
      b,
      234n * 10n ** 18n,
    ]),
  }) as unknown as Log;
test("a desk buy receipt yields the shares received", () => {
  const p = buyPlan();
  const usdc = 10n ** 18n,
    shares = BigInt(p.expectedOutput);
  const logs = [
    transferLog(NATIVE_TRANSFER_LOGGER, wallet, ARCSTOCKS_DESK, usdc),
    transferLog(NVDA, ARCSTOCKS_DESK, wallet, shares),
    deskLog("Bought", wallet, usdc, shares),
  ];
  assert.equal(mainnetTradeOutput(p, logs), shares);
  // Shares sent elsewhere, or a short fill, are refused.
  assert.throws(() =>
    mainnetTradeOutput(p, [logs[0], transferLog(NVDA, ARCSTOCKS_DESK, stranger, shares), logs[2]]),
  );
  assert.throws(() =>
    mainnetTradeOutput(p, [logs[0], logs[1], deskLog("Bought", wallet, usdc, 1n)]),
  );
});
test("a desk sell receipt yields USDC received in 6 decimals", () => {
  const p = sellPlan();
  const shares = BigInt(p.amountIn),
    usdc = 2337296242750000000n;
  const logs = [
    transferLog(NVDA, wallet, ARCSTOCKS_DESK, shares),
    transferLog(NATIVE_TRANSFER_LOGGER, ARCSTOCKS_DESK, wallet, usdc),
    deskLog("Sold", wallet, shares, usdc),
  ];
  assert.equal(mainnetTradeOutput(p, logs), 2337296n);
  assert.throws(() => mainnetTradeOutput(p, [logs[0], logs[2]]));
});
test("the generated wallet policy validates, and a looser buy value is refused", () => {
  const rules = JSON.parse(JSON.stringify(mainnetPolicyRules()));
  assert.doesNotThrow(() => validateMainnetPolicyRules(rules, NVDA));
  const buy = rules.find((r: { name: string }) => r.name === "ArcStocks desk buy");
  buy.conditions.find((c: { field: string }) => c.field === "value").value =
    "0xffffffffffffffffffff";
  assert.throws(() => validateMainnetPolicyRules(rules));
});
test("backing holds only when the vault covers the Arc supply", () => {
  assert.equal(fullyBacked(100n, 100n), true);
  assert.equal(fullyBacked(1000n, 999n), true); // 0.1% in transit
  assert.equal(fullyBacked(1000n, 998n), false);
  assert.equal(fullyBacked(0n, 0n), true);
});
function dbFor(state = "review", expires = Date.now() + 60000) {
  const db = new DatabaseSync(":memory:");
  migrateMainnetOrders(db);
  db.prepare(
    "INSERT INTO wa_mainnet_orders(id,account_id,sender,recipient,source_message,payload,state,created,expires,confirmation_hash,reply_until) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "11111111-1111-4111-8111-111111111111",
    "account",
    "sender",
    "encrypted",
    "source",
    "encrypted",
    state,
    Date.now(),
    expires,
    orderDigest("a".repeat(48)),
    Date.now() + 60000,
  );
  return db;
}
test("cancel consumes a review once and cannot queue a trade", () => {
  const db = dbFor();
  try {
    const input = "mainstock:cancel:11111111-1111-4111-8111-111111111111:" + "a".repeat(48);
    mainnetConfirmationReply(db, Buffer.alloc(32), "account", input, "one");
    assert.equal(
      (db.prepare("SELECT state FROM wa_mainnet_orders").get() as { state: string }).state,
      "cancelled",
    );
    assert.match(
      mainnetConfirmationReply(db, Buffer.alloc(32), "account", input, "two").text.body,
      /expired or was used/,
    );
  } finally {
    db.close();
  }
});
test("wrong account and expired buttons cannot authorize", () => {
  const db = dbFor("review", Date.now() - 1);
  try {
    const input = "mainstock:confirm:11111111-1111-4111-8111-111111111111:" + "a".repeat(48);
    assert.match(
      mainnetConfirmationReply(db, Buffer.alloc(32), "other", input, "one").text.body,
      /expired or was used/,
    );
    assert.match(
      mainnetConfirmationReply(db, Buffer.alloc(32), "account", input, "two").text.body,
      /Quote expired/,
    );
  } finally {
    db.close();
  }
});
test("disabled environment flag prevents trade confirmation", () => {
  process.env.MAINNET_STOCK_TRADING_ENABLED = "false";
  const db = dbFor();
  try {
    const input = "mainstock:confirm:11111111-1111-4111-8111-111111111111:" + "a".repeat(48);
    assert.match(
      mainnetConfirmationReply(db, Buffer.alloc(32), "account", input, "one").text.body,
      /disabled/,
    );
    assert.equal(
      (db.prepare("SELECT state FROM wa_mainnet_orders").get() as { state: string }).state,
      "review",
    );
  } finally {
    db.close();
    delete process.env.MAINNET_STOCK_TRADING_ENABLED;
  }
});
