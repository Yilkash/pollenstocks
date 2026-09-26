import { LIFI_FUNCTION, LIFI_ROUTER, lifiRouterAbi } from "./lifi-contracts";
import { KYBER_ROUTER, requireTrade, sameAddress } from "./mainnet-trade";
import { MAINNET_ASSETS, MAINNET_USDG } from "../networks/robinhood";
export const lifiPolicyRule = {
  name: "LI.FI same-chain stock swap",
  method: "eth_sendTransaction" as const,
  action: "ALLOW" as const,
  conditions: [
    {
      field_source: "ethereum_transaction" as const,
      field: "chain_id" as const,
      operator: "eq" as const,
      value: "4663",
    },
    {
      field_source: "ethereum_transaction" as const,
      field: "to" as const,
      operator: "eq" as const,
      value: LIFI_ROUTER,
    },
    {
      field_source: "ethereum_transaction" as const,
      field: "value" as const,
      operator: "eq" as const,
      value: "0x0",
    },
    {
      field_source: "ethereum_calldata" as const,
      field: "function_name" as const,
      operator: "eq" as const,
      value: LIFI_FUNCTION,
      abi: lifiRouterAbi.filter((x) => x.type === "function"),
    },
  ],
};
export function canonicalPolicy(x: unknown): string {
  if (Array.isArray(x)) return "[" + x.map(canonicalPolicy).join(",") + "]";
  if (x && typeof x === "object")
    return (
      "{" +
      Object.entries(x)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonicalPolicy(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(x);
}
type Rule = {
  action: string;
  method: string;
  conditions: {
    field_source: string;
    field: string;
    operator: string;
    value: unknown;
    abi?: unknown;
  }[];
};
export function validateMainnetPolicyRules(rules: Rule[], needsLifi: boolean) {
  const expected = [
    ...Object.values(MAINNET_ASSETS).map((a) => [a.address, "approve"]),
    [MAINNET_USDG.address, "approve"],
    [KYBER_ROUTER, "swap"],
    [MAINNET_USDG.address, "transfer"],
  ];
  // A reviewed Kyber trade remains valid after the narrow LI.FI rule is added.
  if (rules.length === 7) expected.push([LIFI_ROUTER, LIFI_FUNCTION]);
  requireTrade(
    rules.length === expected.length && (!needsLifi || rules.length === 7),
    "mainnet_policy_mismatch",
  );
  const seen = new Set<string>();
  for (const rule of rules) {
    requireTrade(
      rule.action === "ALLOW" &&
        rule.method === "eth_sendTransaction" &&
        rule.conditions.length === 4,
    );
    const eq = (source: string, field: string, value: string) =>
      rule.conditions.some(
        (c) =>
          c.field_source === source &&
          c.field === field &&
          c.operator === "eq" &&
          sameAddress(String(c.value), value),
      );
    requireTrade(
      eq("ethereum_transaction", "chain_id", "4663") && eq("ethereum_transaction", "value", "0x0"),
    );
    const match = expected.find(
      ([address, name]) =>
        eq("ethereum_transaction", "to", address) && eq("ethereum_calldata", "function_name", name),
    );
    requireTrade(match && !seen.has(match[0].toLowerCase() + match[1]));
    seen.add(match[0].toLowerCase() + match[1]);
    if (sameAddress(match[0], LIFI_ROUTER)) {
      const abi = rule.conditions.find((c) => c.field_source === "ethereum_calldata")?.abi;
      requireTrade(canonicalPolicy(abi) === canonicalPolicy(lifiPolicyRule.conditions[3].abi));
    }
  }
}
