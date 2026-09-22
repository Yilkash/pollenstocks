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
