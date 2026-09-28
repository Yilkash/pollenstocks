import { readFileSync } from "node:fs";
import { PrivyClient } from "@privy-io/node";
import {
  addedStockApproveRules,
  canonicalPolicy,
  lifiPolicyRule,
  validateMainnetPolicyRules,
} from "../src/server/stocks/mainnet-policy";
import { verifiedMainnetRegistry } from "../src/server/stocks/mainnet";
import { checkMainnetRouter } from "../src/server/stocks/mainnet-trade";

// Adds the approve rules that let wallets sell the stocks added to MAINNET_ASSETS.
// Default is read-only. --apply adds only missing approve rules for those exact token
// contracts: chain 4663, zero ETH value, the standard ERC20 approve function. It never
// removes or edits a rule, moves funds or submits a transaction. Deploy the compatible
// worker first: it accepts the policy both before and after these rules exist.
async function main() {
  const client = new PrivyClient({
    appId: process.env.PRIVY_APP_ID!,
    appSecret: process.env.PRIVY_APP_SECRET!,
    maxRetries: 0,
    timeout: 15000,
    logLevel: "off",
  });
  const id = process.env.PRIVY_MAINNET_POLICY_ID!;
  const policy = await client.policies().get(id);
  if (
    policy.owner_id !== process.env.PRIVY_WALLET_OWNER_ID ||
    policy.chain_type !== "ethereum" ||
    policy.version !== "1.0"
  )
    throw Error("policy_identity_mismatch");
  await verifiedMainnetRegistry();
  await checkMainnetRouter();

  type Rule = { action: string; method: string; conditions: unknown[] };
  const key = (r: Rule) =>
    canonicalPolicy({
      action: r.action,
      method: r.method,
      conditions: r.conditions.map(canonicalPolicy).sort(),
    });
  const base = JSON.parse(readFileSync("../../docs/privy-mainnet-policy.json", "utf8")).rules;
  const known = new Set([...base, lifiPolicyRule, ...addedStockApproveRules].map(key));
  const actual = policy.rules.map((r) => key(r as Rule));
  if (actual.length !== new Set(actual).size || actual.some((r) => !known.has(r)))
    throw Error("unexpected_policy_diff");
  if (base.map(key).some((r: string) => !actual.includes(r))) throw Error("base_rule_missing");
  validateMainnetPolicyRules(policy.rules, false);

  const missing = addedStockApproveRules.filter((r) => !actual.includes(key(r)));
  if (!missing.length) {
    console.log("All added stock approve rules are present and verified. No changes made.");
    return;
  }
  console.log(`Missing approve rules (${missing.length}):`);
  for (const r of missing) console.log("  " + r.name);
  if (!process.argv.includes("--apply")) {
    console.log("Read-only check passed. Re-run with --apply to add exactly these rules.");
    return;
  }
  for (const rule of missing) {
    // An uncertain response is resolved by re-running: present rules are skipped.
    // The rule is built by stockApproveRule, the shape the tests pin to the reviewed template.
    type NewRule = Parameters<ReturnType<typeof client.policies>["createRule"]>[1];
    await client.policies().createRule(id, {
      ...(rule as unknown as NewRule),
      request_expiry: Date.now() + 30000,
      authorization_context: {
        authorization_private_keys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY!],
      },
    });
    console.log("  added " + rule.name);
  }
  const after = await client.policies().get(id);
  const afterKeys = after.rules.map((r) => key(r as Rule));
  if (
    afterKeys.length !== new Set(afterKeys).size ||
    afterKeys.some((r) => !known.has(r)) ||
    addedStockApproveRules.some((r) => !afterKeys.includes(key(r)))
  )
    throw Error("policy_verify_failed");
  validateMainnetPolicyRules(after.rules, false);
  for (const rule of addedStockApproveRules)
    validateMainnetPolicyRules(after.rules, false, rule.conditions[1].value);
  console.log("Verified: all added stocks can now be sold. No transactions submitted.");
}
main().catch((e) => {
  console.error(
    "Stock policy setup stopped:",
    typeof e.status === "number"
      ? `HTTP ${e.status}`
      : e instanceof Error && /^[a-z_]+$/.test(e.message)
        ? e.message
        : "configuration or policy verification failed. No transactions sent.",
  );
  process.exitCode = 1;
});
