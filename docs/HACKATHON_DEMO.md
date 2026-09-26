# Steward demo and submission draft

## Pitch

Steward is a WhatsApp AI assistant for payments and tokenized-stock discovery on
Robinhood Chain. OpenServ interprets requests; validated tools retrieve data and
prepare reviews. Users confirm supported transactions separately.

## Working demo

1. Menu → Ask Steward opens chat directly.
2. “What stocks are available?” shows the concise mainnet catalogue.
3. “What would 1 USDG get me in Tesla on mainnet?” shows a KyberSwap preview.
4. “Show my mainnet stocks” reads the displayed Steward address.
5. Show a Demo USD TESTNET payment, confirmation and explorer receipt.
6. “Stock trade status” shows actual recorded status.

Mainnet execution setup is pending. Do not present a preview as a filled trade or
a testnet payment as a mainnet transaction.

## After mainnet acceptance

Demonstrate a small, explicitly budgeted purchase: review minimum output and fees,
confirm once, show approvals and verified receipt, then updated holdings. Show
cancellation/expiry and explain duplicate-submission protection.

## Submission checklist

- Confirm organizer mainnet/testnet eligibility requirements.
- Verify required SERV reasoning/organization settings.
- Record only working features and identify network boundaries.
- Prepare repository access, deployment URL, architecture notes and limitations.
- Review the official submission form and required social post before publishing.
- No form, post or external message has been published by this work.

## Architecture

WhatsApp → authenticated webhook → durable inbox → SERV intent/tool selection →
validated arguments → review → user confirmation → gated worker → Privy →
Robinhood Chain → receipt verification → WhatsApp outbox.

The model receives no signing keys and cannot confirm its own trade.
