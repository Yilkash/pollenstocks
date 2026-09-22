# Reliability checkpoint — 2026-09-22

## Results

- 10 Node tests passed using isolated SQLite databases and a local fake RPC.
- 8 Chromium browser tests passed using injected fake wallets and intercepted API responses.
- 4 Foundry tests passed, including 256 fuzz runs for token balance conservation.
- Production build and TypeScript compilation passed.

No real wallet transaction or SERV request is made by these automated tests.

## Coverage

Backend checks cover exact token arithmetic, expired/tampered drafts, duplicate signing claims, a single pending-payment limit, rejection versus unknown status, request idempotency, wallet record isolation, sign-in replay protection, logout, persistence across database reopen, receipt matching, insufficient token/ETH balances, wrong chain and unsuccessful simulation.

Browser checks cover repeated unchanged account/network events, reload restoration without a new signature, actual account changes, temporary locks, network switching, explicit logout, wallet rejection, rapid duplicate approval clicks, ambiguous errors, and recovery after an interrupted post-broadcast API request.

Contract checks cover faucet limits, independent wallet claims, transfers, mainnet deployment rejection and balance conservation.

## Reconnect fix

Previously every account/network event cleared the wallet and deleted its session. The app now ignores unchanged events. Actual account/network changes clear the private view but do not race a server-side logout against a later connection. Explicit disconnect still revokes the session.

Connecting reuses an existing session for the same account, avoids unnecessary network switching, and waits for session restoration before enabling the connect button. A synchronous action guard prevents duplicate approval requests before React updates button state.

The local preview uses the production server to avoid development hot reloads. Use the same origin, http://127.0.0.1:3001, to keep its cookie. Sessions expire after 24 hours; expired sessions legitimately require another sign-in.

## Run again

From apps/web:

```bash
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Browser checks start a separate production server on port 3101. From contracts, run `forge test -vv`.

## Remaining limits

These browser checks simulate wallet extensions; the user's actual extension still needs confirmation after refreshing. They do not certify every wallet provider or chain reorganization behavior. Unknown transactions without a recoverable hash can still leave an intent blocked; cancellation/replacement reconciliation remains unfinished.

Hosted deployment and organizer confirmation of testnet-only eligibility remain pending.
