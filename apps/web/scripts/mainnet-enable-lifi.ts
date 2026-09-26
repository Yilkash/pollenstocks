import { readFileSync } from "node:fs";
import { PrivyClient } from "@privy-io/node";
import {
  canonicalPolicy,
  lifiPolicyRule,
  validateMainnetPolicyRules,
} from "../src/server/stocks/mainnet-policy";
import { checkLifiRouter, checkMainnetRouter } from "../src/server/stocks/mainnet-trade";
// Default is read-only. Apply adds one rule to the existing policy, with no wallet
// migration or transaction. Deploy compatible workers before changing the policy.
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
  const base = JSON.parse(readFileSync("../../docs/privy-mainnet-policy.json", "utf8"));
  type Rule = typeof lifiPolicyRule;
  const key = (r: Rule) =>
    canonicalPolicy({
      action: r.action,
      method: r.method,
      conditions: r.conditions.map(canonicalPolicy).sort(),
    });
  const desired = [...base.rules, lifiPolicyRule].map(key).sort();
  const actual = policy.rules.map((r) => key(r as Rule)).sort();
  if (actual.length !== new Set(actual).size || actual.some((r) => !desired.includes(r)))
    throw Error("unexpected_policy_diff");
  validateMainnetPolicyRules(policy.rules, false);
  await checkMainnetRouter();
  process.env.MAINNET_LIFI_FALLBACK_ENABLED = "true";
  await checkLifiRouter();
  if (canonicalPolicy(actual) === canonicalPolicy(desired)) {
    console.log("LI.FI rule and contract pins verified. No changes made.");
    return;
  }
  if (actual.length !== desired.length - 1 || actual.includes(key(lifiPolicyRule)))
    throw Error("unexpected_policy_diff");
  if (!process.argv.includes("--apply")) {
    console.log("Verified: one LI.FI same-chain ERC20 swap rule can be added. No changes made.");
    return;
  }
  await client
    .policies()
    .createRule(id, {
      ...lifiPolicyRule,
      request_expiry: Date.now() + 30000,
      authorization_context: {
        authorization_private_keys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY!],
      },
    });
  const after = await client.policies().get(id);
  if (canonicalPolicy(after.rules.map((r) => key(r as Rule)).sort()) !== canonicalPolicy(desired))
    throw Error("policy_verify_failed");
  console.log("Verified LI.FI rule added. No transactions submitted; enable fallback separately.");
}
main().catch((e) => {
  console.error(
    "LI.FI policy setup stopped:",
    typeof e.status === "number"
      ? `HTTP ${e.status}`
      : "configuration, code pin or policy verification failed. No transactions sent.",
  );
  process.exitCode = 1;
});
