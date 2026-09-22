# Ask Steward: proposed data boundary

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
  message and explicitly request Demo USD. Ambiguous input asks for a complete request.
- Payment proposals reuse the deterministic manual flow and confirmation buttons.
  No signing, submission, contact mutation or privacy-setting tool is exposed to SERV.
- Chat has per-account request limits and bounded request size/time. Menu exits chat.
- Choosing local commands instead leaves all existing menu features operational.

## Implementation status

Account-bound, expiring opt-in, local tool routing, request limits and durable payment
review are implemented. No tool can sign or send a payment. Only the existing payment
confirmation flow can authorize submission.

TypeScript compilation passed and the WhatsApp worker was restarted on 2026-09-22.
A live Ask Steward response has not yet been verified.
No sample WhatsApp messages are submitted to the inference provider during compilation.
