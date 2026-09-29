import assert from "node:assert/strict";
import test from "node:test";
import { broadcastGasPrice, executionGasLimit } from "../src/server/stocks/mainnet-trade";

// Reviewed swap step: provider gas 287,581 x 1.25 and a 25% price ceiling.
const reviewedGas = 359477n;
const reviewedPrice = 44147500n; // 35,318,000 wei x 1.25, rounded up
const price = 35318000n;

test("estimates within the reviewed gas keep the reviewed limit", () => {
  assert.equal(executionGasLimit(313835n, reviewedGas, reviewedPrice, price), reviewedGas);
});

test("a higher estimate is accepted when it still fits the confirmed fee", () => {
  // Above 359,477 units, but 10%-padded limit x actual price stays under the reviewed fee.
  const limit = executionGasLimit(400000n, reviewedGas, reviewedPrice, price);
  assert.equal(limit, 440000n);
  assert.ok(limit! * price <= reviewedGas * reviewedPrice);
});

test("an estimate that would exceed the confirmed fee is refused", () => {
  assert.equal(executionGasLimit(420000n, reviewedGas, reviewedPrice, price), null);
});

test("no headroom is taken when the price is already at the ceiling", () => {
  assert.equal(
    executionGasLimit(reviewedGas + 1n, reviewedGas, reviewedPrice, reviewedPrice),
    null,
  );
});

test("invalid inputs are refused", () => {
  assert.equal(executionGasLimit(0n, reviewedGas, reviewedPrice, price), null);
  assert.equal(executionGasLimit(300000n, reviewedGas, reviewedPrice, 0n), null);
  assert.equal(executionGasLimit(300000n, reviewedGas, reviewedPrice, reviewedPrice + 1n), null);
});

test("broadcast bid clears a small base-fee rise seen at 2026-09-29 10:39 UTC", () => {
  // Privy rejected a sell bid of exactly the read base fee after it rose 20,132,000 -> 20,138,000.
  const bid = broadcastGasPrice(20_132_000n, 20_132_000n, 25_165_000n);
  assert.equal(bid, 21_138_600n);
  assert.ok(bid > 20_138_000n);
});

test("broadcast bid uses the higher of suggestion and base fee, capped at the ceiling", () => {
  assert.equal(broadcastGasPrice(30_000_000n, 20_000_000n, 40_000_000n), 31_500_000n);
  assert.equal(broadcastGasPrice(20_000_000n, 30_000_000n, 40_000_000n), 31_500_000n);
  assert.equal(broadcastGasPrice(39_000_000n, 20_000_000n, 40_000_000n), 40_000_000n);
});

test("the bid still leaves gas headroom for a low provider estimate", () => {
  // Reviewed limit 359,477 at a 25% price ceiling; a 375,000 estimate still fits at a 5% bid.
  const price = 35_318_000n;
  const bid = broadcastGasPrice(price, price, 44_147_500n);
  assert.equal(executionGasLimit(375_000n, reviewedGas, reviewedPrice, bid), 412_500n);
});
