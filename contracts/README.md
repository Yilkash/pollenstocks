# Steward Pay contracts

`MockPaymentUSD` is a six-decimal test ERC-20 (DUSD). Its faucet grants 1,000 tokens per wallet once per day. Deployment is restricted to Robinhood Chain testnet (46630) and local development (31337).

## Dependencies and compilation

From the repository root, initialize the shared pinned dependencies:

```bash
git submodule update --init --recursive
cd openserv-serv-hackathon/contracts
forge build --skip test
forge fmt --check
```

The contract package uses Solidity 0.8.28 and remappings to `../../lib`. The workspace root also provides a compatible Foundry configuration.

## Deploy to testnet

From this directory, using your own Foundry keystore account with test ETH:

```bash
forge script script/DeployPaymentToken.s.sol:DeployPaymentToken \
  --rpc-url https://rpc.testnet.chain.robinhood.com \
  --account YOUR_TESTNET_KEYSTORE_NAME \
  --broadcast
```

This broadcasts a real testnet deployment. Set the resulting address as DEMO_TOKEN_ADDRESS in the web app's local environment file.

The tokens have no monetary value and are not official USDG. Mainnet deployment is rejected by the constructor. Existing faucet and transfer tests live in `test/MockPaymentUSD.t.sol`; they have not been run during this organization work.
