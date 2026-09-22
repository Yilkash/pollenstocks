# Steward Pay

An AI-assisted wallet-to-wallet payment app for Robinhood Chain. SERV prepares payment drafts; the user reviews and signs each transfer in their own wallet.

**Status:** Initial implementation. Web and contract compilation pass after reorganization; see the [changelog](CHANGELOG.md) for the build checkpoint. The test token is deployed and its runtime code verified; live wallet-to-wallet transfers and an authenticated SERV call remain pending. Demo USD is a test token with no monetary value.

## Project layout

```text
openserv-serv-hackathon/
├── apps/web/          # Next.js interface, API and SQLite persistence
├── contracts/        # Faucet token, deployment script and existing tests
├── docs/             # Plan, research and architecture
│   └── archive/      # Superseded portfolio proposal
├── .editorconfig
├── CHANGELOG.md
├── CONTRIBUTING.md
└── README.md
```

Foundry dependencies are shared in the workspace's `../lib/` directory.

## Run locally

Requires Node.js 24+, npm, Foundry, an injected EVM wallet, and test ETH for onchain actions.

```bash
cd openserv-serv-hackathon/apps/web
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Configure the demo token address and SERV key in the local environment file. See the [web setup guide](apps/web/README.md) for deployment and recovery instructions.

## Build and format

From the web directory:

```bash
npm run build
npm run format:check
```

From the contracts directory:

```bash
forge build --skip test
forge fmt --check
```

Compilation does not verify wallet behavior, SERV integration or live transfers.

## Documentation

- [Implementation plan](docs/PLAN.md)
- [Payments research and unresolved gates](docs/PAYMENTS_RESEARCH.md)
- [Architecture and payment lifecycle](docs/ARCHITECTURE.md)
- [Contribution and commit conventions](CONTRIBUTING.md)
- [Historical hackathon notes](docs/NOTES.md)
