import assert from "node:assert/strict";
import test from "node:test";
import {
  privyNeverBroadcast,
  unsentStepCanClose,
  UNSENT_EXPIRY_MARGIN_MS,
} from "../src/server/stocks/unsent-step";

const expected = { walletId: "wallet-1", referenceId: "mainnet:order:0" };
const failed = {
  transaction_hash: null,
  wallet_id: "wallet-1",
  reference_id: "mainnet:order:0",
  caip2: "eip155:4663",
  status: "failed",
};
const expires = 1_000_000;
const closable = {
  neverBroadcast: true,
  orderExpires: expires,
  now: expires + UNSENT_EXPIRY_MARGIN_MS + 1,
  stepNonce: 7,
  latestNonce: 7,
  pendingNonce: 7,
};

test("no Privy record or a failed record without a hash counts as never broadcast", () => {
  assert.equal(privyNeverBroadcast([], expected), true);
  assert.equal(privyNeverBroadcast([failed], expected), true);
  assert.equal(privyNeverBroadcast([{ ...failed, status: "provider_error" }], expected), true);
});

test("pending, hashed, foreign or duplicate Privy records are not treated as unsent", () => {
  assert.equal(privyNeverBroadcast([{ ...failed, status: "pending" }], expected), false);
  assert.equal(privyNeverBroadcast([{ ...failed, status: undefined }], expected), false);
  assert.equal(
    privyNeverBroadcast([{ ...failed, transaction_hash: "0x" + "1".repeat(64) }], expected),
    false,
  );
  assert.equal(privyNeverBroadcast([{ ...failed, wallet_id: "other" }], expected), false);
  assert.equal(privyNeverBroadcast([{ ...failed, reference_id: "other" }], expected), false);
  assert.equal(privyNeverBroadcast([{ ...failed, caip2: "eip155:1" }], expected), false);
  assert.equal(privyNeverBroadcast([failed, failed], expected), false);
});

test("an expired order whose nonce is still unused can close", () => {
  assert.equal(unsentStepCanClose(closable), true);
});

test("the order must be past expiry plus the margin", () => {
  assert.equal(unsentStepCanClose({ ...closable, now: expires + UNSENT_EXPIRY_MARGIN_MS }), false);
  assert.equal(unsentStepCanClose({ ...closable, now: expires - 1 }), false);
});

test("a used or pending nonce keeps the order open for review", () => {
  assert.equal(unsentStepCanClose({ ...closable, latestNonce: 8, pendingNonce: 8 }), false);
  assert.equal(unsentStepCanClose({ ...closable, pendingNonce: 8 }), false);
  assert.equal(unsentStepCanClose({ ...closable, stepNonce: null }), false);
  assert.equal(unsentStepCanClose({ ...closable, neverBroadcast: false }), false);
});
