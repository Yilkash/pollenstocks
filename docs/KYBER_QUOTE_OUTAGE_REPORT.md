# Kyber Robinhood quote outage — support message ready to send

Status: drafted, not sent. No Discord connection is available in this workspace.
Official support channel: https://discord.gg/kyberswap (linked by
https://docs.kyberswap.com/getting-started/quickstart/faq).

## Message

Hello Kyber team — we are integrating your Aggregator API in Steward on
Robinhood Chain (4663). Quote GETs intermittently return HTTP 503 with body
`{"code":50301,"message":"service temporarily overloaded"}`.

We reproduced this from our Railway production container in europe-west4.
The calls below are low-volume, sequential public quote requests, not builds
or transaction submissions. Client header: `x-client-id: steward-pay`.

Reproduction:

```bash
curl -i --get 'https://aggregator-api.kyberswap.com/robinhood/api/v1/routes' \
  -H 'x-client-id: steward-pay' \
  --data-urlencode 'tokenIn=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' \
  --data-urlencode 'tokenOut=0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9' \
  --data-urlencode 'amountIn=200000' \
  --data-urlencode 'excludeRFQSources=true'
```

This is 0.2 USDG into AAPL. Observations on 2026-09-25 (UTC):

| Time | HTTP / code | Request ID | CF-Ray |
| --- | --- | --- | --- |
| 08:53:16.491 | 503 / 50301 | 4c97355d-810e-42e6-bf6b-9731693f7141 | a408cc24aad6391d-AMS |
| 08:53:18.713 | 503 / 50301 | f6f4e13a-7fc3-4978-b45b-efaf1377ab3b | a408cc305ca2391d-AMS |

Both responses included `Retry-After: 0`. Earlier identical requests sometimes
succeeded, including after one 600 ms retry. In an earlier small comparison,
Base USDC→AAPLc succeeded twice from the same container while Robinhood failed
twice. This is not a long-term availability measurement. Omitting
`excludeRFQSources` did not establish a cause: both option variants later succeeded.

Could you confirm:

1. What specifically triggers 50301 on the Robinhood endpoint: route computation,
   upstream liquidity service, overload protection, or per-client limits?
2. Whether the request IDs point to a known incident or regional problem.
3. The recommended retry/backoff behavior, especially when Retry-After is zero.
4. Whether an official higher-availability endpoint or integrator capacity tier
   is available for this chain and these stock-token pairs.

We currently retry only the route GET once. We never retry transaction submission
because of a quote failure. No customer wallet, API secret or personal data is
needed for this investigation.
