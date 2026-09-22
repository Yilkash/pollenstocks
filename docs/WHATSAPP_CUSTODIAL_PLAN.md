# Steward Pay — WhatsApp custodial-wallet prototype

Updated September 22, 2026. Status: proposed implementation plan; the WhatsApp wallet/signing flow is not built.

## 1. Product decision

Create one managed EVM wallet per enrolled WhatsApp user. Users request a payment in chat, review an exact quote, and tap Confirm or Cancel. The service signs only a confirmed, validated payment and returns an onchain receipt.

This is a service-controlled/custodial experience from the user's perspective. Managed key infrastructure does not make it self-custodial if Steward can authorize spending. Disclose this during onboarding.

MVP is restricted to invited testers, Robinhood Chain testnet (46630), and our Demo USD contract:
`0x13800afeea6f8688547770052b395099758d9a5b`.

Demo USD has no monetary value. No mainnet, fiat, bank payouts, swaps, credit, or automatic recurring payments.

The existing externally signed web-wallet flow remains a separate mode. New custodial wallets do not acquire access to an existing MetaMask wallet or its funds.

## 2. Current foundation

Completed:
- Demo USD contract deployed and verified.
- Wallet-to-wallet transfers and SERV balance/tool exchange demonstrated.
- Web payments, contacts, review, history and receipt matching implemented.
- Reliability and replacement-recovery work tested locally.
- Meta app and test WhatsApp Business Account created; a sample outbound message arrived on the user's phone.

Still needed:
- Inbound WhatsApp webhook and real SERV replies over WhatsApp.
- Managed wallet provider account and Robinhood testnet signing proof.
- Confirmation authorization, durable worker and custody-specific records.
- Public HTTPS endpoint, runtime secrets and durable hosting.
- End-to-end WhatsApp payment test.
- Organizer clarification about testnet-only eligibility.

## 3. User journey

1. User sends “Hi” to the test WhatsApp number.
2. Steward explains testnet-only funds and service control, then offers Create test wallet / Cancel.
3. On consent, create exactly one wallet and return its address and network.
4. Seed a small, capped amount of test ETH and claim Demo USD for that wallet. Track both operations; do not assume an address has gas.
5. User saves “Sila” with a recipient address and confirms the contact.
6. User asks, “Send 5 Demo USD to Sila.”
7. Steward sends a payment review:
   - recipient alias and full wallet address;
   - 5 Demo USD, token identity and Robinhood testnet;
   - estimated ETH fee and maximum allowed fee;
   - expiry and Confirm / Cancel buttons.
8. Confirm authorizes exactly that immutable payment. The worker validates it again, signs and broadcasts.
9. Return “Submitted” with the hash, then “Included on chain” only after receipt verification.

A chat reply like “yes” alone never calls the signer. The confirmation button belongs to a specific payment, user and expiry. If the user changes details or the fee exceeds the approved maximum, issue a new review.

Users can ask Balance, Receive, History and Payment status. Cancel before execution means discard the draft; it does not reverse a broadcast transaction.

## 4. Phone identity and custody

- Generate wallet keys using the managed provider's secure randomness, never from a phone number.
- Link a verified inbound WhatsApp sender ID to an internal user ID and provider wallet ID.
- Validate Meta webhook signatures over the original raw body, expected app/business phone-number ID and message format before trusting sender identity.
- Phone control identifies the test account; it is not proof of a person's legal identity.
- Use a keyed lookup identifier for phone matching and minimize stored phone data. Encrypt retained phone identifiers and provider credentials.
- Do not give SERV phone numbers, authentication tokens, private keys or signer credentials.
- Explain that WhatsApp account takeover can authorize small test payments in this prototype.
- Do not automatically transfer account ownership after a number change. For the test demo, freeze an uncertain account and require explicit recovery handling.
- Mainnet requires separate stronger authentication/recovery design, custody/security review and jurisdiction-specific compliance assessment. A PIN or OTP delivered in the same compromised chat is not an independent factor.

## 5. Wallet-provider decision gate

Evaluate Privy wallet infrastructure first, as a candidate rather than an approved dependency. Its documentation describes programmable authorization and service-controlled accounts; generic EVM support is not a verified Robinhood integration.

Before building payment execution, demonstrate on chain 46630:
1. Create one service-controlled EVM wallet.
2. Fund test ETH and execute the existing token's faucet claim.
3. Sign/broadcast a 1 DUSD transfer and verify its receipt.
4. Reject signing on a different chain or token.
5. Confirm what policies can constrain ERC-20 calldata, amount, method, recipient and gas; ETH value limits alone do not bound ERC-20 transfers.
6. Confirm request idempotency/status lookup, nonce control, timeout behavior, costs, key recovery/export options and credential rotation.

If the provider cannot meet these gates, evaluate another managed signer. Do not silently fall back to a plaintext private-key database. If external key access/fees block us, continue webhook and confirmation work with a clearly labelled mock signer; this is not a completed onchain demo.

Provider-independent adapter:
- createWallet(internalUserId)
- getWallet(providerWalletId)
- submitConfirmedTransfer(manifest, idempotencyKey)
- getSubmission(providerRequestId)

Use a separate, narrowly scoped setup operation for faucet claims. Sending arbitrary calldata or requesting raw signatures must not be available to SERV.

## 6. System design

WhatsApp -> verified webhook -> durable inbox -> user/message worker -> SERV draft tools
-> deterministic payment review -> WhatsApp confirmation button
-> authorization and limit checks -> durable signing job -> managed signer
-> Robinhood testnet -> receipt worker -> durable WhatsApp outbox.

Components:
- Dedicated GET/POST webhook route, separate from the browser API's cookie/origin guard.
- GET verification challenge using a private verify token; POST signature verification using the Meta app secret.
- Durable inbox: unique provider message ID, expected business phone ID, processing status and retry count.
- Background worker: process each user's messages in order; persist before acknowledging webhooks; return promptly after durable acceptance.
- SERV tools reuse balance, contact and draft validation. They never expose the signing operation.
- Confirmation handler directly validates and atomically claims a draft.
- Signer service re-reads the claimed draft and independently applies policy.
- Receipt worker confirms canonical inclusion and the exact Transfer event.
- Outbox separates message delivery failures from payment execution failures.

Meta webhook and message-window rules must be checked against the selected current API version during implementation. Use allowed in-session replies; use approved templates when required. Never resend a transfer because WhatsApp delivery failed.

Initial hosting: one persistent Node app and one coordinated worker on a persistent SQLite volume. Use transactional claims/leases across workers; avoid in-memory queues. Move to a managed database before horizontally scaling.

## 7. Data model and identity refactor

The existing web app scopes records by a signed wallet session. A phone number must never bypass that check.

Introduce:
- users: internal ID, consent time, account status.
- channel_accounts: user ID, WhatsApp sender lookup, encrypted contact data, channel status.
- wallets: user ID, custody mode, provider ID, chain, address, creation request/status.
- contacts: owner user ID, alias, normalized recipient address.
- inbox_messages: unique incoming message ID, user, timestamp, processing state.
- payment_intents: user, wallet, channel, immutable amount/recipient/token/chain, fee ceiling, expiry, state.
- confirmations: hashed random button token, intent ID/version, user ID, expiry, consumed time.
- execution_attempts: intent, wallet nonce, provider request ID, hashes and submission state.
- spend_reservations: user/intent/day, integer units, reserved or consumed status.
- outbox_messages: deduplication key, payload, provider message ID, delivery state.
- audit_events: relevant lifecycle decisions without secrets.

Use a verified actor context for web-wallet sessions or signed WhatsApp events, resolving to an authorized internal user/wallet. Preserve web ownership checks through migration; never take a wallet address or provider wallet ID from model output as authorization.

Keep custodial transaction execution separate from the current browser-signing endpoints.

## 8. Confirmation and spending controls

Suggested initial demo limits, configurable before implementation:
- Maximum 10 DUSD per payment.
- Maximum 50 DUSD per user per UTC day.
- One executing/unresolved payment per wallet.
- Confirmation expires after 5 minutes.
- A hard test-ETH fee ceiling displayed in the review.
- Allow only chain 46630, our token contract, and ERC-20 transfer.
- No token approvals, arbitrary contract calls or mainnet signing.
- Small invite-only tester list; capped wallet creation and test-ETH provisioning.

Confirm processing must check:
1. Valid webhook signature and expected business number.
2. Incoming sender matches the draft owner.
3. Opaque random button token maps to the exact unexpired draft/version.
4. Confirmation is unused and draft remains reviewable.
5. Recipient, amount, token, chain and fee ceiling are unchanged.
6. Daily amount reservation and payment claim succeed in one database transaction.
7. Fresh balances/simulation, signer policy and account status permit execution.

Provider policies should enforce supported restrictions independently of application code. Unsupported aggregate limits remain application-enforced and must be documented as such. SERV never decides whether a control may be bypassed.

Cancel and Confirm racing each other must have only one valid state transition. Changed contacts cannot mutate already reviewed recipients.

## 9. Transaction and failure recovery

States:
awaiting_confirmation -> approved -> submitting -> submitted -> included
with cancelled_before_submission, expired, rejected, failed, unknown, cancelled_onchain and replaced branches.

- Persist the execution intent, nonce assignment and provider idempotency key before calling the signer.
- Atomically serialize nonce use across transfers, faucet claims and any other operation from that wallet.
- On timeout, query the provider request and chain first. Keep the wallet and spend reservation blocked while the outcome is uncertain.
- If signing and broadcasting are separate, persist signed-transaction metadata/hash before broadcasting; retries broadcast identical bytes, not a fresh payment.
- Do not claim exactly-once execution until the chosen provider's retry semantics have been verified.
- Reuse existing receipt matching and same-nonce recovery logic, but reconcile provider records too.
- Never trust provider submission success as proof of payment.
- Release a spending reservation only on a verified pre-submission cancellation/failure or the documented terminal outcome; keep unknown reservations active. Record budget treatment explicitly.
- A failed WhatsApp receipt notification retries the notification only.
- Global pause blocks new approvals/signing while receipt monitoring continues.

For an uncertain operation without a hash, provider request lookup is a required capability. Existing manual hash recovery alone is insufficient for the custodial flow.

## 10. Delivery phases and acceptance gates

| Phase | Work | Done when |
| --- | --- | --- |
| 0 — signing proof | Provider account, credentials, testnet policies, small transfer | A managed wallet transfers DUSD on 46630; disallowed chain/token requests fail |
| 1 — WhatsApp transport | HTTPS webhook, signature validation, inbox, outbox | An allowed tester's “Hi” gets one real reply; replayed webhook does not duplicate work |
| 2 — wallet onboarding | Consent, unique wallet creation, capped funding, balance/receive | Same user gets the same wallet after retries/restarts and can read live balances |
| 3 — payment review | SERV tools, saved contacts, immutable drafts, buttons | “Send 5 Demo USD to Sila” displays the correct recipient, fee and expiry |
| 4 — execution | Atomic confirmation, limits, signer worker, receipts | Confirm produces one verified transfer and an in-WhatsApp receipt; Cancel produces none |
| 5 — recovery and demo | Failure tests, restart persistence, recording | Full flow works on two phones without wallet popups; failures do not double-send |

Planning estimate: roughly 4–6 focused development days after accounts and credentials are available, with provider or Meta setup potentially taking longer. This is not a deadline guarantee. Time-box phase 0 and phase 1 first; re-estimate after both pass.

First coding milestone: verified webhook inbox and confirmation state machine with a mock signer, while provider compatibility is established. Do not connect real signing until all authorization gates pass.

## 11. Verification checklist

Automated, using fake phones, isolated databases and local chain/provider fixtures:
- Forged signatures, wrong business number and unknown sender.
- Replayed webhook, duplicate wallet-creation request and worker restart.
- Wrong-user, expired, reused or tampered confirmation.
- Changed contact, model-invented address, ambiguous currency and prompt injection.
- Daily limits across concurrent requests and midnight boundary.
- Insufficient ETH/tokens, simulation revert and fee increase.
- Worker crash before/after provider submission; idempotency recovery.
- Duplicate/reordered messages, provider timeout, receipt failure and chain reorganization.
- Cancel/Confirm race, same-nonce replacement and notification retry.
- Phone-account freeze and global signing pause.

Live demo acceptance:
Two allowed WhatsApp users onboard -> receive test funding -> check balance -> save recipient -> request 5 DUSD -> confirm -> recipient balance increases -> receipt returned -> restart service -> history persists. No transaction approval popup or private-key entry.

No mainnet custody or real-money launch is implied by passing this test.

## 12. Inputs needed

Already available: SERV integration, deployed test token, Meta app/test number and one tested WhatsApp recipient.

Configure privately:
- WhatsApp access token, business phone-number ID, WABA ID, Meta app secret and webhook verify token.
- Managed wallet provider credentials and restricted signing authorization.
- Public HTTPS hosting/tunnel and database volume.
- A second allowed WhatsApp tester for the full live demonstration.

Verify remaining account facts: temporary token lifetime, required permissions/subscriptions, provider costs and Robinhood support, Meta usage requirements, SERV organization data collection, and hackathon testnet eligibility.

Do not paste access tokens, private keys, OTPs or app secrets in chat.

## 13. Source references and limits

- [Meta: WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) — official account/token and messaging API reference.
- [Meta: interactive reply buttons](https://www.postman.com/meta/whatsapp-business-platform/request/x0kd1at/send-reply-button) — supports the proposed Confirm/Cancel interface; app-side authorization still needs implementation.
- [Privy: wallet policies and controls](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls) — authorization/policy mechanisms and service-controlled configurations.
- [Privy: external IDs](https://docs.privy.io/wallets/wallets/external-ids) — candidate mechanism for internal-user wallet references; raw phone numbers need not be provider IDs.

The architecture, limits and schedule above are our proposed design. These sources do not establish Robinhood testnet compatibility, eligibility or a production custody approval.
