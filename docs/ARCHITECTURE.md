# Architecture

## Ownership

| Directory | Responsibility |
| --- | --- |
| apps/web/src/app | Next.js page, layout, styling and API entry point |
| apps/web/src/components/payments | Balance, send form, chat, review, receive, activity and contacts views |
| apps/web/src/hooks | Wallet/session state and named user actions |
| apps/web/src/lib | Browser wallet/API client and shared payment types/validation |
| apps/web/src/server/routes | Authentication, contacts, payments and chat HTTP handlers |
| apps/web/src/server/http.ts | Origin-adjacent HTTP helpers, body limit, cookies and rate limit |
| apps/web/src/server/router.ts | Origin check, authentication boundary and request dispatch |
| apps/web/src/server/payments.ts | Preflight, draft creation, signing claim and receipt verification |
| apps/web/src/server/serv.ts | Bounded SERV tool loop; no signing capability |
| apps/web/src/server/store.ts | SQLite schema, wallet-scoped records and state transitions |
| contracts | Demo-token source, deploy script and existing contract tests |

The web app uses viem directly with an injected wallet. SQLite requires a persistent writable disk and Node.js 24+. Contract dependencies are shared Git submodules in the repository-level lib directory.

## Payment lifecycle

1. The user signs a short-lived login challenge; the server issues an HTTP-only session cookie.
2. A form or SERV tool requests a draft. The server validates the recipient and integer amount, checks balances, simulates the transfer, estimates gas and stores a five-minute draft.
3. Review shows the full sender, recipient, token, amount and network.
4. The server atomically claims the draft before the browser opens the wallet. A unique database index permits only one signing/submitted/unknown payment per wallet and chain.
5. The browser checks the claimed draft against the reviewed details and current wallet. The user's wallet signs and broadcasts.
6. The browser retains the transaction hash before asking the server to attach it.
7. The server matches the actual transaction, then requires a successful receipt and matching Transfer event before recording inclusion.

A receipt confirms chain inclusion, not final settlement. The server and SERV hold no wallet private keys.

## State and recovery

Drafts can expire or advance to signing. A wallet rejection is recorded as rejected. A known hash advances to submitted and then included or failed. An ambiguous result remains unknown; the app must not automatically resend.

The user can recover a transaction hash from browser storage or wallet history. Recovery accepts only the reviewed token transfer and nonce. Receipt refresh is manual. Replacement/cancellation reconciliation and recovery from an unresolved signing attempt without a hash are still unfinished.

## Data and boundaries

Contacts, payments and chat history are scoped to the authenticated wallet; payments and chat history also have a chain ID. Draft creation has a request ID to avoid recreating the same request. These controls do not provide exactly-once execution across independent wallet actions.

Session tokens are stored as hashes. Mutation requests require the configured browser origin. Rate limiting is process-local. Private RPC credentials are not returned in public wallet configuration.

SERV receives chat messages and relevant tool outputs. Notes are excluded from transfer calldata but can appear in SERV inputs. The interface discloses this processing.

## Verification status

Production compilation and contract compilation are separate from behavioral testing. No live deployment, full wallet-to-wallet transfer or authenticated SERV call has been demonstrated yet. See PLAN.md for the remaining acceptance gates.
