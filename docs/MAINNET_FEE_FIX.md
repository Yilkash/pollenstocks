# Mainnet fee check correction — 2026-09-25

## Observed failure

A LI.FI sell review for 0.001 AAPL failed before the first approval. Read-only production inspection showed both steps still pending, with no nonce or transaction hash. No transaction was submitted by this attempt.

The approved gas price ceiling was 46,080,000 wei. Historical base fees sampled around confirmation were 36,908,000 (block 72162503), 37,168,000 (72162603), 36,708,000 (72162703), and 36,708,000 (72162803), all below that ceiling. The exact RPC suggestion at execution was not recorded.

A live production RPC read reproduced the discrepancy: eth_gasPrice returned 36,710,000 wei while block 72165447 had baseFeePerGas 36,736,000 wei. The old runner chose the lower suggestion and then rejected it for being below the base fee, using the misleading network_fee_increased reason.

## Correction

- Require valid fee data before planning or executing.
- Build new review ceilings from the greater of the RPC suggestion and current base fee, retaining the existing 25% buffer.
- Execute at min(max(suggestion, base fee), confirmed ceiling).
- Continue rejecting whenever the base fee exceeds the confirmed ceiling.
- Preserve reviewed gas limits, total fee limits, balance checks, approval amounts, confirmation, expiry, and durable submission safeguards.
- Report unavailable fee data separately from fees exceeding the approved limit.
- Leave failed orders closed; a fresh user review and confirmation are required.

## Checks and deployment

TypeScript checking and production build passed. No automated tests were added or run for this change; no real transactions were submitted by the agent.

Railway deployment: 7a0472f3-529d-4276-af0b-5d6f32f83b3e SUCCESS. The WhatsApp worker started with mainnet execution enabled; deployed source hashes match the local build.
