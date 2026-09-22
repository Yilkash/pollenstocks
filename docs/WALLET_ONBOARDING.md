# WhatsApp account onboarding and wallet-provider gate

## Implemented in this milestone

- Create account shows a versioned custody/testnet disclosure with Create test account / Cancel buttons.
- The opaque button token is stored hashed, tied to the verified sender, expires in ten minutes and can be consumed once. A new offer invalidates previous offers.
- Consent consumption, unique test-account creation, stable wallet-request identifiers and the reply are committed in the same inbox/outbox transaction.
- Accounts are identified by internal UUIDs and keyed sender lookups. Raw phone numbers are not used as wallet provider identifiers.
- My account shows wallet setup pending. Frozen accounts cannot proceed. Phone-number recipient lookup defaults off.
- The webhook now accepts interactive button replies as well as menu selections.
- A Privy REST adapter supports lookup by external ID and gated creation with an explicit owner and policy. It validates the returned wallet's address, owner, policy and external ID. No private key or signing method is exposed.

The adapter is **not invoked by the WhatsApp worker**. Creating a test account does not yet create or fund a wallet. Live balances, receipt history, transfers, optional phone lookup consent and SERV chat remain follow-up work.

## Private provider setup

In the Privy dashboard, use a dedicated Steward development app. Copy its App ID and App secret privately into the existing `apps/web/.env.local`:

```dotenv
PRIVY_APP_ID=
PRIVY_APP_SECRET=
PRIVY_WALLET_OWNER_ID=
PRIVY_WALLET_POLICY_ID=
PRIVY_WALLET_CREATION_ENABLED=false
```

The owner ID is a provider key-quorum identifier, not a wallet address or phone number. The policy ID must refer to an explicitly reviewed wallet policy. Leave these blank until they are configured. Do not generate an unrestricted wallet or enable creation merely because the app credentials are present.

The app-managed embedded-wallet controls are the candidate implementation; this does not establish eligibility for Privy's separately named custodial product or change the service-controlled custody disclosure.

## Next compatibility work

1. Inspect the development app and available owner/policy configuration with its credentials. Confirm pricing and required account access before any charged service.
2. Configure owner authorization and a testnet policy; prove policy restrictions actually reject disallowed chain/token/method requests.
3. Create one dedicated proof wallet, preserving its external ID and idempotency key before calling the provider.
4. Fund a capped amount of test ETH, claim our deployed Demo USD and execute a small transfer on chain 46630.
5. Prove provider timeout/status reconciliation, nonce behavior and policy coverage. Record transaction hash, exact Transfer receipt and known limitations.
6. Only after that, add the durable provisioning worker, wallet records, balance/receive features and capped funding jobs. The existing pending wallet requests are not automatically executed by configuration changes.

External IDs are unique per app and stable; the adapter uses `steward_<internal UUID>`. Provider creation idempotency lasts 24 hours, so it is insufficient alone for long-term uniqueness. Reconcile by external ID after ambiguous creation before any retry. Do not replace IDs to work around a timeout. Freeze the intended owner/policy alongside the request before wiring the asynchronous provisioner.

## Verification still needed

No tests were added or run for this milestone. Required follow-up cases: wrong-sender buttons, duplicates, expiry, superseded consent, Cancel/Continue races, restart persistence, paused accounts, provider timeout and mismatched returned owner/policy. A successful compile is not behavioral verification.

## Sources

- [Privy wallet creation API](https://docs.privy.io/api-reference/wallets/create): Basic authentication, explicit owner/policy fields and creation idempotency.
- [Privy external wallet IDs](https://docs.privy.io/wallets/wallets/external-ids): stable per-app identifiers and lookup routes.

These references do not prove Robinhood testnet compatibility. No provider wallet or onchain transaction was created during implementation.

## September 22 — provider setup checkpoint

- Authenticated Privy wallet reads succeeded with the configured app credentials.
- The saved P-256 authorization key's public key matches the configured one-key owner quorum (threshold 1).
- Created and read back policy `eeis8w41riooez9phmwfcyt9`, **Steward Robinhood Testnet**. One ALLOW rule for `eth_sendTransaction` requires chain 46630, Demo USD contract `0x13800afeea6f8688547770052b395099758d9a5b`, native value zero and decoded function `transfer`. Address checksum normalization was accounted for in read-back comparison.
- Created a separate proof wallet: `0xf11aB0Ef7193461D7dBB04Ecd7653f32056d83ca`. Returned owner, policy and external ID were checked. Creation reconciliation metadata is in the ignored `.data/privy-proof-wallet.json`.
- Automatic WhatsApp wallet creation remains disabled. This proof wallet is not the user's WhatsApp account wallet.
- Policy enforcement and successful onchain sending are still unproven. The current policy does not permit the token faucet's `claim()` function, so fund the proof wallet with Demo USD transferred from an already funded test wallet. An eventual automated faucet operation needs its own reviewed policy design.
- No amount/recipient ceiling is encoded in this four-condition policy. Application confirmation and spending controls still need implementation before user payments are enabled.


## September 22 — signing and policy proof completed

The dedicated proof wallet was manually funded with 0.001 test ETH and 5 Demo USD.
Using the official `@privy-io/node` SDK and the saved authorization key, it returned
**1 Demo USD** to `0xB3144B301819EE517E7594b998b555c0dfdB7ded` on chain 46630.

- Transaction: [0x1b70b8a5ba7c1d0b88aa7bc6ac482937d4e2a0c56c84eba88854faa714190c64](https://explorer.testnet.chain.robinhood.com/tx/0x1b70b8a5ba7c1d0b88aa7bc6ac482937d4e2a0c56c84eba88854faa714190c64).
- Receipt: success, block **122840299**, transaction nonce **0**, two confirmations observed.
- Verified chain, sender, token contract, zero native value, exact calldata and one matching ERC-20 Transfer event for 1,000,000 base units.
- Remaining proof-wallet balance: **4 Demo USD**, **0.00099958399 test ETH**.
- Privy's transaction lookup returned **confirmed** with the same transaction hash and reference ID.
- Four separate requests returned HTTP 400, code `policy_violation`: Sepolia chain instead of 46630; proof-wallet address instead of the token contract; `approve(recipient, 0)` instead of `transfer`; and native value 1 wei instead of zero. Probe token amounts were zero.
- After the probes, pending nonce remained **1** and Demo USD balance remained **4**. The probes were rejected before broadcast.

The standalone `apps/web/scripts/privy-proof.mjs` uses a fixed wallet/recipient/amount,
checks the attached policy, disables SDK retries and sponsorship, caps the allowed
transfer's gas budget at 0.0001 test ETH, and persists each request before submission.
The ignored `.data/privy-transfer-proof.json` retains request IDs, results and receipt.
Run from `apps/web` with `node --env-file=.env.local scripts/privy-proof.mjs verify`
for receipt verification. `send` refuses an already recorded attempt. `policy` skips
recorded explicit policy rejections and stops on any unresolved result.
Do not delete the journal to retry an uncertain request. A leftover lock after a crash
requires manual reconciliation before removal.

This proves one managed-wallet transfer and these four restrictions. It does not
prove timeout recovery, concurrent nonce allocation, idempotent replay after crashes,
all forbidden RPC methods, or user payment authorization. Automatic WhatsApp wallet
creation remains disabled, and the existing WhatsApp account still has wallet setup
pending. Amount limits, recipient confirmation, durable provisioning and payment
recovery remain implementation work.

Reference: [Privy server request authorization](https://docs.privy.io/controls/authorization-keys/using-owners/sign/direct-implementation)
and the installed SDK types/source. The official SDK handles authorization signatures;
Steward has not exported the proof wallet's private key.


## September 22 — staged WhatsApp provisioning implementation

Added durable `wa_wallet_provisioning` and `wa_managed_wallets` records, plus a separate
versioned wallet-setup consent. The existing account consent is not reused to create
wallets: it explicitly said creation was deferred. With the creation flag enabled,
My account offers **Set up test wallet / Cancel**. Consent is bound to the sender and
account, expires after ten minutes, is single-use and is superseded by a newer offer.
Its acceptance freezes app, owner and policy IDs alongside the durable request.

The WhatsApp worker can claim one eligible active, allowlisted account using a lease,
look up its stable external ID, and create only when no prior submission is recorded.
A possibly submitted request is subsequently reconciled by lookup only. Configuration
mismatches block the job. Provider metadata is validated before the wallet and ready
state commit together. No provider call happens inside a SQLite transaction. Ready
accounts show the address through My account and Receive payment. `/menu` and fallback
menus now preserve the existing account label.

The environment flag remains **false**, and running processes have not been restarted
for these changes. No WhatsApp wallet was created by this implementation. TypeScript
compilation passed; no new automated tests were added or run. Before enabling, verify
consent expiry/replay/wrong sender, duplicate worker claims, interruption around provider
creation and database commit, paused accounts and changed configuration. A request
recorded as submitted but never received by Privy intentionally stays pending for an
operator check; it is not automatically recreated. Live balance display, funding and
payment execution are not implemented by this stage.

## September 22 — wallet setup verification and activation

The user requested continuation through verification and activation. Added and ran
`apps/web/tests/whatsapp-wallets.test.ts`: **13 tests passed** using temporary SQLite
files and mocked provider HTTP, with no provider wallets created by the tests.
Coverage includes old consent not provisioning, sender/expiry/supersession/cancel,
duplicate acceptance, paused/removed/disabled accounts, changed provider configuration,
concurrent claims, ambiguous provider submission, database commit failure, provider
owner mismatch and reopening the database after an interrupted submission. TypeScript
compilation also passed.

Rechecked the live proof wallet's attached owner/policy and four policy conditions
against the successful signing proof. Enabled `PRIVY_WALLET_CREATION_ENABLED` in the
private local environment and restarted only the WhatsApp worker. The callback server
remained reachable (403 without verification credentials, as expected). Worker schema
migration succeeded: one existing account, zero setup requests and zero account wallets
at activation. The proof wallet remains separate.

The tester must send **My account**, then tap **Set up test wallet**. After confirmation,
opening **My account** again displays the address once provisioning completes. No
confirmation was generated or accepted on the user's behalf. Live consent-to-wallet
creation is awaiting that interaction. Funding, balances and payments remain separate
follow-up work. Unknown creation outcomes continue to use lookup only; operator review
may be needed when a submitted request never reached the provider.

## September 22 — automatic wallet-ready reply

New wallet confirmations now enqueue a native typing/read indicator instead of the
instruction to ask for the account again. Recipient and response-window expiry are
stored encrypted in `wa_wallet_notices` in the same transaction as consent handling.
When provisioning commits a wallet, it also inserts a stable-ID completion reply into
the outbox. Reconciliation after an interrupted creation uses the same completion path.
Unknown or blocked setup emits one status update; completion still follows when ready.
Delivery respects the existing allowlist and 23-hour response window. Old completed
wallets are not notified again by this migration. Typing requests are best-effort and
never block wallet creation on a Meta error; actual UI appearance remains client/API
dependent. Ambiguous message deliveries retain the existing no-automatic-retry behavior.

TypeScript compilation passed and the worker was restarted. No new automated tests or
live wallet creation were run for this UX change. Native request shape follows
[Meta's typing indicator example](https://www.postman.com/meta/whatsapp-business-platform/request/lhf0duq/send-typing-indicator-and-read-receipt).
