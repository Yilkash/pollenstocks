# SERV Hackathon — Edition 01 (OpenServ) — notes, 2026-09-19

> Historical portfolio research. The current direction is wallet-to-wallet payments; see PLAN.md and PAYMENTS_RESEARCH.md (2026-09-22). Claims below are dated research, not current payment requirements.

Status: research only, nothing built.

- Page: https://www.openserv.ai/hackathon#tracks
- **Dates:** Sept 14–28, 2026, online. **Submissions close Sept 28, 00:00 UTC** (i.e. end of Sept 27 UTC). Monthly series; winners announced early October, finalists livestreamed.
- **Prize pool: $5,000** — $1,000 worth of SERV token per track winner (4 tracks) + $1,000 USDC extra for Best Overall ($2,000 total for that build).

## Tracks
1. **Mainnet & MCP (the Robinhood track)** — "Agents that act on Robinhood Chain or operate funds via Robinhood MCP." Trading, payments, onchain automation.
2. **AgentKit** — agents with wallets via Coinbase AgentKit.
3. **RWA Vaults** — agents allocating into licensed RWA yield vaults with IXS Finance.
4. **Open Track** — anything that runs on SERV Reasoning.

## Requirements
- Must use **SERV Reasoning** (OpenServ's reasoning API; OpenAI/Anthropic-SDK-compatible chat completions; private beta at console.openserv.ai; $5 API credit for applicants). Must **enable data collection** in the console.
- "New, working, and demoable by 28 September" — agent, workflow or product.
- Submit: public post on X (name, concept, images, GitHub/demo links, tag @openservai) + form.
- Judging: **creativity, user-readiness, revenue potential.**
- Open to everyone, solo or team, no fee.

## Robinhood MCP
- Robinhood's official MCP server for "Agentic Trading": agents trade equities/options/crypto in a dedicated, budgeted Agentic account of a Robinhood customer. Needs a funded Robinhood brokerage account (likely US customers) — so the *Robinhood Chain* route (on-chain agent) is the one that works without a brokerage account.

## Existing Robinhood Chain MCP servers (checked 2026-09-19) — an MCP alone is NOT novel
- **arambarnett/robinhood-chain-mcp** — MIT, mainnet 4663, **read-only** (4 tools: lookup_entity, entity_connections, related_markets, entity_signals — heat scores, tracking error vs Chainlink). 0 stars, 5 commits. Calls itself the read-plane of an "RHC Agent Schema"; points to Robinhood's official Trading MCP (`agent.robinhood.com/mcp/trading`) for execution.
- **nirholas/robinhood-chain-mcp ("hood-mcp")** — Apache-2.0, mainnet. 9 read tools + opt-in `hood-mcp-trading` (4 tools: swaps/transfers, USD spend cap, two-step confirm). https://nirholas.github.io/robinhood-chain-mcp/
- Others: D-Kek/loot-agent-mcp (game/launchpad), pons Launchpad MCP, aashu91/robinhood-evm-mcp.
- **Gap that remains:** none of these is an autonomous portfolio agent with on-chain enforced limits (vault/guardrails), none targets testnet, none uses SERV Reasoning. Differentiate on the agent + on-chain guardrails, not on "an MCP exists". Could even reuse hood-mcp (Apache-2.0) as the tool layer.

## Uniswap on Robinhood Chain
- Mainnet 4663 has Uniswap v2, v3, v4, UniswapX. v3: Factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`, SwapRouter02 `0xcaf681a66d020601342297493863e78c959e5cb2`, UniversalRouter `0x8876789976decbfcbbbe364623c63652db8c0904`, QuoterV2 `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`, NonfungiblePositionManager `0x73991a25c818bf1f1128deaab1492d45638de0d3`, Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
- **No official Uniswap on testnet 46630.** Another team deployed their own V2 there (factory `0x95891978Cb7b2f68Cf1DA5830255E559F829a828`, router `0x2E6adBE62B09341c39274E64B0b45E2EB61DbfFB`) — unofficial, untrusted. For a testnet demo we'd deploy our own small swap pool or rebalance via basket mint/redeem.

## SERV Reasoning docs — read 2026-09-19 (index: https://docs.openserv.ai/llms.txt)
- **What it is:** a proxy between your app and the model. Each call goes through a structured reasoning step ("bounded graph", BRAID) before the model. Models: GPT, Claude, Gemini, Grok, Qwen, DeepSeek.
- **Base URL:** OpenAI SDK `https://inference-api.openserv.ai/v1`; Anthropic SDK `https://inference-api.openserv.ai` (no `/v1`, pass key as `authToken`). Header `Authorization: Bearer $SERV_API_KEY`.
- **Endpoints:** `/v1/chat/completions` (every model — recommended default), `/v1/responses` (OpenAI models only), `/v1/messages` (no Gemini).
- **A system prompt is mandatory** — requests without one are rejected. `reasoning_effort`: none | low | medium | high (not `minimal`). Docs recommend `low` by default and the smallest model that fits.
- **Tool calling:** standard `tools` array; our functions are forwarded to the model unchanged, we execute them and validate arguments ourselves. Multi-turn tool loops and parallel calls are not documented — test on day 1.
- **SERV marker tools** (go in the same `tools` array, SERV strips them before the model):
  - `serv_prompt_guard` — blocks prompt-injection/extraction before the model runs.
  - `serv_shadow_agent` — a validator judges the output and forces revisions (`max_iterations` default 3, max 10; `hint` string). Non-streaming only; returns 502 if the validator aborts; each iteration adds cost/latency.
  - `serv_disable_content_filter`.
  - Header `x-openserv-disable-braid: true` = raw mode, bypasses SERV reasoning (don't use — the hackathon requires SERV Reasoning).
- Also: structured JSON outputs, streaming, prompt caching, Kronos (audits reasoning prompts), Multipath (branching system prompts), Playground for raw-vs-SERV comparison, usage/billing dashboard.
- **Pricing (per 1M tokens, in/out):** GPT-5.4 Nano $0.25/$1.60, Gemini 3.1 Flash Lite $0.30/$1.80, Claude Haiku 4.5 $1.25/$6.50. $5 credit is plenty for development on a small model.
- **Not found in docs:** how to "enable data collection" (hackathon requirement) — look in console settings; per-model tool support.
- **Separate OpenServ agent platform** exists (TypeScript SDK, no-code workflows, MCP connect, OpenClaw, x402 monetization, ERC-8004 agent identity). The hackathon only requires SERV Reasoning, but x402/ERC-8004 could strengthen the "revenue potential" story later.

## Docs
- https://docs.openserv.ai/docs/serv-reasoning
- https://docs.openserv.ai/serv-reasoning/api/chat-completions
- https://docs.openserv.ai/docs/code/sdk/typescript
- https://robinhood.com/us/en/agentic-trading/
- https://robinhood.com/us/en/newsroom/robinhood-is-now-open-to-agents/

## How it combines with the Arbitrum buildathon
See ../arbitrum-open-house-singapore/NOTES.md. One project — an AI agent that manages stock tokens on Robinhood Chain, with SERV Reasoning as its decision layer — can be entered in both: SERV (due Sept 28 00:00 UTC) as a first milestone, then Arbitrum Open House (due Oct 4) with more polish. Check each event's rules on double submission. Note: Arbitrum allows existing codebases; SERV requires "new".
