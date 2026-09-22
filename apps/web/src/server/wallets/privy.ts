import { getAddress, zeroAddress } from "viem";
import { z } from "zod";

// Wallet lookup and explicitly gated creation for the WhatsApp provisioner.
// This adapter exposes no signing or funding methods.
const walletSchema = z.object({
  id: z.string().min(1),
  address: z.string(),
  chain_type: z.literal("ethereum"),
  external_id: z.string(),
  owner_id: z.string(),
  policy_ids: z.array(z.string()),
});
export type ManagedWallet = { id: string; address: `0x${string}`; externalId: string };
export class WalletProviderError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
function config() {
  const appId = process.env.PRIVY_APP_ID?.trim(),
    secret = process.env.PRIVY_APP_SECRET?.trim();
  const owner = process.env.PRIVY_WALLET_OWNER_ID?.trim(),
    policy = process.env.PRIVY_WALLET_POLICY_ID?.trim();
  if (!appId || !secret || !owner || !policy)
    throw new WalletProviderError("provider_not_configured");
  return { appId, secret, owner, policy };
}
function externalId(value: string) {
  // Accept only our internal random account references, never phone numbers.
  if (!/^steward_[a-f0-9-]{36}$/.test(value)) throw new WalletProviderError("invalid_external_id");
  return value;
}
async function request(
  path: string,
  method: "GET" | "POST",
  body?: object,
  idempotencyKey?: string,
) {
  const c = config();
  try {
    const result = await fetch("https://api.privy.io/v1/wallets" + path, {
      method,
      headers: {
        Authorization: "Basic " + Buffer.from(c.appId + ":" + c.secret).toString("base64"),
        "privy-app-id": c.appId,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "privy-idempotency-key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (result.status === 404 && method === "GET") return null;
    if (!result.ok) throw new WalletProviderError(`provider_http_${result.status}`);
    return (await result.json()) as unknown;
  } catch (error) {
    if (error instanceof WalletProviderError) throw error;
    // Raw provider errors can contain credentials or payloads; expose fixed codes only.
    throw new WalletProviderError("provider_outcome_unknown");
  }
}
function validate(value: unknown, expected: string): ManagedWallet {
  const parsed = walletSchema.safeParse(value),
    c = config();
  if (
    !parsed.success ||
    parsed.data.external_id !== expected ||
    parsed.data.owner_id !== c.owner ||
    parsed.data.policy_ids.length !== 1 ||
    parsed.data.policy_ids[0] !== c.policy
  )
    throw new WalletProviderError("provider_wallet_mismatch");
  let address: `0x${string}`;
  try {
    address = getAddress(parsed.data.address);
  } catch {
    throw new WalletProviderError("provider_address_invalid");
  }
  if (address === zeroAddress) throw new WalletProviderError("provider_address_invalid");
  return { id: parsed.data.id, address, externalId: expected };
}
export async function getManagedWallet(reference: string) {
  const id = externalId(reference),
    result = await request("/ext_wal_" + id, "GET");
  return result === null ? null : validate(result, id);
}
export async function createManagedWallet(reference: string, idempotencyKey: string) {
  if (process.env.PRIVY_WALLET_CREATION_ENABLED !== "true")
    throw new WalletProviderError("wallet_creation_disabled");
  if (!/^[a-f0-9-]{36}$/.test(idempotencyKey))
    throw new WalletProviderError("invalid_idempotency_key");
  const id = externalId(reference),
    c = config();
  const existing = await getManagedWallet(id);
  if (existing) return existing;
  // Caller must persist the reference/key before this call. A timeout is not proof
  // of failure: reconcile by external ID; never generate a new reference to retry.
  return validate(
    await request(
      "",
      "POST",
      { chain_type: "ethereum", external_id: id, owner_id: c.owner, policy_ids: [c.policy] },
      idempotencyKey,
    ),
    id,
  );
}
