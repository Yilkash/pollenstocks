import assert from "node:assert/strict";
import test from "node:test";
import { executionGasLimit } from "../src/server/stocks/mainnet-trade";

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
