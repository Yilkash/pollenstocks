# Ask Steward: AI intent routing and task memory

## Approved data boundary

The user explicitly approved the current message, up to four recent chat exchanges,
and user-provided current task details being sent to OpenServ at
`https://inference-api.openserv.ai/v1/chat/completions`. Automatic approval review
initially blocked this expansion until that specific authorization was obtained.

Every WhatsApp user must accept the new `serv-task-memory-v2` disclosure. An old
current-message-only session does not authorize the new payload. Requests are bound
to the exact consent session; queued requests from a closed session are rejected.

- History is encrypted locally and limited to four exchanges, with a one-hour expiry.
- Unfinished task fields expire after ten minutes. Menu exits and clears chat memory.
- Expired memory is purged by the worker. These limits apply to assistant memory;
  the existing encrypted inbox/outbox records have their separate lifecycle.
- Fixed instructions and tool schemas accompany the opted-in context.
- Stored balances, contact lists, payment records, sender identifiers and wallet keys
  are excluded. Tool results go directly to WhatsApp, not back to inference.
- History stores user messages and model explanations or generic tool markers,
  never the returned balance/contact/receipt data. Users may themselves type such data.

## Intent tools

In an opted-in chat, ordinary text reaches SERV before local command rules. Menu and
confirmation button payloads remain deterministic. Menu shortcuts leave AI chat.

Tools support balance reads, receiving address/account readiness, recent payment
status, contact lists/lookups, affordability checks, payment drafts, contact-add
and contact-delete confirmations, and cancelling unfinished drafts.

The model proposes tool arguments. Runtime validation checks argument shapes,
user-provided values, account scope and task state. Missing payment/contact fields
are collected across messages. Demo USD is the only supported payment asset;
USD shorthand is explicitly presented as Demo USD in review.

Payment tools reuse existing limits, recipient resolution, fee checks and durable
review. There is no AI signing, submission or confirmation tool. Contact tools also
prepare confirmation buttons rather than applying changes directly. Affordability
uses actual balances and a conservative fee reserve, with exact fee and spending
checks deferred to payment review.

## Verification

TypeScript compilation passed. The broader intent and memory flow still requires a
live user check. No automated tests or synthetic inference requests were run.
Existing live payment/receipt flow was previously confirmed by the user.

Typing feedback refreshes while replies are prepared and while confirmed payments
remain active (bounded to three minutes). Meta/network failures can still prevent
those indicators being displayed; delayed payment notices remain the fallback.

## Guided onboarding

A first greeting introduces Steward with a Create account button. Account acceptance
immediately presents the separate Privy wallet disclosure. Wallet completion sends
the address together with the AI memory opt-in. After acceptance, the capability list
invites a natural-language request. Existing users can greet Steward to resume chat
or receive their next unfinished setup step; Menu remains an explicit shortcut.

This flow preserves separate account, wallet and AI consents. No PIN feature has been
added. Compilation passed; first-time onboarding still needs a live user check.

## Tester feedback: conversation repair (2026-09-24)

The router now receives explicit single-wallet and supported-stock capability rules.
Private tool replies retain fixed topic markers in the same four-exchange, one-hour
memory window. These markers contain no returned data and assert no success; balances,
addresses, contacts and transaction outcomes still stay out of inference. This prevents
the history from containing only repeated user requests after private replies.

Public-stock wording receives the user's current request as well as the public result,
so it can answer a specific availability question or ask for a missing purchase detail.
Price keywords no longer force a price lookup for explanations or unsupported companies;
the existing explicit price retry handling is retained. SERV_MODEL remains unchanged.
No automated tests or synthetic model conversations were run for this change.

### Out-of-range trade amounts

Mainnet tool input now accepts a bounded amount string without throwing on five-digit
values such as 30000. Before requesting a quote or preparing an order, local validation
explains the existing 1,000-unit input limit and precision requirements. Rejected amounts
are cleared from the unfinished task while preserving stock and direction for correction.
Trading limits are unchanged. No tests or synthetic inference requests were run.

## WhatsApp reasoning upgrade (2026-09-24)

Production WhatsApp chat uses `WHATSAPP_SERV_MODEL=gpt-5.4` with
`WHATSAPP_SERV_REASONING_EFFORT=medium` through OpenServ `/v1/responses`.
The authenticated OpenServ catalogue lists GPT-5.4 as reasoning-capable; its API
documents forwarding `reasoning_effort`. No raw/BRAID-bypass header is used.
The primary request allows 4,096 completion tokens (including reasoning) and 45 seconds.
Visible answers are bounded to 3,500 characters. Public-result wording uses
`WHATSAPP_SERV_WORDING_MODEL=gpt-5.4-mini`, reasoning none, 700 completion tokens.
The web demo's SERV_MODEL stays unchanged. To roll WhatsApp back, set
WHATSAPP_SERV_MODEL=gpt-5.4-mini and WHATSAPP_SERV_REASONING_EFFORT=none.

The system prompt is organized into conversation, capabilities, tools, authorization
and explicit-testnet sections. Model-selected tools replace keyword-based forced
routing for ordinary conversation. Explicit price retries and confirmation buttons
remain deterministic. Backend validation, trade limits and four-exchange privacy
boundaries are unchanged. Initial implementation used Chat Completions; live HTTP 400 errors exposed a tool/reasoning incompatibility.
Inference costs and latency can increase; conversation quality needs live evaluation.

### Provider compatibility checks (user approved)

Synthetic checks confirmed GPT-5.4 medium reasoning works for plain text, but its
Chat Completions endpoint returns HTTP 400 when function tools are included. The
provider's error explicitly requires Responses or reasoning none. A synthetic colour
lookup on `/v1/responses` returned HTTP 200, the correct function call, and 23 reasoning
tokens. No tools were executed. The adapter uses flat function definitions with
strict:false, preserves optional tool inputs, and ignores reasoning output.

A check using the full production prompt/tool definitions was blocked by automatic
approval review. Compatibility checks used newly written synthetic prompts and tools
instead. No user conversations or wallet data were used. OpenServ Responses requests
use store:false; retained chat context stays within the existing approved scope.

