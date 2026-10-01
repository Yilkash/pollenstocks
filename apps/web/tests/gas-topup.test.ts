import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, mock, test } from "node:test";
import {
  GAS_TOPUP_DEFAULT_WEI,
  gasTopupConfig,
  gasTopupEligible,
  migrateGasTopups,
  welcomeGasTopup,
} from "../src/server/stocks/gas-topup";

afterEach(() => mock.restoreAll());

const e18 = 10n ** 18n;
const usdg = 10n ** 6n;
const base = {
  used: false,
  sentToday: 0,
  dailyLimit: 10,
  userUsdg: 1n * usdg,
  userNative: 0n,
  amount: GAS_TOPUP_DEFAULT_WEI,
  funderNative: e18 / 100n,
  transferFee: 1_050_000_000_000n,
};

test("a new wallet with at least 1 USDG and no ETH gets a top-up", () => {
  assert.equal(gasTopupEligible(base), true);
});

test("top-ups are refused when any safety rule fails", () => {
  assert.equal(gasTopupEligible({ ...base, used: true }), false, "one per wallet");
  assert.equal(gasTopupEligible({ ...base, sentToday: 10 }), false, "daily limit");
  assert.equal(gasTopupEligible({ ...base, userUsdg: usdg - 1n }), false, "needs 1 USDG");
  assert.equal(gasTopupEligible({ ...base, userNative: GAS_TOPUP_DEFAULT_WEI }), false, "has ETH");
  assert.equal(
    gasTopupEligible({ ...base, funderNative: GAS_TOPUP_DEFAULT_WEI }),
    false,
    "refill wallet must also cover its own fee",
  );
});

test("config is off without a wallet and never exceeds the policy cap", () => {
  const saved = { ...process.env };
  try {
    delete process.env.GAS_TOPUP_WALLET_ID;
    assert.equal(gasTopupConfig(), undefined);
    process.env.GAS_TOPUP_WALLET_ID = "wallet";
    process.env.GAS_TOPUP_WALLET_ADDRESS = "0x000000000000000000000000000000000000dEaD";
    process.env.GAS_TOPUP_WEI = "300000000000000"; // above the cap
    assert.equal(gasTopupConfig()?.amount, GAS_TOPUP_DEFAULT_WEI);
    process.env.GAS_TOPUP_WEI = "50000000000000";
    assert.equal(gasTopupConfig()?.amount, 50_000_000_000_000n);
    assert.equal(gasTopupConfig()?.dailyLimit, 10);
  } finally {
    process.env = saved;
  }
});

test("an account or wallet that already had a top-up is skipped without network calls", async () => {
  const saved = { ...process.env };
  const db = new DatabaseSync(":memory:");
  mock.method(globalThis, "fetch", async () => {
    throw Error("unexpected network access");
  });
  try {
    process.env.GAS_TOPUP_WALLET_ID = "wallet";
    process.env.GAS_TOPUP_WALLET_ADDRESS = "0x000000000000000000000000000000000000dEaD";
    process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY = "test";
    migrateGasTopups(db);
    db.prepare(
      "INSERT INTO wa_gas_topups(account_id,wallet,amount,reference_id,idempotency_key,state,created) VALUES('a1','0x00000000000000000000000000000000000000A1','1','r','k','unknown',0)",
    ).run();
    assert.equal(
      await welcomeGasTopup(db, "a1", "0x00000000000000000000000000000000000000B2"),
      "skipped",
    );
    assert.equal(
      await welcomeGasTopup(db, "a2", "0x00000000000000000000000000000000000000a1"),
      "skipped",
    );
  } finally {
    db.close();
    process.env = saved;
  }
});
