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
