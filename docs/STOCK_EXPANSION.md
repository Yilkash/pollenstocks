# Stock catalogue expansion: 3 to 9 — 2026-09-28

## Added

Microsoft (MSFT), Alphabet (GOOGL), Amazon (AMZN), Meta (META), S&P 500 ETF (SPY) and
Nasdaq-100 ETF (QQQ), alongside Apple, NVIDIA and Tesla.

Checks before adding, all read-only:

- Robinhood registry (`api.robinhood.com/rhj/assets`): each symbol active, 18 decimals,
  exactly one chain 4663 deployment at the configured address.
- Chainlink directory: one `Robinhood <SYMBOL> / USD` primary tokenized price feed each.
- KyberSwap 1 USDG buy quotes matched Robinhood's token ask within about 0.1%.
  LI.FI fallback routing was not tested for the new tokens.

## Why a policy change is needed

Buying uses the existing USDG approve rule and the Kyber swap rule. Selling approves the
stock token itself, so each added stock needs one Privy approve rule on its contract.

The validator now requires the original rules (AAPL, NVDA, TSLA and USDG approves, Kyber
swap, USDG transfer) and accepts the LI.FI rule and added-stock approve rules as optional.
A sell additionally requires the approve rule for its input token, so selling an added
stock before rollout stops at preflight with nothing submitted.

## Rollout order

1. Deploy the compatible worker. It accepts the policy before and after the new rules.
2. From `apps/web`, run the read-only check, then apply:
   `node --env-file=.env.local --import tsx scripts/mainnet-enable-stocks.ts`
   `node --env-file=.env.local --import tsx scripts/mainnet-enable-stocks.ts --apply`
   Apply adds only the missing approve rules, re-reads the policy and verifies each added
   stock is sellable. An uncertain response is resolved by re-running; present rules are
   skipped. No rule is removed and no transaction is sent.
3. Make one small buy and sell of a new stock and confirm the receipts.

The read-only check against the live policy passed on 2026-09-28 before deployment and
listed exactly the six missing approve rules.
