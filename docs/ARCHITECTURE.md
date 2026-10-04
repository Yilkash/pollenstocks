# Architecture

Pollenstocks is one Next.js app plus two background workers (WhatsApp and transactions), started together by `scripts/start-production.mjs`. State lives in SQLite on a persistent volume.

## Message flow

1. **Webhook.** `POST /api/whatsapp/webhook` checks Meta's `X-Hub-Signature-25042` and stores the message in an encrypted inbox. The request returns immediately.
2. **Guard.** Every SERV request carries the `serv_prompt_guard` tool. A flagged message comes back as a refusal, gets a fixed reply, and no tool runs.
3. **Assistant.** SERV Reasoning receives the conversation and a small set of tools: list stocks, prices, holdings, trade status, the wallet address, contacts, and preparing a trade or a send. None of them can confirm, sign or broadcast.
4. **Review.** A prepared plan is stored, and the user receives an exact review with **Confirm**, **Details** and **Cancel** buttons. The button carries the plan ID and a one-time token.
5. **Runner.** A confirmed plan is leased by the transaction worker, validated again, signed by the user's Privy server wallet and broadcast. The runner waits for the receipt, decodes the desk's `Bought` or `Sold` event, matches it to the token movements, and replies with an Arc explorer link.
6. **Outbox.** Every reply goes through a durable outbox, so a crash never loses or duplicates a message.

## Preparing a trade

`prepareMainnetPlan` in `src/server/stocks/mainnet-trade.ts`:

1. Checks the amount (6-decimal USDC, trade cap), the token registry (`verifiedMainnetRegistry`), the chain head freshness, and the pinned ArcStocks desk (`checkDesk`).
2. Checks the backing (`verifyBacking` in `src/server/stocks/backing.ts`): the token's `totalSupply` on Arc must not exceed what ArcStocks' vault holds of the same stock on Robinhood Chain (0.1% tolerance for transfers in flight).
3. Reads the desk's own on-chain quote (`quoteBuy` or `quoteSell`) and sets a 1% minimum.
4. Checks the quote against Robinhood's live bid/ask for the same stock (`fairPriceCheck`): refused if more than 2% worse, if the stock is halted or if the price is unavailable. Off-hours spreads are capped so a very wide ask cannot wave an overpriced buy through.
5. Builds the calldata itself. A buy is one payable `buy(stock, minSharesOut, wallet)` carrying the USDC as native value. A sell is an exact `approve` to the desk, then `sell(stock, shares, minUsdcOut, wallet)`.
6. Estimates gas and sets a fee ceiling. On Arc the native balance is USDC, so a buy needs the USDC it spends plus the fee from one balance.

## Token registry

Each pinned ArcStocks token (NVDA, TSLA, AAPL, AMZN, META, GOOGL, SPY, QQQ) is verified on-chain before trading: contract code, the `<TICKER>.arc` symbol and 18 decimals. Copycat tokens with the same names exist on Arc; only the pinned addresses are ever used.

## Validation before signing

`validateMainnetPlan` runs again inside the runner, right before signing:

- chain ID 5042, and the token must be the pinned token for the requested stock;
- the desk proxy code hash, its ERC1967 implementation address and that code hash must match the pinned values, and the desk must not be paused;
- the backing check runs again right before the trade step is sent;
- the live Privy policy must contain exactly the generated rules (`validateMainnetPolicyRules`) and nothing else;
- the order must not have expired, and the lease must still be held.

## Privy policy

`mainnetPolicyRules()` generates the policy from the token list, so the code and the policy cannot drift. Each rule pins chain 5042, the target contract, the native value and the function name:

- `approve` on each of the 8 stock tokens (value 0);
- `transfer` on USDC (value 0);
- `buy` on the ArcStocks desk, with value at most the per-trade USDC cap;
- `sell` on the ArcStocks desk (value 0).

`scripts/mainnet-policy-update.ts` replaces the rules of the existing policy in place, so wallets keep their policy ID.

## Failure handling

- **Unknown broadcast outcome.** The runner records the nonce before submitting, refuses to sign while the wallet has a pending transaction, and closes an order that never reached the chain as `not_broadcast` instead of retrying blindly.
- **Gas.** The bid carries 5% headroom over the latest base fee, and the limit comes from an estimate with a margin.
- **Stale data.** Reference prices from a failed refresh and chain heads older than 2 minutes are refused; backing reads are cached for at most a minute.
