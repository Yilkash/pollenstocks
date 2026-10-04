# Architecture

Pollenstocks is one Next.js app plus two background workers (WhatsApp and transactions), started together by `scripts/start-production.mjs`. State lives in SQLite on a persistent volume.

## Message flow

1. **Webhook.** `POST /api/whatsapp/webhook` checks Meta's `X-Hub-Signature-25042` and stores the message in an encrypted inbox. The request returns immediately.
2. **Guard.** Every SERV request carries the `serv_prompt_guard` tool. A flagged message comes back as a refusal, gets a fixed reply, and no tool runs.
3. **Assistant.** SERV Reasoning receives the conversation and a small set of tools: list stocks, prices, holdings, trade status, the wallet address, contacts, and preparing a trade or a send. None of them can confirm, sign or broadcast.
4. **Review.** A prepared plan is stored, and the user receives an exact review with **Confirm**, **Details** and **Cancel** buttons. The button carries the plan ID and a one-time token.
5. **Runner.** A confirmed plan is leased by the transaction worker, validated again, signed by the user's Privy server wallet and broadcast. The runner waits for the receipt, decodes the Kyber `Swapped` event and replies with a Arc explorer link.
6. **Outbox.** Every reply goes through a durable outbox, so a crash never loses or duplicates a message.

## Preparing a trade

`prepareMainnetPlan` in `src/server/stocks/mainnet-trade.ts`:

1. Checks the amount (6-decimal USDC, trade cap), the token registry (`verifiedMainnetRegistry`) and the chain head freshness.
2. Builds the KyberSwap route for the pinned stock token and decodes the calldata. Router, executor, recipient, tokens, amounts and deadline must all match.
3. Checks the route against Robinhood's live bid/ask for the same stock (`fairPriceCheck`): refused if more than 2% worse, if the stock is halted or if the price is unavailable. Off-hours spreads are capped so a very wide ask cannot wave an overpriced buy through.
4. Estimates gas and sets a fee ceiling. On Arc the native balance is USDC, so a buy needs the USDC it spends plus the fee from one balance.

## Token registry

Arc has no official stock-token registry. Each pinned token (NVDA, CRCL, GME, AMC) is verified on-chain before trading: contract code, symbol, 18 decimals and the issuer's owner address. Copycat tokens with the same names exist on Arc; only the pinned addresses are ever used.

## Validation before signing

`validateMainnetPlan` runs again inside the runner, right before signing:

- chain ID 5042, and the token must be the pinned token for the requested stock;
- the router and executor bytecode hashes must match the pinned values;
- the live Privy policy must contain exactly the generated rules (`validateMainnetPolicyRules`) and nothing else;
- the order must not have expired, and the lease must still be held.

## Privy policy

`mainnetPolicyRules()` generates the policy from the token list, so the code and the policy cannot drift. Each rule pins chain 5042, the target contract, zero value and the function name:

- `approve` on USDC and on each of the 27 stock tokens;
- `swap` on the KyberSwap router;
- `transfer` on USDC.

## Failure handling

- **Unknown broadcast outcome.** The runner records the nonce before submitting, refuses to sign while the wallet has a pending transaction, and closes an order that never reached the chain as `not_broadcast` instead of retrying blindly.
- **Gas.** The bid carries 5% headroom over the latest base fee, and the limit comes from an estimate with a margin.
- **Stale data.** Kyber routes older than 2 minutes, reference prices from a failed refresh and chain heads older than 2 minutes are refused.
