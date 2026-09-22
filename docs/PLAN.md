# SERV Hackathon — wallet-to-wallet payment assistant

**Current proposed next phase:** [WhatsApp custodial-wallet prototype](WHATSAPP_CUSTODIAL_PLAN.md). This changes signing authority for the new WhatsApp mode: a managed server signer executes an explicitly confirmed payment. The existing externally signed web-wallet mode remains separate. The document below describes the earlier web-first plan; its checkpoints are historical.

Updated 2026-09-22. Status: initial web interface, payment API, SERV adapter and test-token contract implemented. Web production build passes; live transfers and authenticated SERV remain pending.
Working name: Steward Pay (provisional).
This replaces the portfolio proposal preserved in archive/PORTFOLIO_PLAN.md.
Evidence and sources: PAYMENTS_RESEARCH.md.

## Product and first user

A conversational payment assistant for freelancers and small teams on Robinhood Chain.

Pitch: “Tell Steward who to pay. Review the details, approve in your wallet, and get a receipt.”

First testnet example: “Send 5 Demo USD to Ada for the design work.” SERV resolves the request using the user's saved contacts and balance tools. The app presents the exact transfer. The user signs it in their wallet. The app verifies inclusion and produces a receipt.

Start with mobile-friendly web chat. WhatsApp can later use the same backend and a secure browser approval page. This is an independent Robinhood Chain application, not an integration with Robinhood brokerage accounts or Azza.

## Confirmed foundation and open gates

| Item | Status |
| --- | --- |
| Chain infrastructure | Official docs and live read-only RPC checks agree: mainnet 4663; testnet 46630. ETH pays gas. |
| Payment asset | Robinhood officially lists USDG support on Robinhood Chain. |
| Candidate USDG contract | Reports USDG and six decimals on mainnet. Canonical issuer provenance remains unverified; metadata alone is insufficient. Mainnet sending stays disabled until verified. |
| SERV tools | Supported in official documentation. A live authenticated call with our account is still needed. |
| Hackathon scope | Mainnet & MCP includes payments on Robinhood Chain. This supports the proposed scope; it is not organizer acceptance. |
| Testnet eligibility | Public rules do not expressly confirm testnet-only acceptance. Organizer clarification remains open; nobody has been contacted. |
| Testnet payment token | Official testnet USDG has not been confirmed. Use a project test token with explicit demo labelling. |

## MVP

1. Connect an EVM wallet; show network, configured payment-token balance and ETH balance.
2. Receive: show the connected address, network-labelled QR and copy/share option. Receiving requires no signature.
3. Save a personal contact alias and address through explicit confirmation. An alias is not proof of identity or a globally registered username.
4. Chat: answer balance questions and prepare one payment to a saved contact or explicit address. Ask about missing/ambiguous amounts, currencies or recipients.
5. Review: show sender, full recipient address, alias, chain, token identity, exact amount, estimated ETH fee and private note.
6. Approve: user signs a standard ERC-20 transfer in their wallet.
7. Track: show awaiting signature, submitted, included, rejected, failed or unknown status, an explorer link and app payment history.

One recipient per payment, one configured token per network, one wallet per authenticated session. Use decimal strings and integer base units for money.

Once single payments are reliable, optionally add split-payment drafts for at most three recipients. Each transfer has its own approval and receipt. Show partial completion honestly and retry only unpaid items; this is not an atomic batch.

Later scope: WhatsApp, fiat conversion, bank payouts, airtime, cross-chain transfers, recurring payments and gas sponsorship. A user-signed ERC-20 transfer needs no custom custody vault, DEX, token allowance or investment strategy.

## Architecture

Implemented stack: Next.js + TypeScript for web/server, viem with injected EVM wallets, SQLite on a persistent disk for sessions/contacts/payments, and SERV chat completions on the server. See ../apps/web/README.md for setup and current limitations.

Flow:
User chat -> authenticated server -> SERV tools -> deterministic validation -> immutable payment draft -> review card -> user's wallet -> Robinhood Chain -> verified receipt.

| SERV tool | Responsibility |
| --- | --- |
| get_balances | Read configured payment-token and ETH balances for the authenticated wallet. |
| resolve_contact | Return a saved contact, ambiguity or not-found status. |
| prepare_payment | Validate inputs, simulate, estimate fees and persist a draft. Does not send money. |
| get_payment_status | Read verified transaction state for the user's payment. |

SERV interprets instructions, coordinates tools and explains results. Application code handles address validation, arithmetic, transaction encoding, authorization and receipt verification.

Use https://inference-api.openserv.ai/v1/chat/completions with a server-side key and a required system/developer instruction. Choose a currently available tool-capable model after an authenticated smoke test. Validate tool arguments against schemas and bound tool-loop length/cost. Fail clearly on API errors. Do not use raw/bypass mode. Keys never enter model inputs, client bundles or logs.

## Authorization and payment integrity

- Wallet sign-in uses a domain/chain-bound nonce with expiry and replay protection. Isolate contacts and payments by authenticated wallet. Account/chain changes invalidate pending approvals.
- Recipient addresses come from explicit user input or saved records. The model cannot invent or silently overwrite contacts. Contact edits require a dedicated user action.
- Accept only the configured chain and token. Validate address/checksum; reject zero address, nonpositive amounts and excess decimal precision. Highlight self-transfers.
- Bind drafts to ID/version, sender, chain, token, recipient, base-unit amount and expiry. Any edit requires fresh review. Validate wallet calldata against the reviewed draft.
- Check token and ETH balances, simulate and refresh fee estimates before signing. Account for applicable chain fee components. Estimates are not guarantees; token restrictions can cause transfers to fail.
- The user wallet signs and broadcasts. SERV and the backend hold no user private keys. A chat “yes” cannot independently authorize a transfer.
- Atomically claim the intent in durable storage before opening the wallet. Persist the transaction hash, disable repeat submission and reconcile state on reload.
- An ambiguous wallet/RPC timeout leaves status unknown. Check wallet/chain state before allowing a retry; never automatically send again.
- Standard ERC-20 transfers have no application idempotency key. App controls reduce accidental duplicates but cannot guarantee exactly-once execution if the user independently signs another transfer.
- Verify successful receipt plus the expected token Transfer event: chain, contract, sender, recipient and amount. A client-supplied transaction hash is untrusted until matched. Track replacements/cancellations and inclusion changes.
- Distinguish L2 inclusion from final settlement. Receipts do not prove recipient identity or merchant acceptance.
- Notes are not written in transfer calldata. Chat/tool notes may be processed by SERV. V1 history covers this app's payments, not a complete wallet index.
- Minimize data sent to SERV and explain provider data processing; the hackathon requires organization data collection enabled.

## Networks and hosting

Development: local chain, then Robinhood Chain testnet (46630). Deploy a six-decimal MockPaymentUSD faucet token. Label it “Demo USD — test token, no monetary value” in balances, approvals and receipts. Do not call it official USDG or imply redeemability.

Mainnet: verify canonical USDG contract provenance, deployed code and metadata before enabling transfers. A funded user-controlled wallet needs USDG and ETH. A small real demonstration is optional and requires the user to review and sign; this plan authorizes no real transfer or bridging.

Keep all drafts/history network-specific. Use provider RPCs for the hosted app because public endpoints are rate-limited. Deploy web/server over HTTPS with durable SQL storage and server environment secrets.

WhatsApp phase: first verify Meta account/setup access, then add authenticated webhook ingestion and expiring links to the existing wallet approval flow. Phone number ownership alone must never grant signing authority. WhatsApp setup is not yet confirmed.

## Delivery schedule

Assumes work begins September 22; rebase dates if starting later. These are estimates.

| Date | Deliverable | Acceptance gate |
| --- | --- | --- |
| Sept 22 | SERV access, web scaffold, wallet connection and test-token setup | One authenticated SERV tool call and live test-network balances. |
| Sept 23 | Standard transfer, simulation, fee checks and receipt verification | Wallet A sends test tokens to B; event and balance change agree. |
| Sept 24 | Chat tools, wallet sign-in, contacts and payment cards | A natural-language request prepares the exact tested transfer flow. |
| Sept 25 | Durable history, recovery and error handling | Reload, duplicate click, wallet rejection and ambiguous contact cases work. |
| Sept 26 | Hosted demo, relevant tests and usability; optional mainnet validation | A new user completes a payment; mainnet enabled only after its gates. |
| Sept 27 | Demo video, README, screenshots, X draft and submission form preparation | Working public demo and submission before deadline. Publication remains a user action unless delegated. |

Critical path: SERV access -> working token transfer -> chat preparation -> persistent receipts -> hosted demo.
Cut split payments and WhatsApp first if time is short. Preserve the complete single-payment flow.

## Verification during implementation

Test exact decimal parsing, amount boundaries, invalid recipients, wrong network/token, unauthorized sessions, ambiguous contacts, expired/tampered drafts, duplicate attempts, insufficient token/gas balances, rejected/reverted/replaced/unknown transfers, incorrect receipts and reload recovery. Check malformed SERV tool arguments and API failures.

Integration gate: two real test wallets, deployed test token, user-signed transfer on Robinhood Chain testnet, verified receipt and recipient balance change. Label simulated data; it cannot substitute for this milestone.

Evaluate SERV on a small set of ordinary and ambiguous requests, recording completion, clarification and latency. Do not claim improved outcomes without measurement.

## Demo and business hypothesis

Two-minute demo: connect funded test wallet -> ask balance -> save Ada -> request 5 Demo USD payment -> review full card -> approve in wallet -> see explorer-backed receipt -> reload and recover status. Then show insufficient funds being caught. Split payments are an optional extension.

Potential customers: freelancers paying collaborators and small teams keeping payment records. Later revenue hypothesis: subscriptions for team payment administration, reconciliation and exports. V1 has no app transfer fee. Customer willingness to pay is unvalidated; “chat to send crypto” alone is not a novelty claim.

## Inputs and unresolved dependencies

- SERV account/key and required organization data-collection setting. Configure credentials in environment settings, not chat.
- Two compatible wallets and test ETH.
- RPC, hosting and database access for deployment.
- Canonical mainnet token provenance and funding route before a real-money demo.
- Organizer clarification on testnet-only participation and any autonomy requirements. The public track wording includes payments but provides no detailed signing requirement.
- Final product name and X account for submission; naming does not block development.

Published deadline: September 28, 2026 at 00:00 UTC (01:00 Africa/Lagos). Aim to submit September 27.

## Implementation checkpoint — September 22

Implemented: wallet sign-in, balance reads, contact storage, receive QR, manual and SERV-assisted drafts, wallet approval, verified receipts, history and hash recovery. Web production build passes, including TypeScript. No live deployment, authenticated SERV call or end-to-end transfer has been completed. Receipt polling, replacement/cancellation reconciliation and unresolved-signing recovery require further work. Automated testing remains pending.

## Folder organization checkpoint

Web app: `../apps/web`. Contracts: `../contracts`. Current documents: this directory. Historical portfolio plan: `archive/PORTFOLIO_PLAN.md`. The UI now uses focused components and a shared state hook; server handlers are split by feature. Web and contract builds pass after the move. See `../CHANGELOG.md` for the milestone and `../CONTRIBUTING.md` for formatting and commit conventions.

## Live verification checkpoint — September 22

The user deployed the test token, claimed faucet tokens and sent 5 DUSD to a second wallet. Read-only verification matched the transaction and Transfer event and confirmed balances of 995 and 5 DUSD at inclusion. The local SERV key also authenticated successfully: a balance question triggered get_balances and produced an answer using live chain data. See the changelog for transaction and block references. Earlier pending-deployment and pending-authentication notes describe previous checkpoints. The full browser chat-to-payment demonstration, recovery testing and hackathon eligibility clarification remain open.
