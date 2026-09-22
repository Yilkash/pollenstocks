# Steward Pay

Wallet-to-wallet test payments on Robinhood Chain, with SERV preparing payment drafts and the user's wallet signing transfers.

## Implemented

- Next.js interface with injected EVM wallet connection and signed session.
- Token/ETH balances, contacts, receive address and QR.
- Manual payment preparation and server-side SERV tool orchestration.
- Five-minute review, preflight simulation, exact decimal arithmetic, atomic signing claim.
- Receipt checks against sender, token, recipient, value, nonce and Transfer event.
- SQLite contacts, payment history and manual transaction-hash recovery.
- Six-decimal Demo USD faucet contract, restricted to chain 46630 or local 31337.

This is an implementation milestone, not a verified live deployment. The production web build passes. No end-to-end transfer or authenticated SERV call has been performed.

## Run the web app

Use Node.js 24 or newer.

```bash
cd openserv-serv-hackathon/apps/web
npm ci
cp .env.example .env.local
npm run dev
```

Open **http://localhost:3000**. APP_ORIGIN must match the exact browser origin (localhost and 127.0.0.1 are different). Connecting requires an injected EVM wallet extension or wallet browser. The app uses viem directly; WalletConnect and smart-contract wallet authentication are not implemented.

Set these values in `.env.local`:

| Variable           | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| APP_ORIGIN         | Browser origin, HTTPS in deployment                            |
| APP_CHAIN_ID       | 46630 for Robinhood Chain testnet; 31337 for local development |
| RPC_URL            | Server RPC for that chain                                      |
| DEMO_TOKEN_ADDRESS | Address of your deployed MockPaymentUSD                        |
| SERV_API_KEY       | Server-only SERV key; never paste it into chat                 |
| SERV_MODEL         | Tool-capable model available to your SERV account              |
| DATABASE_PATH      | Durable SQLite file, default .data/steward.sqlite              |

Without a token address, the interface renders but payments are unavailable. Without a SERV key, manual payments still work once the token is configured. API key presence is not a successful SERV connection check.

## Deploy the test token

From `openserv-serv-hackathon/contracts`, use a Foundry keystore account funded with **test ETH on chain 46630**. Import/configure the keystore using Foundry locally; do not put a private key in frontend configuration.

```bash
forge script script/DeployPaymentToken.s.sol:DeployPaymentToken \
  --rpc-url https://rpc.testnet.chain.robinhood.com \
  --account YOUR_TESTNET_KEYSTORE_NAME \
  --broadcast
```

This command broadcasts a real testnet deployment and spends test ETH. Copy the resulting token address into DEMO_TOKEN_ADDRESS and restart the app. The contract rejects deployment on mainnet. Its claim() faucet gives each wallet 1,000 DUSD once per day; faucet requests also require test ETH.

## First real testnet payment

1. Configure the deployed token and connect wallet A.
2. Claim test tokens; wait for inclusion and refresh the balance.
3. Save wallet B as a personal contact after checking the full address.
4. Prepare a small Demo USD payment through the form.
5. Check the review and approve the exact transfer in wallet A.
6. Refresh the receipt. The app marks it included only after matching the transaction and transfer event.
7. Check the explorer and wallet B's balance.
8. Configure SERV and repeat using “Send 5 Demo USD to Ada”.

These steps remain to be executed. No mainnet USDG integration is enabled.

## Recovery and current limits

- An unresolved signing, submitted or unknown payment blocks another payment from that wallet in this app.
- If broadcasting succeeded but saving the hash failed, reopen the payment in Activity. The browser retains its hash when local storage is available; otherwise copy it from wallet activity.
- Recovery accepts only a matching transaction. Never resend solely because the page reports a timeout.
- Receipt refresh is manual. Automatic replacement/cancellation reconciliation and resolution of a signing attempt with no discoverable hash remain unfinished. Such attempts can currently leave the wallet blocked in the app.
- Included means the matching transfer is in a chain receipt; it is not a claim of final settlement.
- History covers this app's payments only. Contacts are personal aliases, not identity verification.
- Chat text, requested tool results and payment details used by tools may be sent to SERV. Enable the organization data-collection setting required by the hackathon before recording the demo.
- Notes are not included in transfer calldata. Notes used in chat/tool results can be sent to SERV.
- Deploy as a Node server with a persistent writable disk. Ephemeral serverless filesystems are unsuitable for this SQLite setup. Keep the database private and backed up.
- Rate limiting is process-local and assumes a trusted reverse proxy. Public launch needs operational hardening and an application security review.

## Compilation

```bash
npm run build
```

Current build passes, including TypeScript compilation. Automated and live transfer testing remain pending. Testnet-only hackathon eligibility and the authenticated SERV call remain open gates; see [the plan](../../docs/PLAN.md) and [research](../../docs/PAYMENTS_RESEARCH.md).
