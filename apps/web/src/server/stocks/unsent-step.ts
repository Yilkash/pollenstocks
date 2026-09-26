// A Privy send that errors is ambiguous, so the runner records the step as
// "submitting" and reconciles by reference ID. If Privy never broadcast it, that
// lookup never yields a hash and the order would block the account forever.
// Close such a step only when all of these hold:
// - Privy has no transaction for the reference, or only a failed one with no hash;
// - the send request's expiry (never later than the order expiry) passed with margin,
//   so Privy can no longer broadcast it;
// - the wallet's latest and pending nonces still equal the step's reserved nonce,
//   so nothing using that nonce reached the chain.
export type PrivyReferenceTransaction = {
  transaction_hash: string | null;
  wallet_id: string;
  reference_id: string;
  caip2: string;
  status?: string;
};

export const UNSENT_EXPIRY_MARGIN_MS = 120_000;

export function privyNeverBroadcast(
  found: PrivyReferenceTransaction[],
  expected: { walletId: string; referenceId: string },
) {
  if (found.length === 0) return true;
  if (found.length !== 1) return false;
  const tx = found[0];
  return (
    tx.transaction_hash === null &&
    tx.wallet_id === expected.walletId &&
    tx.reference_id === expected.referenceId &&
    tx.caip2 === "eip155:4663" &&
    (tx.status === "failed" || tx.status === "provider_error")
  );
}

export function unsentStepCanClose(input: {
  neverBroadcast: boolean;
  orderExpires: number;
  now: number;
  stepNonce: number | null;
  latestNonce: number;
  pendingNonce: number;
}) {
  return (
    input.neverBroadcast &&
    input.now > input.orderExpires + UNSENT_EXPIRY_MARGIN_MS &&
    Number.isSafeInteger(input.stepNonce) &&
    input.latestNonce === input.stepNonce &&
    input.pendingNonce === input.stepNonce
  );
}
