import { readFileSync } from "node:fs";
import { PrivyClient } from "@privy-io/node";
function canonical(x: unknown): string {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x && typeof x === "object")
    return (
      "{" +
      Object.entries(x)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(x);
}
async function main() {
  const client = new PrivyClient({
    appId: process.env.PRIVY_APP_ID!,
    appSecret: process.env.PRIVY_APP_SECRET!,
    maxRetries: 0,
    timeout: 15000,
    logLevel: "off",
  });
  const id = process.env.PRIVY_MAINNET_POLICY_ID!;
  const expected = JSON.parse(readFileSync("../../docs/privy-mainnet-policy.json", "utf8"));
  const key = (r: { action: string; method: string; conditions: unknown[] }) =>
    canonical({
      action: r.action,
      method: r.method,
      conditions: r.conditions.map(canonical).sort(),
    });
  const policy = await client.policies().get(id);
  if (policy.owner_id !== process.env.PRIVY_WALLET_OWNER_ID || policy.chain_type !== "ethereum")
    throw Error("policy_identity_mismatch");
  const wanted = expected.rules.map(key),
    actual = policy.rules.map(key);
  if (new Set(actual).size !== actual.length || actual.some((k) => !wanted.includes(k)))
    throw Error("unexpected_existing_rules");
  const missing = expected.rules.filter((r: Parameters<typeof key>[0]) => !actual.includes(key(r)));
  if (!missing.length) {
    console.log("Mainnet USDG transfer rule already configured.");
    return;
  }
  if (missing.length !== 1 || missing[0].name !== "Send mainnet USDG")
    throw Error("unexpected_policy_diff");
  if (!process.argv.includes("--apply")) {
    console.log(
      "Ready to add one rule: USDG transfer, chain 4663, zero ETH value. No policy changes made.",
    );
    return;
  }
  await client.policies().createRule(id, {
    ...missing[0],
    request_expiry: Date.now() + 30000,
    authorization_context: {
      authorization_private_keys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY!],
    },
  });
  const after = await client.policies().get(id);
  if (canonical(after.rules.map(key).sort()) !== canonical(wanted.sort()))
    throw Error("policy_verify_failed");
  console.log("Verified mainnet USDG transfer policy. No transactions submitted.");
}
main().catch((e) => {
  console.error(
    "Policy update stopped:",
    typeof e.status === "number"
      ? `HTTP ${e.status}`
      : "check configuration/provider; no transaction sent",
  );
  process.exitCode = 1;
});
