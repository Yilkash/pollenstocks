# Backup trade quote provider review — 2026-09-25

## Recommendation

Proceed with a separately validated LI.FI fallback adapter as the next engineering
step. Quote feasibility is demonstrated for the exact deployed Robinhood stock
contracts. Execution readiness, sustained reliability and platform eligibility
have not been established. No production routing, signing policy, or code changed
in this investigation, and no transaction was submitted.

## Evidence

Read-only public API queries used synthetic address
`0x1111111111111111111111111111111111111111`, not a customer wallet.
LI.FI query parameters included fromChain=toChain=4663, slippage=0.01,
integrator=steward-pay, and denyExchanges=kyberswap. The returned nested tools
were checked; all samples named nordstern / feeCollection / nordstern, with no
Kyber tool. This demonstrates API-level independence in these samples, not a
proof that downstream liquidity has no shared dependencies.

| Provider | Current evidence | Decision |
| --- | --- | --- |
| Kyber | Two Railway GETs at 08:53 UTC returned HTTP 503/code 50301; earlier identical calls sometimes succeeded | Retain bounded retry; support report prepared with request IDs |
| LI.FI | All three 0.2 USDG buys returned HTTP 200 from both local and Railway probes, Kyber excluded; 0.001 AAPL→USDG sell also returned 200 from Railway | Best tested fallback candidate |
| 0x | Existing configured key returned HTTP 422 / BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE for Robinhood AAPL; message cites legal restrictions | Not usable for this pair/account as configured; do not bypass access restrictions |
| 1inch | Official documentation lists Classic Swap on chain 4663; no 1inch key configured, exact token quotes not evaluated | Candidate requiring credentials and pair-specific verification |

LI.FI buy outputs at 08:53:20 UTC (18-decimal raw token units; illustrative only):

| Stock | Input USDG | Output units | Minimum units |
| --- | --- | --- | --- |
| AAPL | 0.2 | 592446936296412 | 586522466933448 |
| NVDA | 0.2 | 881181131189401 | 872369319877507 |
| TSLA | 0.2 | 522450290080662 | 517225787179855 |

Each sampled buy included a provider fee of 500 USDG base units = 0.0005 USDG,
which is 0.25% of the 0.2 input; gas is separate. This is an observation, not a
promise of a fixed future fee schedule. The AAPL sell returned 335447 USDG base
units, minimum 332093, and an included fee of 2500000000000 AAPL base units.

Observed unsigned transaction target and approval spender:
`0xB477751B76CF82d00a686A1232f5fCD772414Af3`; selector `0x5fd9ae2e`.
These are API observations, not an approved contract allowlist. Zero native value
was returned on the buy samples. No returned calldata was submitted or signed.

See [sanitized probe evidence](evidence/quote-provider-check-2026-09-25.json).
The sample is too small to claim an SLA or long-term superiority. Sell coverage
was AAPL only; NVDA/TSLA sells and larger amounts still need checking.

## Implementation work before enabling fallback

1. Add a provider-specific quote/plan type; preserve old Kyber review records.
   Fallback only during new quote preparation after bounded transient failures.
2. Keep same-chain 4663 and canonical token addresses, exact input and recipient;
   exclude bridges, Kyber, and unexpected nested tools. Do not substitute a
   reference price for a missing executable quote.
3. Verify LI.FI deployment provenance and current ABI, decode calldata and validate
   nested destinations, spender, token pair, amount, fee recipients, minimum output
   and expiry behavior. Current validateMainnetPlan is explicitly Kyber-specific.
4. Assess required signing-policy changes with narrow router/method restrictions;
   retain exact approvals, balance/gas checks, simulation and operator amount caps.
5. Show provider fees and fresh output/minimum in the review. Bind confirmation to
   that exact provider and payload. An outage after confirmation must never silently
   reroute a trade or repeat a submitted transaction.
6. Verify buys/sells, changed wallets, stale quotes, malicious destinations,
   duplicate confirmation and recovery offline before a separately authorized
   controlled transaction check. Quote success alone does not prove execution.

## Kyber escalation

[Ready-to-send support message](KYBER_QUOTE_OUTAGE_REPORT.md). Not submitted:
the workspace has no connected Discord messaging tool. Kyber's official FAQ
points to https://discord.gg/kyberswap for support. We could not verify published
documentation defining 50301 beyond the actual response body; provider follow-up
is required to distinguish the internal causes.

## Primary sources

- LI.FI Robinhood announcement: https://li.fi/knowledge-hub/li.fi-is-live-on-robinhood-chain-from-day-one
- LI.FI quote parameters: https://docs.li.fi/li.fi-api/li.fi-api/requesting-a-quote
- Live LI.FI metadata: https://li.quest/v1/chains and https://li.quest/v1/tools?chains=4663
- 0x Robinhood support: https://docs.0x.org/changelog/2026/7/31
- 0x price API: https://docs.0x.org/api-reference/evm-ap-is/swap/allowanceholder-getprice
- 1inch Classic Swap: https://business.1inch.com/portal/documentation/apis/swap/classic-swap/introduction
- Kyber support: https://docs.kyberswap.com/getting-started/quickstart/faq
