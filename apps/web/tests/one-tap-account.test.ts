import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { accountReply, migrateAccounts } from "../src/server/whatsapp/accounts";

const key = Buffer.alloc(32, 9);
type Reply = {
  interactive?: { body: { text: string }; action: { buttons: { reply: { id: string } }[] } };
  _steward_type?: string;
};

test("hi shows the terms with Create account, and one tap creates the account", () => {
  const db = new DatabaseSync(":memory:");
  migrateAccounts(db);
  const from = "2348000000001";
  const hi = accountReply(db, key, { from, input: "Hi", id: randomUUID() }) as Reply;
  assert.match(hi.interactive!.body.text, /By tapping Create account you agree/);
  const accept = hi.interactive!.action.buttons[0].reply.id;
  assert.match(accept, /^enroll:accept:/);
  const created = accountReply(db, key, { from, input: accept, id: randomUUID() }) as Reply;
  assert.equal(created._steward_type, "mainnet_action");
  const count = db.prepare("SELECT count(*) AS n FROM wa_accounts").get() as { n: number };
  assert.equal(count.n, 1);
  db.close();
});

test("an older welcome cannot be used after a newer one", () => {
  const db = new DatabaseSync(":memory:");
  migrateAccounts(db);
  const from = "2348000000002";
  const first = accountReply(db, key, { from, input: "Hi", id: randomUUID() }) as Reply;
  accountReply(db, key, { from, input: "Hi", id: randomUUID() });
  const stale = accountReply(db, key, {
    from,
    input: first.interactive!.action.buttons[0].reply.id,
    id: randomUUID(),
  }) as { text?: { body: string } };
  assert.match(stale.text!.body, /expired or was already used/);
  db.close();
});
