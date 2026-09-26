# Stock reference prices — 2026-09-25

## What changed

Public price questions now use `src/server/stocks/reference-price.ts`. A price
lookup no longer requires a KyberSwap route for selling one token. Exact-input
previews and transaction preparation still use fresh trading quotes; reference
prices are never used as signing amounts, minimum outputs or execution prices.

The quantity-to-reference-value explanation also uses the new reader and labels
its value USD, not USDG. The chat displays each asset independently, in USD per token, with a short age
calculated from its provider timestamp and any older/saved-data status. Provider
names remain in the internal result rather than the normal price reply. `try again` bypasses the
15-second displayed-price cache while coalescing simultaneous refresh requests.

## Sources and units

1. Chainlink's Robinhood mainnet directory selects the exact Robinhood stock/USD
   feed by name, underlying symbol, chain and product type. Directory results are
   held for one hour. No Base feed or same-ticker token is substituted.
2. Public RPC reads check chain 4663 and a recent block, the token's
   `oraclePaused()`, feed decimals and latest positive completed round at that
   block. The Chainlink answer is already adjusted for corporate actions.
3. If the primary source is unreachable or its observation is over four days old,
   the reader tries Robinhood's `/rhj/prices/{symbol}` and `/rhj/assets` endpoints.
   It checks canonical token addresses, active status, decimals, trading halt,
   pending multiplier and USD currency. The midpoint of raw bid/ask is multiplied
   by `currentMultiplier` using bigint arithmetic. REST observations must be at
   most two minutes old. This is an indicative token value, not a trade quote.
4. Explicit oracle pauses, invalid data or asset identity failures are not hidden
   with another source or a saved value. Raw exception details and credential-bearing
   RPC URLs are never logged; logs contain symbol, source and bounded error code.

## Freshness and failure handling

- Successful display reads: 15-second process-local cache; no wallet data.
- HTTP temporary failures: one retry after 400 ms, five-second attempt timeout.
- RPC: optional `MAINNET_REFERENCE_RPC_URLS` (comma-separated provider URLs), then
  official public RPC, with one retry. The setting only affects reference reads.
- A source timestamp older than its documented heartbeat is labelled an older
  reference. Display-only observations expire after 96 hours, allowing labelled
  previous-session information across ordinary weekends. This is not trading
  authorization or a guarantee that a feed is healthy.
- If both sources suffer temporary failures, a previously successful result may
  be displayed for up to five minutes since it was read, within the same 96-hour
  observation limit. It is explicitly labelled saved/refresh unavailable. Cache
  age is not renewed on failure. The memory cache is lost on worker restart.
- Each stock failure leaves the other rows visible. No failed lookup becomes zero.
- KyberSwap's existing read-only preview now also retries a busy response once,
  after 600 ms. Its original quote validity checks remain in force.

The new display reader checks block freshness, but does not use a separate L2
sequencer-uptime feed. It must not be reused as a trading oracle without a separate
review of sequencer, heartbeat, market-session and corporate-action requirements.

## Evidence and implementation status

The official public Chainlink directory and read-only oracle calls were inspected
on 2026-09-25. The three feeds returned positive answers, eight decimals, completed
rounds and `oraclePaused = false` for the configured token contracts. Observed
proxies (runtime discovery remains authoritative):

- AAPL: `0x6B22A786bAa607d76728168703a39Ea9C99f2cD0`
- NVDA: `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`
- TSLA: `0x4A1166a659A55625345e9515b32adECea5547C38`

Robinhood's public AAPL quote and the three canonical asset/multiplier records
were also read. These were source-discovery calls, not transaction tests. The
current Railway deployment's last 48 hours returned no matching `Stock reference
price unavailable` log entries, so the tester screenshot's exact historical
failure remains unconfirmed.

Verification completed on 2026-09-25:

- `npm test`: 60 passed, zero failed. This includes 22 new isolated pricing
  checks covering caching, forced refresh, concurrent lookups, retries, REST
  multipliers, bounded saved prices, partial failures, invalid/paused assets,
  observation age, exact integer formatting and `try again`/`all` context.
- The first full run exposed 12 obsolete testnet wallet test expectations:
  `My account` now routes to mainnet rather than offering a legacy testnet wallet.
  The test fixture now obtains legacy consent directly from its handler, retains
  the consent/provisioning/recovery assertions, and asserts current mainnet menu
  routing. No wallet production code was changed during this verification.
- `npm run typecheck` and `npm run build`: passed.
- Live public, read-only calls through the new reader returned Chainlink values
  for all three symbols: AAPL $336.31, NVDA $225.57 and TSLA $380.25. These are
  observations from the verification run, not current executable quotes. The
  local chat formatter included the source and actual provider update time.
- With the primary RPC deliberately blocked in a separate local process, actual
  Robinhood REST calls returned AAPL $336.04, NVDA $225.49 and TSLA $381.58,
  confirming the backup path for all three configured tokens.

Automated providers were mocked and test databases were temporary. Live checks
used only public price/metadata/oracle reads. No wallets were created, no trades
or payments were submitted, and no WhatsApp messages were sent. A real WhatsApp
conversation through the deployed worker remains to be checked after deployment.
Deployment completed on 2026-09-25 to Railway production, service
`endearing-solace`, deployment `a8a2d869-ecbb-4aeb-b3ee-c7c6e5b2d6a0`.
Railway reports `SUCCESS`; logs confirm the website ready and WhatsApp worker
started in public-access mode. Public `/` and `/api/session` returned HTTP 200.
The real WhatsApp conversation check remains pending.

## Primary documentation

- https://docs.robinhood.com/chain/oracles-and-price-feeds/
- https://docs.robinhood.com/chain/stock-token-apis/
- https://docs.robinhood.com/chain/connecting/
- https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood
- https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json


## Price reply simplification — 2026-09-25

The normal price reply now uses a single USD heading, bold per-token values and
relative update ages (minutes, hours or days). Provider names and full UTC dates
are omitted. Older/saved-price notices and the final-quote confirmation note remain.
The chat follow-up recognizer accepts the new heading and the previous headings.
Verification: all 66 tests passed (including six age-format cases), and the
production build passed. No pricing-source or transaction behavior changed.

Display update deployed successfully as `4a3e71cf-f17c-4b9e-b496-6a047bcb7dda`.
Railway reported SUCCESS and logs confirmed website and public WhatsApp worker startup.


## Stock request and trade quote diagnosis — 2026-09-25

The report `I want apples shares worth 0.2 usdg` exposed exact-name validation
that did not accept plural `apples`. Supported company aliases now cover plural
and possessive forms with word boundaries; the task retains AAPL and the exact
0.2 USDG budget. Unknown companies are not fuzzy-matched and multi-stock trade
requests ask for clarification.

Production logs contained two `route_unavailable` failures. A read-only route GET
from the Railway container returned HTTP 503, code 50301, `service temporarily
overloaded`; contemporaneous local 0.2 and 1 USDG route requests succeeded. The
old logs did not retain HTTP status, so the historical requests' exact provider
status cannot be proven. This reproduction confirms a production-side provider
availability problem, separate from the public reference-price sources.

Trade route GETs now retry once after 600 ms for transport errors and HTTP
429/502/503/504. Continued overload reports the quote service as busy. Diagnostics
record only attempt and HTTP status/network failure. Calldata building, signing
and submission are not retried by this helper; validation and confirmation gates
remain in place. This does not guarantee service availability during an outage.

Verification: all 79 tests and production build passed, including offline phrase
and quote-retry regressions. Live probes were GET quotes only, with no wallet or
transaction actions.

Deployed as `d51713bc-0942-4b2f-8363-56e842d0ec2a` (Railway SUCCESS;
website and public WhatsApp worker started). A direct deployed-module probe
resolved the reported phrase to AAPL. The 0.2 USDG route GET returned 503 on
attempt 1 and HTTP 200/code 0 on attempt 2, demonstrating recovery through the
bounded retry. No order was created and no transaction was submitted.
