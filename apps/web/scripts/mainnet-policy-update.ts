import { PrivyClient } from "@privy-io/node";
import {
  mainnetPolicyRules,
  validateMainnetPolicyRules,
} from "../src/server/stocks/mainnet-policy";
type PolicyUpdateInput = Parameters<ReturnType<PrivyClient["policies"]>["update"]>[1];

// Replace the rules of the existing Arc policy (PRIVY_MAINNET_POLICY_ID) with the generated
// ones, keeping the policy ID that user wallets are attached to. Dry run unless --apply.
// Never sends a transaction. Usage: railway run npx tsx scripts/mainnet-policy-update.ts [--apply]
const summary = (
  rules: { name?: string; conditions: { field: string; operator: string; value: unknown }[] }[],
) =>
  rules.map((r) => {
    const get = (field: string) => r.conditions.find((c) => c.field === field);
    const value = get("value");
    return `${String(get("function_name")?.value)} on ${String(get("to")?.value)} (value ${value?.operator} ${String(value?.value)})`;
  });

async function main() {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const policyId = process.env.PRIVY_MAINNET_POLICY_ID?.trim();
  const authKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
  if (!appId || !appSecret || !policyId || !authKey) throw Error("privy_configuration_missing");
  const client = new PrivyClient({
    appId,
    appSecret,
    maxRetries: 0,
    timeout: 15000,
    logLevel: "off",
  });
  const rules = JSON.parse(JSON.stringify(mainnetPolicyRules())) as PolicyUpdateInput["rules"];
  const current = await client.policies().get(policyId);
  console.log("Current rules:\n  " + summary(current.rules).join("\n  "));
  console.log("New rules:\n  " + summary(rules as never).join("\n  "));
  if (!process.argv.includes("--apply")) {
    console.log("Dry run: nothing changed. Re-run with --apply to update the policy.");
    return;
  }
  await client.policies().update(policyId, {
    rules,
    authorization_context: { authorization_private_keys: [authKey] },
  });
  const updated = await client.policies().get(policyId);
  validateMainnetPolicyRules(updated.rules);
  console.log("Policy updated and verified. Its ID is unchanged; no transaction was sent.");
}
main().catch((error: unknown) => {
  const e = error as { status?: number; message?: unknown };
  if (typeof e.status === "number") console.error("Provider HTTP status:", e.status);
  if (typeof e.message === "string")
    console.error("Message:", e.message.replace(/[^\x20-\x7e]/g, "").slice(0, 600));
  console.error("Policy update did not finish. No transactions were submitted.");
  process.exitCode = 1;
});
