# Changelog

## 2026-09-22 — Initial implementation and organization

### Added

- Wallet sign-in, contacts, token/ETH balances and receive QR.
- Manual payment drafts, SERV tools, wallet approval, receipt checks and hash recovery.
- Persistent SQLite records and a test-only faucet token.
- Setup, architecture and contribution guides.

### Organized

- Moved the web app to apps/web and contract code to contracts.
- Grouped current research and plans under docs; archived the superseded portfolio plan.
- Split the interface into seven components and a state/action hook.
- Split request handling into HTTP helpers, authentication and feature handlers.
- Separated browser/shared code from server code.
- Added repeatable formatting and removed generated Counter boilerplate.
- Kept shared Foundry dependencies at the repository root.

### Pending

- Live testnet token deployment and a complete wallet-to-wallet transfer.
- An authenticated SERV request and hackathon eligibility clarification.
- Behavioral tests and complete cancellation/replacement recovery.

Compilation checkpoint: `npm run build` passes (including TypeScript); `forge build --skip test` passes from the contracts directory. No tests were run during this reorganization.

## 2026-09-22 — Browser wallet deployment

- Added a testnet deployment page with wallet connection, estimated fees and explicit wallet approval.
- Added a reproducible token bytecode export and receipt/code verification.
- Added recovery for a submitted deployment hash. No deployment has been broadcast by the assistant.

## 2026-09-22 — Testnet token configured

- User deployed Demo USD at `0x13800afeea6f8688547770052b395099758d9a5b` on chain 46630.
- Read-only RPC checks confirmed the runtime bytecode, name, symbol and six decimals.
- Configured the local web app with the verified token address. Faucet claim, end-to-end transfer and authenticated SERV call remain pending.

## 2026-09-22 — First transfer and authenticated SERV balance call

- Verified a 5 DUSD transfer on testnet in transaction `0x8df33f824e50dccc49d204874205418a3b85a15581dce387756fbecc11f570cd`, block 122765407. Transaction fields and Transfer event matched the app payment; balances at inclusion were 995 DUSD for the sender and 5 for the recipient.
- Successfully authenticated to SERV with the local key and configured model. SERV requested get_balances and then returned the onchain balance of 995 DUSD and 0.00999217189 test ETH (block 122766949).
- The running app reports SERV configured. This check exercised the SERV API/tool exchange directly; the full browser chat-to-payment approval flow remains to be demonstrated.
