# Hosting Steward Pay

The deployment package uses one Node.js 24 app container, a persistent SQLite volume, and Caddy for HTTPS. No hosted service has been created or published.

## Required inputs

- A Linux server with Docker and Compose.
- A domain whose A/AAAA records point to that server.
- Ports 80 and 443 available for HTTPS and certificate issuance.
- A SERV key configured privately on the server.
- A testnet RPC endpoint appropriate for the expected traffic.

Use a single app replica while using this SQLite configuration. The proxy overwrites the forwarded-client-IP header used by the process-local rate limiter. The app is reachable only inside the Compose network.

## Start after server and domain are selected

From the project folder:

```bash
cp deploy/.env.example deploy/.env.hosting
```

Edit deploy/.env.hosting locally on the server. Set STEWARD_DOMAIN, ACME_EMAIL, SERV_API_KEY and RPC_URL. Keep the existing deployed Demo USD address unless intentionally using another verified token.

```bash
docker compose --env-file deploy/.env.hosting -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env.hosting -f deploy/compose.yaml up -d --build
```

These commands publish the app when run on the server. They have not been run against public infrastructure.

APP_ORIGIN is set to the exact HTTPS domain. Do not use a different alias for the demo: wallet sign-in cookies and mutation-origin checks are bound to it.

## Storage and backups

The named steward_data volume contains sessions, contacts, payment drafts, chat history and transaction hashes. Keep it across updates. Do not use `docker compose down -v` on the deployed app.

For a simple consistent backup, stop the app service, copy the entire volume directory (including any SQLite WAL/SHM files) to private backup storage, then restart the app. Restore backups only while the app is stopped. Treat these files as private user data.

The image runs as the Node user and excludes local environment files, databases and wallet credentials from its build context. Secrets are runtime environment settings; rebuilding requires no SERV key.

## Launch checks

1. Load the HTTPS domain and confirm testnet and Demo USD labels.
2. Connect the demo wallet and request its balance.
3. Save the recipient as a contact; local-preview contacts are not automatically migrated.
4. Prepare one small test payment, approve it in the wallet and verify its receipt.
5. Reload, reconnect without needless signatures, and check the saved history.
6. Restart the app container and confirm data remains.
7. Check that the SERV organization's required data-collection setting is enabled.

The user signs any live demo transactions. No private key belongs on the web server.

## Recovery behavior

Open a pending payment and paste the payment, speed-up or cancellation hash from wallet activity. Recovery checks the sender, nonce, network and receipt. A same-nonce transaction with different calldata is recorded as replaced, not paid. A successful zero-value self-transfer with empty calldata is recorded as cancelled.

Changed replacements must be in a canonical block before the pending slot is released. A matching token transfer still requires the expected Transfer event. Old hashes remain in the payment record.

No automatic nonce scan or wallet cancellation button is provided. If no hash is available and the wallet outcome is uncertain, the app keeps the payment blocked. Chain inclusion is not final settlement; refresh rechecks receipt evidence.
