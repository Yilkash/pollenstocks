# Wallet payments — verification record

Checked 2026-09-22. These are documentation and read-only checks, not a completed payment integration.

## Sources

- [SERV Hackathon](https://www.openserv.ai/hackathon): Mainnet & MCP includes payments on Robinhood Chain. SERV Reasoning and organization data collection are required. Submission uses a public X post tagging @openservai and the linked form. Deadline: September 28, 00:00 UTC. Public rules do not expressly resolve testnet-only acceptance or require autonomous signing.
- [Robinhood Chain connection docs](https://docs.robinhood.com/chain/connecting/): mainnet 4663, testnet 46630, ETH gas, rate-limited public RPCs. Provider endpoints are recommended for production.
- [Robinhood crypto transfers](https://robinhood.com/us/en/support/articles/crypto-transfers/): lists USDG transfer support on Robinhood Chain. Brokerage transfer policies must not be conflated with our independent wallet-signing flow.
- [SERV chat completions](https://docs.openserv.ai/serv-reasoning/api/chat-completions): bearer-authenticated endpoint, required system/developer message and function tools. No project API key or authenticated request was tested.
- [Paxos USDG mainnet docs](https://docs.paxos.com/guides/stablecoin/usdg/mainnet): direct fetch returned 403. Issuer provenance of the candidate address remains pending.
- [Azza](https://useazza.com/): conversational-payment inspiration. Its advertised fiat payouts and bills require integrations outside this MVP.

## Live read-only checks

No keys, signatures or transaction broadcasts were used.

| Endpoint/method | Result |
| --- | --- |
| https://rpc.mainnet.chain.robinhood.com / eth_chainId | 0x1237 = 4663 |
| https://rpc.testnet.chain.robinhood.com / eth_chainId | 0xb626 = 46630 |
| Mainnet eth_call to candidate address, decimals selector 0x313ce567 | 6 |
| Mainnet eth_call to candidate address, symbol selector 0x95d89b41 | USDG |

Candidate address from earlier repository research: 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168.
Calls used latest, not a recorded block number. They confirm endpoint responsiveness and reported metadata at the check time. Token symbols can be copied; these observations do not establish issuer authenticity, liquidity, transferability for a particular account or available funding.

## Still unverified

- A funded transfer, actual fees and compatibility of the complete wallet flow.
- Canonical mainnet USDG address from an accessible authoritative source.
- Official testnet USDG address/faucet; plan uses a clearly labelled project demo token.
- SERV account access, selected model tool behavior, credits and data-collection setting.
- Testnet-only hackathon acceptance. The dynamic submission form was not readable through the browser tool in prior research.
- WhatsApp account/setup access. Meta docs returned 429 in earlier research.

## Conclusion

Technical feasibility is supported by live RPC access, token metadata calls and SERV's documented tool interface. End-to-end readiness is not yet established. The first implementation milestone is a user-signed test-token payment with a verified receipt; SERV then prepares validated drafts through the same payment service.
