import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAINNET_ASSETS,
  MAINNET_STOCK_SYMBOLS,
  ORIGINAL_MAINNET_STOCKS,
  mainnetStockChoices,
} from "../src/server/networks/robinhood";
import {
  addedStockApproveRules,
  canonicalPolicy,
  lifiPolicyRule,
  stockApproveRule,
  validateMainnetPolicyRules,
} from "../src/server/stocks/mainnet-policy";
import {
  MAINNET_STOCK_ALIAS_PATTERN,
  mainnetStockForUnit,
  mainnetStockMentions,
} from "../src/server/stocks/stock-language";
import { conversationRules } from "../src/server/whatsapp/assistant-conversation";
import { assistantTools } from "../src/server/whatsapp/assistant-tools";

const base = JSON.parse(
  readFileSync(new URL("../../../docs/privy-mainnet-policy.json", import.meta.url), "utf8"),
).rules;
const key = (r: { action: string; method: string; conditions: unknown[] }) =>
  canonicalPolicy({
    action: r.action,
    method: r.method,
    conditions: r.conditions.map(canonicalPolicy).sort(),
  });
const msft = MAINNET_ASSETS.MSFT.address;

test("catalogue holds the original three plus six verified additions", () => {
  assert.deepEqual(MAINNET_STOCK_SYMBOLS, [
    "AAPL",
    "NVDA",
    "TSLA",
    "MSFT",
    "GOOGL",
    "AMZN",
    "META",
    "SPY",
    "QQQ",
  ]);
  assert.deepEqual(ORIGINAL_MAINNET_STOCKS, ["AAPL", "NVDA", "TSLA"]);
  assert.equal(addedStockApproveRules.length, 6);
  assert.match(mainnetStockChoices(), /^Apple, NVIDIA, Tesla, .+ or Nasdaq-100 ETF$/);
});

test("generated approve rules match the reviewed policy template exactly", () => {
  const aapl = base.find(
    (r: { name: string }) => r.name === `Approve ${MAINNET_ASSETS.AAPL.address}`,
  );
  assert.ok(aapl);
  assert.equal(key(stockApproveRule(MAINNET_ASSETS.AAPL.address)), key(aapl));
});

test("policy validates before, during and after the stock rollout", () => {
  const withLifi = [...base, lifiPolicyRule];
  const full = [...withLifi, ...addedStockApproveRules];
  const partial = [...withLifi, addedStockApproveRules[0]];
  for (const rules of [base, withLifi, partial, full])
    assert.doesNotThrow(() => validateMainnetPolicyRules(rules, false));
  assert.doesNotThrow(() => validateMainnetPolicyRules(full, true));
  assert.throws(() => validateMainnetPolicyRules(base, true));
});

test("selling an added stock requires its approve rule; original stocks never do", () => {
  const withLifi = [...base, lifiPolicyRule];
  assert.throws(
    () => validateMainnetPolicyRules(withLifi, false, msft),
    /stock_not_enabled_for_selling/,
  );
  assert.doesNotThrow(() =>
    validateMainnetPolicyRules([...withLifi, stockApproveRule(msft)], false, msft),
  );
  assert.doesNotThrow(() =>
    validateMainnetPolicyRules(withLifi, false, MAINNET_ASSETS.AAPL.address),
  );
});

test("policy still rejects unknown, duplicate or missing rules", () => {
  const stranger = stockApproveRule("0x0000000000000000000000000000000000000001");
  assert.throws(() => validateMainnetPolicyRules([...base, stranger], false));
  assert.throws(() =>
    validateMainnetPolicyRules([...base, stockApproveRule(msft), stockApproveRule(msft)], false),
  );
  assert.throws(() => validateMainnetPolicyRules(base.slice(1), false));
});

test("company names and tickers resolve to the right stock", () => {
  const cases: [string, string[]][] = [
    ["Buy Microsoft with 1 USDG", ["MSFT"]],
    ["how much is google", ["GOOGL"]],
    ["Alphabet price", ["GOOGL"]],
    ["buy some amazon", ["AMZN"]],
    ["Facebook stock", ["META"]],
    ["META price", ["META"]],
    ["put 5 USDG into the S&P 500", ["SPY"]],
    ["buy SPY", ["SPY"]],
    ["Nasdaq-100 please", ["QQQ"]],
    ["nasdaq 100", ["QQQ"]],
    ["apple and google", ["AAPL", "GOOGL"]],
    ["sell 0.001 Apple shares", ["AAPL"]],
    ["update my metadata", []],
    ["spyware", []],
    ["Dangote", []],
  ];
  for (const [input, expected] of cases)
    assert.deepEqual(mainnetStockMentions(input), expected, input);
});

test("units and quantities accept the new company names", () => {
  assert.equal(mainnetStockForUnit("Microsoft"), "MSFT");
  assert.equal(mainnetStockForUnit("msft"), "MSFT");
  assert.equal(mainnetStockForUnit("S&P 500"), "SPY");
  assert.equal(mainnetStockForUnit("Microsoft and Apple"), undefined);
  assert.equal(mainnetStockForUnit("USDG"), undefined);
  const quantity = new RegExp(
    `(?<![\\p{L}\\p{N}.+-])(\\d+(?:\\.\\d+)?)\\s*(?:shares?|tokens?|${MAINNET_STOCK_ALIAS_PATTERN})(?![\\p{L}\\p{N}])`,
    "iu",
  );
  assert.equal(quantity.exec("sell 0.5 Microsoft")?.[1], "0.5");
  assert.equal(quantity.exec("sell 2 QQQ")?.[1], "2");
});

test("assistant instructions and tool schemas list every supported stock", () => {
  for (const symbol of MAINNET_STOCK_SYMBOLS) assert.ok(conversationRules.includes(`(${symbol})`));
  const trade = assistantTools.find((t) => t.function.name === "prepare_mainnet_stock_trade");
  const symbol = (trade?.function.parameters.properties as { symbol: { enum: string[] } }).symbol;
  assert.deepEqual(symbol.enum, MAINNET_STOCK_SYMBOLS);
});
