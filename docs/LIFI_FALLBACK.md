# LI.FI fallback integration

Implemented and **deployed with LI.FI fallback enabled**, 2026-09-25.

Active Railway deployment: `0af69d52-2984-4c42-987b-7a30134de0ef` (SUCCESS).
The prior worker was removed before the policy update. The reviewed seventh
Privy rule was added and re-read successfully. Production file hashes, enabled
flag, router/facet code pins, and policy were verified from the running container.
Unsigned 0.2 USDG quotes for AAPL, NVDA and TSLA passed from production; each
included a 500-unit (0.0005 USDG) provider fee. Website returned HTTP 200 and
WhatsApp worker startup was confirmed. No actual trade was submitted by these checks.

## Routing and confirmation

- Kyber remains primary, with its existing bounded GET retry.
- LI.FI is requested only for transient Kyber network errors or HTTP
  429/502/503/504 while preparing a new review (including the unsigned build).
  HTTP authorization, unsupported-route, malformed-response and validation
  errors do not trigger fallback.
- Set `MAINNET_LIFI_FALLBACK_ENABLED=true` only after rollout below. Default false.
- Only same-chain 4663, canonical USDG and AAPL/NVDA/TSLA, exact input, same
  sender/recipient, 1% slippage, feeCollection + Nordstern are supported.
  Kyber is excluded from LI.FI and Nordstern is explicitly selected.
- The actual provider fee is shown in the review, included in the spending
  amount. Fees are decoded independently and capped at 25 bps (0.25%). Gas
  is separate. No fixed fee is invented from the advertised rate.
- Stored encrypted reviews bind provider, router, calldata, fee, minimum,
  wallet and provider transaction ID. Confirmation never requests a replacement
  route. An outage after confirmation cannot silently switch providers.
- Exact approvals, operator input/fee caps, wallet ownership checks, per-step
  gas simulation, nonce handling and durable submission/reconciliation remain.
- Old Kyber reviews have no provider field and remain compatible. LI.FI receipts
  require its completion event and matching actual ERC20 transfers. Reconciliation
  continues when new LI.FI submissions are disabled.

## Validation and trust boundaries

LI.FI router, swap facet, FeeForwarder, Nordstern router and selected executor
are pinned by runtime code hash. The diamond selector's live facet address is
checked as well, so a diamond upgrade does not evade the router code pin.
A contract upgrade or new route shape is rejected until separately reviewed.

Outer LI.FI calldata and the fee distribution are decoded and canonically
re-encoded. Fee recipient is pinned. Nordstern's packed guard header is checked
for amount, pair, executor, first token receiver, output recipient and minimum.
Integer minima may differ by one raw unit due to provider rounding, but never
fall below floor(99% of estimated output).

The Nordstern guard source is an exact Sourcify runtime match, compared with
on-chain bytecode. Its executor's pool instruction stream is **provider-trusted**
and code-pinned, not independently audited or fully decoded. This is a limited
provider integration, not an audit of LI.FI or Nordstern.

LI.FI GenericSwapV3 has no on-chain deadline parameter. The local 240-second
review expiry is enforced before submission; it cannot expire an already
broadcast transaction. Explicit minimum-output checks still apply on chain.

## Verification performed

- Six live unsigned quotes: 0.2 USDG buys and 0.001-token sells, all three stocks.
  All passed parsing and calldata/plan checks; observed fee 0.25% on each.
- Synthetic wallet only, no customer balances or credentials in fixtures.
- Regression coverage: provider fallback, no reroute on permanent failures,
  token/chain/recipient/amount/fee tampering, altered packed fields, legacy policy
  compatibility and receipt reconciliation, including the disabled-fallback case.
- Full suite: 86 passing tests. Production build passed.
- Before rollout, `mainnet-enable-lifi.ts` read-only preflight passed against
  the configured policy and live contract pins. During rollout its `--apply`
  mode added and verified the single reviewed rule. No funded transaction
  simulation, signing, broadcast or actual trade was performed by these checks.

See `evidence/lifi-integration-check-2026-09-25.json` and the public synthetic
quote fixtures under `apps/web/tests/fixtures/lifi/`.

## Activation order (completed)

1. Deploy the compatible worker/web code with fallback disabled. Ensure every
   old worker is drained before adding the rule: the old runner expects six rules.
2. From `apps/web`, run the default read-only check:
   `node --env-file=.env.local --import tsx scripts/mainnet-enable-lifi.ts`.
3. Review `docs/privy-lifi-policy-addition.json`. It adds exactly one allowed
   method on the pinned LI.FI router, chain 4663, zero native value. It does not
   add a bridge, arbitrary destination, unlimited approval, or signing method.
4. Apply that one rule with the same command plus `--apply`; it checks the exact
   existing rules first and re-reads after the mutation. Never blindly retry an
   uncertain mutation: run read-only again to check whether it already exists.
5. Enable `MAINNET_LIFI_FALLBACK_ENABLED=true` in the production service and
   restart its worker. Request a fresh trade review.
6. An actual funded trade still needs the user's normal WhatsApp confirmation.
   First execution remains unproven until its receipt is reconciled.

Rollback: disable fallback while retaining compatible code for reconciliation.
Do not roll back to the old worker while the policy contains the seventh rule.
Do not remove the rule with pending LI.FI orders; reconcile them first.

## Source references

- LI.FI deployment: https://github.com/lifinance/contracts/blob/main/deployments/robinhood.json
- Facet versions: https://github.com/lifinance/contracts/blob/main/deployments/robinhood.diamond.json
- Swap contract: https://github.com/lifinance/contracts/blob/main/src/Facets/GenericSwapFacetV3.sol
- Fee contract: https://github.com/lifinance/contracts/blob/main/src/Periphery/FeeForwarder.sol
- Receipt ABI: https://github.com/lifinance/contracts/blob/main/src/Interfaces/ILiFi.sol
- Verified guard: https://sourcify.dev/server/v2/contract/4663/0x603206D6105217DD972E4Ab30676A220CA393346?fields=all
- Quote API: https://docs.li.fi/li.fi-api/li.fi-api/requesting-a-quote
