import assert from "node:assert/strict";
import { test, beforeEach, afterEach, mock } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { migrateAccounts, accountReply } from "../src/server/whatsapp/accounts";
import { senderLookup } from "../src/server/whatsapp/config";
import { provisionWallet } from "../src/server/whatsapp/provision-wallet";

const key = Buffer.alloc(32, 7),
  phone = "15550001111";
let db: DatabaseSync, id: string, postCount: number, directory: string, databasePath: string;
let provider: (url: string, init?: RequestInit) => Promise<Response>;
beforeEach(() => {
  Object.assign(process.env, {
    PRIVY_APP_ID: "test-app",
    PRIVY_APP_SECRET: "fake-secret",
    PRIVY_WALLET_OWNER_ID: "test-owner",
    PRIVY_WALLET_POLICY_ID: "test-policy",
    PRIVY_WALLET_CREATION_ENABLED: "true",
  });
  directory = mkdtempSync(join(tmpdir(), "steward-wallet-test-"));
  databasePath = join(directory, "test.sqlite");
  db = new DatabaseSync(databasePath);
  migrateAccounts(db);
  id = randomUUID();
  postCount = 0;
  db.prepare(
    "INSERT INTO wa_accounts(id,sender,consent_version,consent_at,consent_message_id,created) VALUES(?,?,?,?,?,?)",
  ).run(
    id,
    senderLookup(phone, key),
    "steward-test-account-v1",
    Date.now(),
    "enrollment",
    Date.now(),
  );
  db.prepare(
    "INSERT INTO wa_wallet_requests(account_id,external_id,idempotency_key,chain,created) VALUES(?,?,?,?,?)",
  ).run(id, "steward_" + id, randomUUID(), 46630, Date.now());
  provider = async (_url, init) =>
    init?.method === "POST" ? Response.json(wallet()) : new Response(null, { status: 404 });
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.match(String(url), /^https:\/\/api\.privy\.io\/v1\/wallets/);
    if (init?.method === "POST") postCount++;
    return provider(String(url), init);
  });
});
afterEach(() => {
  mock.restoreAll();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
function wallet() {
  return {
    id: "provider-wallet",
    address: "0x1111111111111111111111111111111111111111",
    external_id: "steward_" + id,
    owner_id: "test-owner",
    policy_ids: ["test-policy"],
    chain_type: "ethereum",
  };
}
function message(input: string, from = phone): any {
  db.exec("BEGIN IMMEDIATE");
  try {
    const reply = accountReply(db, key, { input, from, id: randomUUID() });
    db.exec("COMMIT");
    return reply;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function offer() {
  return message("My account").interactive.action.buttons[0].reply.id as string;
}
function queue() {
  message(offer());
}
function job(): any {
  return db.prepare("SELECT * FROM wa_wallet_provisioning").get();
}
function count(table: string) {
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}
function due() {
  db.exec("UPDATE wa_wallet_provisioning SET next_check=0,lease_until=0");
}
const run = () => provisionWallet(db, new Set([phone]), key);

test("old account consent alone cannot create a wallet", async () => {
  await run();
  assert.equal(postCount, 0);
  assert.equal(count("wa_wallet_provisioning"), 0);
});
test("consent is sender-bound, superseded, expiring and cancellable", () => {
  let button = offer();
  message(button, "15559999999");
  assert.equal(count("wa_wallet_provisioning"), 0);
  const next = offer();
  message(button);
  assert.equal(count("wa_wallet_provisioning"), 0);
  db.exec("UPDATE wa_wallet_setup_consents SET expires=0");
  message(next);
  assert.equal(count("wa_wallet_provisioning"), 0);
  button = offer();
  message(button.replace(":accept:", ":cancel:"));
  message(button);
  assert.equal(count("wa_wallet_provisioning"), 0);
});
test("duplicate confirmation queues and creates exactly one wallet", async () => {
  const button = offer();
  message(button);
  message(button);
  assert.equal(count("wa_wallet_provisioning"), 1);
  await run();
  await run();
  assert.equal(postCount, 1);
  assert.equal(count("wa_managed_wallets"), 1);
  assert.equal(job().state, "ready");
  assert.match(message("My account").text.body, /0x111111/);
  assert.match(message("Receive payment").text.body, /0x111111/);
  assert.equal(message("/menu").interactive.action.sections[0].rows[0].title, "My account");
});
test("disabled creation, paused accounts and removed senders do not provision", async () => {
  queue();
  process.env.PRIVY_WALLET_CREATION_ENABLED = "false";
  await run();
  process.env.PRIVY_WALLET_CREATION_ENABLED = "true";
  db.exec("UPDATE wa_accounts SET status='paused'");
  await run();
  db.exec("UPDATE wa_accounts SET status='active'");
  await provisionWallet(db, new Set(), key);
  assert.equal(postCount, 0);
  assert.equal(job().state, "queued");
});
test("configuration changes block a saved request", async () => {
  queue();
  process.env.PRIVY_WALLET_POLICY_ID = "different";
  await run();
  assert.equal(job().state, "blocked");
  assert.equal(postCount, 0);
});
test("concurrent workers honor the lease", async () => {
  queue();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const normal = provider;
  provider = async (url, init) => {
    entered();
    await gate;
    return normal(url, init);
  };
  const first = run();
  await started;
  await run();
  release();
  await first;
  assert.equal(postCount, 1);
  assert.equal(job().state, "ready");
});
test("timeout after provider creates reconciles by lookup without another POST", async () => {
  queue();
  let created = false;
  provider = async (_url, init) => {
    if (init?.method === "POST") {
      created = true;
      throw new Error("timeout");
    }
    return created ? Response.json(wallet()) : new Response(null, { status: 404 });
  };
  await run();
  assert.equal(job().state, "unknown");
  due();
  await run();
  assert.equal(postCount, 1);
  assert.equal(job().state, "ready");
});
test("ambiguous submission with no provider wallet never automatically retries creation", async () => {
  queue();
  provider = async (_url, init) => {
    if (init?.method === "POST") throw new Error("timeout");
    return new Response(null, { status: 404 });
  };
  await run();
  due();
  await run();
  assert.equal(postCount, 1);
  assert.equal(job().state, "unknown");
});
test("restart after claim can continue", async () => {
  queue();
  db.exec("UPDATE wa_wallet_provisioning SET state='checking',lease='old',lease_until=0");
  await run();
  assert.equal(postCount, 1);
});
test("provider owner mismatch is blocked and not saved", async () => {
  queue();
  provider = async () => Response.json({ ...wallet(), owner_id: "wrong" });
  await run();
  assert.equal(job().state, "blocked");
  assert.equal(postCount, 0);
  assert.equal(count("wa_managed_wallets"), 0);
});
test("database commit failure after creation reconciles existing provider wallet", async () => {
  queue();
  let created = false;
  provider = async (_url, init) => {
    if (init?.method === "POST") created = true;
    return created ? Response.json(wallet()) : new Response(null, { status: 404 });
  };
  db.exec(
    "CREATE TRIGGER fail_insert BEFORE INSERT ON wa_managed_wallets BEGIN SELECT RAISE(ABORT,'simulated failure'); END",
  );
  await run();
  assert.equal(job().state, "unknown");
  assert.equal(count("wa_managed_wallets"), 0);
  db.exec("DROP TRIGGER fail_insert");
  due();
  await run();
  assert.equal(postCount, 1);
  assert.equal(job().state, "ready");
});
test("account paused during provider lookup cannot start creation", async () => {
  queue();
  provider = async () => {
    db.exec("UPDATE wa_accounts SET status='paused'");
    return new Response(null, { status: 404 });
  };
  await run();
  assert.equal(postCount, 0);
});

test("submission state survives database reopen and only reconciles", async () => {
  queue();
  db.exec(
    "UPDATE wa_wallet_provisioning SET state='checking',lease='interrupted',lease_until=0,submitted_at=1",
  );
  db.close();
  db = new DatabaseSync(databasePath);
  migrateAccounts(db);
  await run();
  assert.equal(postCount, 0);
  assert.equal(job().state, "unknown");
  provider = async () => Response.json(wallet());
  due();
  await run();
  assert.equal(postCount, 0);
  assert.equal(job().state, "ready");
});
