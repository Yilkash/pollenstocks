import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mainnetStockMentions } from "../src/server/stocks/stock-language";
import { fetchMainnetRoute, KYBER_RETRY_DELAYS_MS } from "../src/server/stocks/kyber-route";

// Keep retry tests fast; the attempt count is what matters here.
KYBER_RETRY_DELAYS_MS.splice(0, KYBER_RETRY_DELAYS_MS.length, 0, 0);
import { migrateAccounts } from "../src/server/whatsapp/accounts";
import {
  currentTask,
  runAssistantTool,
  spokenNumbers,
} from "../src/server/whatsapp/assistant-tools";

afterEach(() => mock.restoreAll());

for (const name of ["NVIDIA", "nvidias", "NVIDIA's", "NVIDIA’s", "NVDA"]) {
  test(`stock request recognises ${name} and preserves its 0.2 USDC budget`, async () => {
    const db = new DatabaseSync(":memory:");
    const key = Buffer.alloc(32, 3);
    const enabled = process.env.MAINNET_STOCK_TRADING_ENABLED;
    process.env.MAINNET_STOCK_TRADING_ENABLED = "false";
    mock.method(globalThis, "fetch", async () => {
      throw Error("unexpected network access");
    });
    try {
      migrateAccounts(db);
      const input = `I want to buy ${name} token with 0.2 usdc`;
      await runAssistantTool(
        db,
        key,
        "test-account",
        "15550001111",
        "message",
        "consent",
        input,
        input,
        "prepare_mainnet_stock_trade",
        { symbol: "NVDA", side: "buy", amount: "0.2", unit: "USDC" },
      );
      const draft = currentTask(db, key, "test-account", "consent");
      assert.equal(draft?.mainnetSymbol, "NVDA");
      assert.equal(draft?.side, "buy");
      assert.equal(draft?.amount, "0.2");
      assert.equal(draft?.unit, "USDC");
      assert.equal(draft?.desiredQuantity, undefined);
      assert.equal(
        (db.prepare("SELECT count(*) AS n FROM wa_mainnet_orders").get() as { n: number }).n,
        0,
      );
    } finally {
      db.close();
      if (enabled === undefined) delete process.env.MAINNET_STOCK_TRADING_ENABLED;
      else process.env.MAINNET_STOCK_TRADING_ENABLED = enabled;
    }
  });
}

test("a sell for USDC keeps the stock quantity as its unit", async () => {
  const db = new DatabaseSync(":memory:");
  const enabled = process.env.MAINNET_STOCK_TRADING_ENABLED;
  process.env.MAINNET_STOCK_TRADING_ENABLED = "false";
  mock.method(globalThis, "fetch", async () => {
    throw Error("unexpected network access");
  });
  try {
    migrateAccounts(db);
    const key = Buffer.alloc(32, 3);
    const input = "Sell 0.001 NVIDIA tokens for USDC";
    await runAssistantTool(
      db,
      key,
      "test-account",
      "15550001111",
      "message",
      "consent",
      input,
      input,
      "prepare_mainnet_stock_trade",
      { symbol: "NVDA", side: "sell", amount: "0.001" },
    );
    const draft = currentTask(db, key, "test-account", "consent");
    assert.equal(draft?.side, "sell");
    assert.equal(draft?.amount, "0.001");
    assert.equal(draft?.unit, "NVDA");
  } finally {
    db.close();
    if (enabled === undefined) delete process.env.MAINNET_STOCK_TRADING_ENABLED;
    else process.env.MAINNET_STOCK_TRADING_ENABLED = enabled;
  }
});

test("a USDC payment request is not asked to restate its currency", async () => {
  const db = new DatabaseSync(":memory:");
  mock.method(globalThis, "fetch", async () => {
    throw Error("unexpected network access");
  });
  mock.method(console, "warn", () => undefined);
  try {
    migrateAccounts(db);
    const key = Buffer.alloc(32, 3);
    const input = "Send 1 usdc to 0xef811f37adb712258e1d04f41316285099ffb379";
    const reply = await runAssistantTool(
      db,
      key,
      "test-account",
      "15550001111",
      "message",
      "consent",
      input,
      input,
      "prepare_payment",
      { recipient: "0xef811f37adb712258e1d04f41316285099ffb379", amount: "1" },
    ).catch((e: unknown) => e);
    assert.doesNotMatch(JSON.stringify(reply), /What USDC amount/);
  } finally {
    db.close();
  }
});

for (const input of [
  "I want to use 1 usd to buy a share of nvdia",
  "Buy NVIDIA with 1 dollar",
  "buy nvidia with $1",
]) {
  test(`"${input}" is a 1 USDC NVIDIA buy`, async () => {
    const db = new DatabaseSync(":memory:");
    const key = Buffer.alloc(32, 3);
    const enabled = process.env.MAINNET_STOCK_TRADING_ENABLED;
    process.env.MAINNET_STOCK_TRADING_ENABLED = "false";
    mock.method(globalThis, "fetch", async () => {
      throw Error("unexpected network access");
    });
    try {
      migrateAccounts(db);
      // The model reads "usd"/"dollar" as the unit; the tool must not reject it.
      await runAssistantTool(
        db,
        key,
        "test-account",
        "15550001111",
        "message",
        "consent",
        input,
        input,
        "prepare_mainnet_stock_trade",
        { symbol: "NVDA", side: "buy", amount: "1", unit: "USD" },
      );
      const draft = currentTask(db, key, "test-account", "consent");
      assert.equal(draft?.amount, "1");
      assert.equal(draft?.unit, "USDC");
    } finally {
      db.close();
      if (enabled === undefined) delete process.env.MAINNET_STOCK_TRADING_ENABLED;
      else process.env.MAINNET_STOCK_TRADING_ENABLED = enabled;
    }
  });
}

async function tradeTool(input: string, args: Record<string, string>) {
  const db = new DatabaseSync(":memory:");
  const key = Buffer.alloc(32, 3);
  const enabled = process.env.MAINNET_STOCK_TRADING_ENABLED;
  process.env.MAINNET_STOCK_TRADING_ENABLED = "false";
  mock.method(globalThis, "fetch", async () => {
    throw Error("unexpected network access");
  });
  try {
    migrateAccounts(db);
    const reply = (await runAssistantTool(
      db,
      key,
      "test-account",
      "15550001111",
      "message",
      "consent",
      input,
      input,
      "prepare_mainnet_stock_trade",
      args,
    )) as { text?: { body: string } };
    return {
      reply: reply.text?.body ?? "",
      draft: currentTask(db, key, "test-account", "consent"),
    };
  } finally {
    db.close();
    if (enabled === undefined) delete process.env.MAINNET_STOCK_TRADING_ENABLED;
    else process.env.MAINNET_STOCK_TRADING_ENABLED = enabled;
  }
}

test("spoken amounts become digits", () => {
  assert.equal(spokenNumbers("buy nvidia with five usdc"), "buy nvidia with 5 usdc");
  assert.equal(spokenNumbers("twenty five dollars"), "25 dollars");
  assert.equal(spokenNumbers("two hundred"), "200");
  assert.equal(spokenNumbers("someone"), "someone");
});

test("an amount written in words is accepted", async () => {
  const { draft } = await tradeTool("Buy NVIDIA with five USDC", {
    symbol: "NVDA",
    side: "buy",
    amount: "5",
    unit: "USDC",
  });
  assert.equal(draft?.amount, "5");
});

test("an amount the user never said is still rejected", async () => {
  const { reply } = await tradeTool("Buy NVIDIA with five USDC", {
    symbol: "NVDA",
    side: "buy",
    amount: "50",
    unit: "USDC",
  });
  assert.match(reply, /How much/);
});

test("the model may name the stock when the user describes it", async () => {
  const { draft } = await tradeTool("Buy the GeForce chip maker with 5 USDC", {
    symbol: "NVDA",
    side: "buy",
    amount: "5",
    unit: "USDC",
  });
  assert.equal(draft?.mainnetSymbol, "NVDA");
});

test("the model may not swap a stock the user named", async () => {
  const { reply } = await tradeTool("Buy Circle with 5 USDC", {
    symbol: "NVDA",
    side: "buy",
    amount: "5",
    unit: "USDC",
  });
  assert.match(reply, /^Which stock/);
});

test("a buy that mentions the price still prepares a trade", async () => {
  const { reply } = await tradeTool("Buy NVIDIA at the current price with 5 USDC", {
    symbol: "NVDA",
    side: "buy",
    amount: "5",
    unit: "USDC",
  });
  assert.match(reply, /trading setup is still pending/);
});

test("aliases preserve boundaries and identify ambiguous multiple stocks", () => {
  assert.deepEqual(mainnetStockMentions("encircled NVIDIAton NVDAs CircleXYZ amcx"), []);
  assert.deepEqual(mainnetStockMentions("NVIDIA and Circle"), ["NVDA", "CRCL"]);
  assert.deepEqual(mainnetStockMentions("NVIDIA's shares"), ["NVDA"]);
  assert.deepEqual(mainnetStockMentions("Sell 0.003 nvdia shares"), ["NVDA"]);
  assert.deepEqual(mainnetStockMentions("buy circel and nvdia"), ["NVDA", "CRCL"]);
  assert.deepEqual(mainnetStockMentions("application applause fbi"), []);
});

const query = new URLSearchParams({ amountIn: "200000" });
for (const status of [429, 502, 503, 504]) {
  test(`read-only quote retries HTTP ${status} once`, async () => {
    let calls = 0;
    mock.method(console, "warn", () => undefined);
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      assert.match(
        String(url),
        /^https:\/\/aggregator-api\.kyberswap\.com\/arc\/api\/v1\/routes\?/,
      );
      assert.ok(!init?.method || init.method === "GET");
      calls++;
      return calls === 1 ? new Response(null, { status }) : Response.json({ code: 0 });
    });
    assert.equal((await fetchMainnetRoute(query)).status, 200);
    assert.equal(calls, 2);
  });
}
test("continued overload stops after three GETs and reports busy", async () => {
  let calls = 0;
  mock.method(console, "warn", () => undefined);
  mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(null, { status: 503 });
  });
  await assert.rejects(fetchMainnetRoute(query), /route_busy/);
  assert.equal(calls, 3);
});
test("a 429 burst recovers on the third attempt", async () => {
  let calls = 0;
  mock.method(console, "warn", () => undefined);
  mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls < 3 ? new Response(null, { status: 429 }) : Response.json({ code: 0 });
  });
  assert.equal((await fetchMainnetRoute(query)).status, 200);
  assert.equal(calls, 3);
});
test("nontransient HTTP failures are not retried", async () => {
  let calls = 0;
  mock.method(console, "warn", () => undefined);
  mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(null, { status: 400 });
  });
  await assert.rejects(fetchMainnetRoute(query), /route_unavailable/);
  assert.equal(calls, 1);
});
test("network failure retries only the quote lookup", async () => {
  let calls = 0;
  mock.method(console, "warn", () => undefined);
  mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("network timeout");
  });
  await assert.rejects(fetchMainnetRoute(query), /route_unavailable/);
  assert.equal(calls, 3);
});
