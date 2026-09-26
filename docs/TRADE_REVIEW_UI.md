# Compact WhatsApp trade reviews

2026-09-25:

- Buy/sell review shows exact input, abbreviated estimated and minimum output,
  provider fee when present, maximum network fee, and expiry.
- Output displays round down to six significant digits. The displayed network
  fee ceiling rounds up. No rounded value enters transaction construction.
- Details is an authenticated read-only action on the existing review. It shows
  exact amounts, estimated/maximum gas costs, tolerance, provider and approval
  information. It neither confirms nor extends the review.
- Buttons say Confirm buy / Confirm sell, Cancel, Details. Existing confirmation
  IDs and existing reviews remain compatible. USDG payment reviews are unchanged.
- Sell execution already existed. Chat now recognizes quantities followed by
  company names, e.g. “Sell 0.001 Apple shares”, and uses stock tokens as input,
  with USDG proceeds. Changing stock or direction clears old quantities; a prior
  buy budget cannot silently become the sell amount. “Sell all” asks for an explicit
  quantity instead of guessing holdings.

Validation: TypeScript and production build passed. No automated tests were
added or run for this change. No real sell transaction was submitted by the agent.

Deployment: `806ab113-634e-444b-8d30-732968485e70` is SUCCESS on Railway
production. The previous deployment was removed; website returned HTTP 200,
and WhatsApp worker startup with mainnet execution enabled was confirmed.
