# Tokkenly / Steward trade-quote comparison — 2026-09-25

Read-only investigation. No orders, approvals, signatures, transfers or deployments.

## Source revisions

Existing review checkouts match their remote HEADs (checked with git ls-remote):

- Frontend: `6c55da7aa28e0cd435dc891356cfe6021dc3f6e9`
- Backend: `d65ef89467b8d4b347f5d73695d893450660f288`

This verifies repository revisions, not what commit Tokkenly currently runs in production.

## Code findings

- Backend `src/assets/assets.ts`: AAPLc, GOOGLc, METAc and NVDAc on Base.
- Backend `src/orders/quote.service.ts`: Kyber route uses the chain's USDC and stock contract.
- Backend `src/orders/kyber.client.ts`: one fetch for a route, eight-second default timeout;
  no second trading provider or retry loop in this path. Non-OK or nonzero provider
  code becomes KyberError; HTTP 5xx is classified as unreachable.
- QuoteService maps an unreachable provider to HTTP 503 and "we could not price that just now".
- Frontend buy form POSTs /api/orders/quote, surfaces returned errors, and offers review again.
- Shared frontend HTTP client retries GET/HEAD transport failures after 300/1200 ms;
  the quote POST does not receive those retries, and HTTP 503 responses are not retried there.
- Market/reference-price caching and RPC fallback are separate from executable trade quotes.
- Steward requests Robinhood AAPL with USDG; it now retries temporary quote GET failures once.
- Tokkenly omits excludeRFQSources; Steward sends true. No setting was changed.

## Public quote probes from the same Railway container

Used Steward's own x-client-id for both routes, amountIn 200000 (0.2 in each
six-decimal input token). These requests do not reproduce Tokkenly's private
hosting configuration, fee calculation or authenticated quote API.

| Sample | Base USDC → AAPLc | Robinhood USDG → AAPL |
| --- | --- | --- |
| 1 | HTTP 200 / code 0, 199 ms | HTTP 503 / code 50301, 469 ms |
| 2 | HTTP 200 / code 0, 124 ms | HTTP 503 / code 50301, 386 ms |

The Robinhood error body said "service temporarily overloaded". A subsequent
Robinhood option comparison succeeded both with excludeRFQSources omitted and
with true; both returned pancake-infinity-cl routes. This supports intermittent
provider availability and does not establish that the option causes the failures.

The small sample cannot establish long-term reliability, nor prove Tokkenly never
fails. Different network/token routes explain why the same provider can succeed
for one app and fail for another. Next useful action: monitor bounded quote error
codes and raise the reproduced Robinhood 50301 with Kyber before changing venues.
A fallback execution venue would require separate route and calldata validation;
reference prices cannot substitute for executable quotes.
