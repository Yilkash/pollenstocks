# Steward stock-token integration plan

Status: user supplied official-faucet wallet evidence for four stock addresses.
USDG issuer address is confirmed by Paxos documentation. Exchange executable code
matches a local compilation; integration safeguards remain outstanding. Buying is disabled.
Network: Robinhood Chain testnet, chain ID 46630.

## Findings

Robinhood documents stock tokens as ERC-20 assets and describes secondary-market
trading through RFQ and AMM integrations. Its testnet announcement includes test-only
stock tokens. These facts do not establish a market for Steward's custom Demo USD.

The current canonical-contract documentation covers Robinhood Chain generally and
loads stock addresses dynamically. Search results contain different testnet addresses
with the same ticker. A ticker match is not sufficient evidence of asset identity.
The official faucet was blocked to the research browser (HTTP 403). Canonical testnet issuer provenance remains unconfirmed. A candidate trading venue
has onchain liquidity, but its deployed source is unverified (details below).

Sources inspected:
- https://docs.robinhood.com/chain/stock-tokens/
- https://docs.robinhood.com/chain/building-with-stock-tokens/
- https://docs.robinhood.com/chain/contracts/
- https://robinhood.com/us/en/newsroom/robinhood-chain-launches-public-testnet/

## Product scope

Start with one asset and these conversation intents:
- What stocks can I trade? -> verified configured asset list.
- Show my stock portfolio. -> actual token balances, with no invented valuation.
- Buy 5 Demo USD worth of [asset]. -> executable quote or explicit unavailable reply.
- Sell 0.01 [asset]. -> executable quote or explicit unavailable reply.
- Did my stock purchase go through? -> durable order state and explorer receipt.

The user must confirm a quote with side, exact token contracts/network, input amount,
minimum output, fees, expiry and pricing source. A chat acknowledgement never submits.
AI chooses tools and extracts fields; bigint calculations and transaction validation
stay in code. Stock orders use a separate state machine from payment intents.

## Market decision

A. Existing testnet stock tokens
- Obtain canonical addresses from an official source and verify chain, code and metadata.
- Verify an actual executable route, quote API/contract and liquidity on chain 46630.
- If the route uses another quote token, show that asset explicitly; Demo USD is not USDG.
- Verify price feeds separately; do not reuse mainnet addresses on testnet.

B. Explicit simulated market
- Use a separately named demo stock token (e.g. Demo Tesla / dTSLA).
- Clearly state it is not a Robinhood-issued token and conveys no stock ownership.
- Deploy a testnet-only market accepting Demo USD, funded with demo-token inventory.
- Publish a fixed simulation price; never describe it as Tesla's current market price.
- Buying/selling moves actual test tokens onchain, but the market economics are simulated.
- Round buys and sells conservatively in integer units; reject zero output and insufficient
  reserves; bound deadlines; bind quote to price version; pause on operational failure.

## Implementation sequence

1. Select market approach and verify assets/route, or implement reviewable demo contracts.
2. Add allowlisted asset registry: chain, address, symbol, decimals, provenance, market type.
3. Add read-only asset discovery and portfolio tools; unavailable data is never zero-filled.
4. Implement quote adapter with liquidity, deadline, minimum-output and balance checks.
5. Add durable stock orders with account-bound, single-use confirmation tokens.
6. Integrate exact approvals and trading calls through Privy; freeze and validate target,
   calldata, token amounts, owner, policy and network before signing.
7. Recover ambiguous submissions by lookup; never blindly retry an order or approval.
8. Confirm receipts and actual asset flows before reporting purchase/sale success.
9. Show truthful stock capabilities only when that market is configured and operational.

## Deployment and policy boundary

Current payment policies permit Demo USD transfers only. Trading needs separately
reviewed permissions for exact approval spenders, input limits and market methods.
Do not disable the existing transfer policy or introduce unrestricted signing.

No deployment, funding, trade, allowance, or Privy policy change has been made.
Prepare the contract/route and exact policy changes before asking for deployment
approval. Real-money trading is outside this testnet implementation scope.

## Verification still required

Contract compilation and application typechecking during implementation. Automated
contract/worker tests require a separate user request under the workspace instructions.
Before any live demo, verify quotes, confirmation expiry, duplicate handling, failed
transactions, reserve exhaustion and buy/sell receipts with test assets.

## Selected path and route investigation

The user selected Robinhood-issued testnet tokens, not newly created simulation tokens.
No simulated stock token will be substituted.

Read-only inspection on chain 46630 found:

| Candidate | Address | Onchain metadata |
| --- | --- | --- |
| TSLA | `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E` | Tesla / TSLA / 18 decimals |
| USDG | `0x7E955252E15c84f5768B83c41a71F9eba181802F` | Global Dollar / USDG / 6 decimals |
| HoodSwap | `0x9b7f76c75cBAEd5801766cfA99DE15D198773dfe` | Nonempty deployed code; usdg() matches candidate USDG |

Source of candidate addresses: https://github.com/tradeperpex/hoodswap
This third-party project is not proof of Robinhood issuance. All three remain
candidates, not a trusted application allowlist.

At block 122933984, getPool(TSLA) reported 853.516418999773352728 TSLA and
20.748931 USDG. getAmountOut(TSLA, USDG, 1000000) returned
39.131728586040948657 TSLA. This is a historical testnet pool quote, not Tesla's
stock price, investment value, or a guaranteed executable order. Reserves change.

The repository's published contract uses a constant-product quote and a 0.3% fee.
Its swap signature has minimum output but no onchain deadline. The source ignores
ERC-20 transfer return values and has no explicit reentrancy guard. Before using it,
verify deployed bytecode/source correspondence, actual backing token balances,
proxy implementations and token behavior, then decide whether a narrow adapter is
necessary. Do not assume source matches bytecode merely because the address is in
its README.

Next evidence needed: official faucet token/explorer link (user asked to provide it
because automated faucet requests return 403), plus verified exchange implementation.
No faucet request, allowance, policy edit, trade or deployment has been performed.

## Verification results (2026-09-22)

Read-only RPC snapshot at block 122935241:
- Each of the five candidate stock balances held by HoodSwap equals its reported
  stock reserve.
- Actual USDG balance: 112.436192 USDG, equal to the sum of the five known pool
  USDG reserves. This comparison does not establish an exhaustive pool registry.
- The TSLA quote for 1 USDG matches the published constant-product formula exactly:
  39.131728586040948657 TSLA. No swap simulation or transaction was performed.

Explorer API inspection:
- TSLA is a verified BeaconProxy. Its listed Stock implementation is
  `0xBd14156E05c6AF28ad39aA53a2AB8eB9CDf657DA`, with verified source.
  The ABI exposes mint, adminBurn, pause and multiplier operations.
- USDG is an ERC1967 proxy whose own explorer verification flag is false.
  Its listed implementation `0xF0863D7A29a55d0c4263c11bFac754312ff078DF`
  has verified source, including administrative and upgrade operations.
- HoodSwap has no verified source/ABI in the explorer. Published repository source
  has not been matched to deployed bytecode.
- Verified implementation source is not proof of issuer identity, administrator
  ownership, or safe execution. Those conclusions remain unestablished.

Decision: buying remains disabled. Required evidence is an official testnet token
address mapping and verification/review of the deployed trading implementation.
Existing Demo USD cannot be assumed interchangeable with this pool's USDG.

Explorer endpoints used: `/api/v2/smart-contracts/{address}` and
`/api/v2/addresses/{address}` on https://explorer.testnet.chain.robinhood.com.

## Follow-up verification after faucet evidence

The user supplied full AMD, TSLA, NFLX and AMZN addresses and MetaMask screenshots
showing Robinhood Chain Testnet, 18 decimals, and five tokens each, following the
original official-faucet import screenshot. All four full addresses exactly match
our candidates. This is user-provided faucet provenance evidence; it is not an
independent retrieval of an official stock-address registry. PLTR was not included
in the user's full-address follow-up.

Paxos independently confirms USDG testnet address
`0x7E955252E15c84f5768B83c41a71F9eba181802F` at:
https://docs.paxos.com/guides/stablecoin/usdg/testnet
Its funding documentation points to https://faucet.paxos.com/ for test assets:
https://docs.paxos.com/guides/developer/fund-sandbox-with-test-crypto
The faucet returned HTTP 403 to the research browser; current claim availability
and amounts were not verified and no claim was submitted.

### Local exchange compilation comparison

Compiled public `contracts/src/HoodSwap.sol` with solc-js
`0.8.35+commit.47b9dedd`, optimizer disabled, runs 200. Compared against the
explorer's saved deployed runtime for exchange
`0x9b7f76c75cBAEd5801766cfA99DE15D198773dfe`.
Substituted the configured USDG address at all eight compiler-reported immutable
positions. After removing the trailing Solidity CBOR metadata from both bytecodes,
the executable runtime matches exactly for Shanghai, Cancun and Prague targets.
Runtime size is 6372 bytes including metadata. The full runtime does NOT match:
metadata hashes differ. This is a local executable-code match, not full explorer
verification or a security audit. Artifacts are saved under
`/tmp/steward-hoodswap-verify` and `/tmp/steward-hoodswap-bytecode-match.json`.

The initial native compiler download failed checksum verification and was not used.
The comparison used the npm-installed solc-js compiler in the temporary directory.

### Remaining integration work

- Published-source deadline and token-transfer-return limitations now apply to the
  locally matched executable. Evaluate a reviewed adapter with deadline enforcement,
  exact input approval, minimum output and actual received-balance checks.
- Fresh quotes and per-order balance/slippage checks remain required; pool prices
  are testnet-only and do not represent live equity prices.
- Fund the intended Steward wallet with test USDG only after the user selects the
  destination; the user's MetaMask and Steward managed wallet are separate accounts.
- Prepare narrow Privy approval/swap permissions and confirmation/recovery flows.
- No trade execution, allowance, policy change, funding, or deployment occurred.

## Read-only application foundation implemented

- `apps/web/src/server/stocks/market.ts`: four-asset allowlist, same-block balances,
  chain/freshness/decimals checks, pinned exchange runtime hash, pool-backing and
  constant-product arithmetic checks. No signing or allowance functionality.
- WhatsApp AI tools: `list_test_stocks`, `get_stock_portfolio`, `quote_stock`.
  Missing quote fields use the existing encrypted ten-minute task store. Buys
  require explicit USDG input; sells require explicit stock-token quantity.
  A quote never creates a payment, approval, trade confirmation or stock order.
- Portfolio responses distinguish Steward from the user's external MetaMask wallet.
  Quotes identify the pool/block, fee and excluded gas; they do not assert affordability.
- TypeScript compilation passed. Automated tests and live WhatsApp verification
  were not run for this implementation. The running worker was not restarted.

Remaining: reviewed deadline-enforcing adapter, durable account-bound stock order
state, explicit confirmation, exact approvals and Privy policy, submission recovery,
and receipt verification. Trading stays disabled until those are implemented.

## Adapter and review preparation (2026-09-23)

Implemented `contracts/src/StewardStockAdapter.sol` and a prepared deployment script.
The adapter is restricted to chain 46630 and the four faucet-supported stocks. It:
- pins the reviewed exchange runtime hash and USDG address;
- rejects zero/reused order IDs, zero amounts and inputs above 1,000 tokens;
- requires a positive minimum output and a deadline at most five minutes away;
- uses reentrancy protection, SafeERC20 and exact input/output balance accounting;
- returns output only to the caller and resets its exchange allowance after each swap.
It has no administrator, arbitrary recipient or mainnet configuration. Token proxy
upgrades and exchange behavior remain external dependencies. This is not audited.
The caller's approval to the adapter is a separate transaction; if a later trade
fails or expires, that approval may remain and needs explicit recovery/revocation.

`apps/web/src/server/stocks/trade-plan.ts` builds unsigned, testnet-only plans with
exact allowance reset/approval steps, a wallet-bound order identifier, 1% proposed
slippage and a deadline within four minutes of the quote. That tolerance and all
transaction fee caps must be shown in the eventual review before consent. The
planner does not establish adapter deployment, available funds, gas sufficiency,
current allowance, signing permission or user consent.

Quote responses now persist an encrypted snapshot per account/message, allowing
retries to reuse the same preview for 60 seconds. Expired previews require a new
request; snapshots are purged one day after expiry. These are informational
records, not approved orders. No chain result is passed into the AI context.

Validation: `forge build --skip test` compiled adapter and deployment script with
Solidity 0.8.28. `npm run typecheck` passed. No automated or live transaction tests
were run. No deployment, policy change, wallet funding, signing, or worker restart
was performed.

Still needed before execution: deployed adapter identity checks, account-bound
confirmation records and UI, fee/balance/allowance preflight, a shared wallet
transaction lock with payments, approval/trade submission and reconciliation,
allowance cleanup, receipt checks, reviewed Privy permissions and explicit stock
trading disclosure. The existing account disclosure covers Demo USD payments;
stock execution must not silently expand that consent. The AI tools stay read-only.

## Durable reviews and receipt verification

Added `stocks/orders.ts`:
- encrypted immutable review payloads bound to the account, wallet/provider identity
  and originating message; one active stock review/order per account;
- exact decoded calldata checks against displayed token, amount, spender, order ID,
  minimum output and deadline;
- fee ceilings for every approval/trade step, proposed 1% slippage, and explicit
  test-stock disclosure with separate single-use confirmation buttons;
- deterministic stock-button routing before AI interpretation, expiry and cancel
  handling, confirmation consumption, and preallocated provider reference/idempotency
  identifiers for each transaction step.

`STOCK_EXECUTION_READY` remains a hard-coded false gate. Neither review creation
nor confirmation can queue a trade while the signing runner is incomplete. The
review creator is deliberately not exposed as an AI tool yet. These changes do not
make trading live or record user approval of an informational quote.

Added `stocks/receipts.ts`: pure transaction/receipt validation for expected sender,
chain, target, calldata, nonce, canonical block hash and an additional block; approval
log checks; adapter order event and exact input/output transfer checks. A successful
receipt alone is insufficient to report a successful trade. The execution runner
must fetch these inputs independently from the verified RPC and retain gas costs
on reverted transactions. No live receipt verification was performed this turn.

TypeScript compilation passed after these additions. Automated tests were not run.
Still outstanding: adapter deployment verification, preflight and signing runner,
shared payment/stock wallet locking, ambiguous submission reconciliation, approval
cleanup, Privy permissions, AI order-tool wiring and end-to-end verification. The
running worker was not restarted and no chain/account policy changes were made.

## Mainnet preparation

The user subsequently authorized mainnet preparation. See `MAINNET_READINESS.md`
for verified contracts, read-only integrations now loaded by the worker, and
specific missing configuration/funding. Testnet HoodSwap execution is not a
mainnet route. Mainnet and testnet signing remain separate from the new reads.
