# Ask Steward: data boundary and payment requests

Status: current-message-only integration authorized by the user and implemented.
The earlier history-sharing proposal was rejected by automatic approval review and
was not executed. The user approved this narrower design before implementation.

## Data boundary

- Selecting Ask Steward presents an opt-in disclosure before any external request.
- The only user data sent to `https://inference-api.openserv.ai/v1/chat/completions`
  is the current message deliberately entered in Ask Steward. It may contain a contact
  name, phone number, wallet address or amount supplied by that user.
- The request also contains fixed assistant instructions and tool schemas. Service API
  authentication is sent only as the required request header to that provider.
- No conversation history, contact list, live balances, stored payment records, WhatsApp
  sender identifier, wallet credentials or private keys are included in inference input.
- SERV selects one of: answer a general question, request a balance, request recent
  payment status, or propose recipient/amount fields for a Demo USD review.
- Balance/status retrieval and recipient resolution run locally after parsing. Results
  return directly to WhatsApp, without another inference request.
- Payment proposals must use recipient and amount explicitly present in the current
  message. USD shorthand or omitted currency means Demo USD in this testnet app;
  the payment review explicitly labels the asset. Other currencies remain unsupported.
- Payment proposals reuse the deterministic manual flow and confirmation buttons.
  No signing, submission, contact mutation or privacy-setting tool is exposed to SERV.
- Chat has per-account request limits and bounded request size/time. Menu exits chat.
- Choosing local commands instead leaves all existing menu features operational.

## Implementation status

Account-bound, expiring opt-in, local tool routing, request limits and durable payment
review are implemented. No tool can sign or send a payment. Only the existing payment
confirmation flow can authorize submission.

TypeScript compilation passed and the WhatsApp worker was restarted on 2026-09-22.
The user confirmed a live Ask Steward payment and receipt before the flexible-input update.
The latest flexible-input and typing refresh changes have compiled but have not been checked live.
No sample WhatsApp messages are submitted to the inference provider during compilation.

## Local payment language rules

Common send/pay/transfer requests are handled locally before inference, including
amount-first and recipient-first forms. Missing recipients retain the amount for ten
minutes; missing amounts use the existing payment-entry session. No draft history is
sent to SERV. All paths reuse the existing review and single-use confirmation flow.

Typing feedback is best effort and independent of payment processing. Confirmed
payments refresh it for up to three minutes while active; a durable delayed-payment
notice remains the fallback. A Meta/network failure can prevent the dots appearing.
