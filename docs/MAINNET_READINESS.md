# Mainnet readiness — 2026-09-23

## Status

Price previews work; real-money trading remains disabled. The user confirmed a
successful USDG → TSLA preview in WhatsApp. No mainnet deployment, token approval,
trade or funding transfer was made. A separate mainnet policy and empty wallet have now been created; the testnet policy was not changed.

## Direct-router implementation, not execution-ready

No custom mainnet contract or deployment is required. The adapter source, deployment
script and adapter-only tests have been removed at the user's request.

- Builds use the wallet as sender and recipient. Approvals name the existing
  KyberSwap router and authorize the exact input amount.
- Calldata checks cover token pair, amount, minimum output, recipient, executor,
  flags, fees, permits and spender overrides.
- Only the standard ABI-encoded simple-mode deadline is currently understood.
  The user approved trusting Kyber for packed executor data (flag 0x200).
  Its internals and onchain deadline are not independently decoded. Outer swap
  terms and the exact executor funding amount are still checked.
- Router and executor code hashes must match reviewed implementations.
- Reviews, confirmation, nonce/idempotency tracking, uncertain-outcome reconciliation
  and canonical receipt checks remain in place.
- Privy policy limits chain, contracts and function names. Amount and recipient
  constraints are application checks, not custom-contract enforcement.

`MAINNET_EXECUTION_READY` remains false; environment flags cannot bypass it.
No live mainnet execution acceptance run has happened.

## Outstanding setup

1. Packed calldata now uses the user-approved Kyber provider-trust model. Record
   observed router/executor code pins for change detection, then complete a
   funded-wallet preflight before enabling execution.
2. Completed: separate Privy policy and dedicated mainnet wallet created. The policy ID is saved in local configuration.
3. The user authorized 1,000 USDG maximum per trade, saved locally. Network fees
   are estimated automatically and shown for confirmation; no manual ETH cap is required.
4. Fund the dedicated wallet with real USDG and ETH.
5. Validate wallet-bound builds, simulation, policy behavior and receipts before
   enabling execution. No funds have been moved during this refactor.

## Commands (from apps/web)

Read-only setup status (local schema initialization is allowed):

```bash
node --env-file=.env.local --import tsx scripts/mainnet-setup.ts
```

Emit the direct-router policy template (no deployment required):

```bash
node --import tsx scripts/mainnet-setup.ts --policy-template
```

Review/import it in Privy, set `PRIVY_MAINNET_POLICY_ID`, and configure the other
mainnet variables in `.env.example`. Do not attach it to the testnet wallet.
Once the separate policy is configured, the empty wallet can be created before funding or trade validation:

```bash
node --env-file=.env.local --import tsx scripts/mainnet-setup.ts --create-wallet
```

If multiple accounts exist use `--account=<internal-account-id>`. Creation saves a
stable external ID before calling Privy. After an uncertain response later runs only
look up that ID; do not delete the record to force another creation attempt.

## Failure handling

- Pending review: cancel or expire; request a fresh review.
- Failed sequence: fees or a router approval may remain. Status lists submitted
  hashes; the next reviewed trade resets existing allowance before exact approval.
- Unknown outcome: do not retry or create a replacement trade. Reconcile the saved
  provider reference and canonical receipt. Operator investigation may be required.
- Disabling the environment switch prevents new steps while allowing reconciliation.
  Paused/removed accounts may require operator investigation.

## Assets

USDG (6 decimals): `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
AAPL (18): `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9`
NVDA (18): `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`
TSLA (18): `0x322F0929c4625eD5bAd873c95208D54E1c003b2d`

Plans use raw tokens, not a claim of direct share ownership. Metadata is checked
against https://api.robinhood.com/rhj/assets before preparing a plan.
API reference used: https://docs.kyberswap.com/developer-guide/aggregator-api/aggregator-api-specification/evm-swaps.md

See HACKATHON_DEMO.md. A price preview is not a completed mainnet transaction.

## Investigation update

Tokkenly's backend builds KyberSwap transactions for its smart account on Base.
It does not pass an explicit build deadline or decode the executor payload. Its
minimum-output check searches the calldata for the expected number, which does
not establish which field contains that number.

Public Kyber router source documents the standard simple-mode deadline check:
https://github.com/KyberNetwork/ks-dex-aggregation-router-v2-sc/blob/main/src/MetaAggregationRouterV2.sol
It does not establish the current packed executor's encoding. Sourcify returned
no verification match for the observed executor on chains 4663 or 1. Fetching its
onchain metadata from IPFS also failed. These unresolved lookups do not prove the
contract is unsafe.

Next source needed: verified implementation and packed calldata specification for
executor `0x8F10B468b06c6FD214B65F87778827F7D113f996`, including deadline encoding and
enforcement. Do not infer this from matching a byte substring.

`docs/privy-mainnet-policy.json` is the policy template accepted during setup. Its ID is saved locally. Generating the template needs no secrets or funded wallet.
Gas sponsorship remains off. The mainnet wallet will pay gas in ETH.

## Completed provisioning

Dedicated mainnet wallet: `0xDF9Ab6216627C971Bf00a9c31FB98D8046af5683`.
Setup reads showed 0 ETH and 0 USDG. The wallet is separate from the testnet wallet,
and is attached to the separate mainnet policy. No approval or swap was submitted.

Policy creation uses a persisted idempotency key. `scripts/mainnet-policy-create.ts`
can reconcile an uncertain response with `--recover` within 23 hours; after that,
inspect the provider dashboard instead of creating another policy. Do not delete
`.mainnet-policy-setup.json` to force retries. This recovery file is gitignored.

Read-only provider verification has passed for wallet identity, external ID,
owner, attached policy, and exact policy conditions including their ABIs.
Repeat from `apps/web` with:

```bash
node --env-file=.env.local --import tsx scripts/mainnet-verify-setup.ts
```

This does not validate swap execution. The pending provider question is in
`docs/KYBER_SUPPORT_QUESTION.md`; it has not been sent to anyone.

## WhatsApp mainnet funding

In Ask Steward, request “Show my mainnet wallet” or “Where can I deposit on mainnet?”.
The account-bound tool returns the dedicated wallet and labels Robinhood mainnet
4663, USDG and ETH. It provisions a missing wallet using the shared separate policy.
No phone number, account ID or funding address can be supplied as tool arguments.
Uncertain creation is recovered by stable external ID; it is not blindly retried.
Provisioning is on request, not automatic for every signup.
Mainnet holdings no longer fall back to the testnet wallet address.

This flow has not yet been exercised end-to-end through WhatsApp.

## Automatic fee review

Approval gas is estimated by RPC; swap gas uses the current Kyber route estimate
until approval exists. Current network gas price is used, with a 25% gas-unit
allowance. Existing-allowance reset sequences reserve conservatively for the next
zero-to-nonzero approval. The review displays estimated total fees and the maximum
for those fixed transaction parameters. The runner simulates each step and stops
if gas requirements or network gas price exceed the review; it does not silently
increase the user's confirmed limits.

`MAINNET_MAX_FEE_WEI` is optional operator configuration and is empty locally.
These are estimates, not guaranteed final charges. Actual gas is known from the
receipt. Mainnet execution is still disabled pending route validation.

## Provider-trust decision

The user explicitly chose Tokkenly's approach instead of waiting for independent
packed-executor deadline decoding. Flag 512 routes are accepted when outer token
pair, recipient, amount, minimum output, router, executor, empty permit, absence
of extra fees and exact executor funding all match the review. Other unknown
flags remain blocked. The route/build API receives the requested deadline.

Local review expiry only controls confirmation and submission. Onchain expiry of
packed routes relies on Kyber's implementation; no independent guarantee is made.
The support question is now optional follow-up, not a release requirement.
Code hashes pin the observed deployments for change detection; they are not a
source audit. Mainnet execution still awaits funded-wallet preflight.


## Funded-wallet preflight — 2026-09-23

Verified dedicated wallet identity and exact Privy policy; router/executor code pins match. Wallet funded with 2.232512 USDG and 0.0001 ETH. Unsigned 1 USDG TSLA plan passed validation and approval gas estimation: estimated 0.000019562450324 ETH, reserved maximum 0.00002445312572 ETH at quote time. No queued mainnet orders existed. Enabled the code readiness gate and local environment flag for user-confirmed trades. No approvals or swaps were submitted during these checks; swap simulation still occurs after approval and before execution in the runner. Packed route internals remain provider-trusted. Live end-to-end receipt confirmation remains to be exercised by the user.

## Mainnet USDG payments — 2026-09-23

Menu Send, Receive, Balance, My account and Recent activity now use Robinhood mainnet. AI payment, balance, receiving and affordability requests default to USDG/mainnet; explicit testnet requests retain the legacy tools. New account disclosure and wallet entry use the dedicated mainnet wallet.

USDG transfers reuse the durable mainnet review/confirmation/outbox flow. A transfer is one exact ERC-20 call with zero native value, a recipient/amount review, a maximum reviewed gas fee, a 1,000 USDG input ceiling (also bounded by the configured input cap), account-bound single-use confirmation, nonce checks and canonical receipt/Transfer-event verification. There is one active mainnet payment or stock operation per account. Uncertain submissions are reconciled without blind resubmission. Mainnet phone recipients require lookup opt-in and a dedicated mainnet wallet. Saved contacts display the exact address; users must verify it for the intended network.

Installed and read-back verified the one additional Privy policy rule for USDG transfer on chain 4663, zero ETH value. Existing rules remain unchanged. The policy template and setup verifier now include that rule. No custom contract was deployed.

Checks completed: TypeScript compilation; exact policy/wallet verification; unsigned 0.01 USDG transfer simulation from the funded wallet; unsigned 0.0001 AAPL sell preparation; local menu/recipient/whole-number amount traversal inside a rolled-back database transaction. No transfers or sells were broadcast by these checks. Live transfer and sell receipts still require the user's separate confirmations; the earlier AAPL buy was already completed by the user.
