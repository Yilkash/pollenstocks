# WhatsApp transport setup

Status: the user confirmed the live welcome menu after correcting the tester number, subscribing Steward Pay to the WABA and refreshing the Meta access token. Consent-backed test-account onboarding is now implemented; see [wallet onboarding](WALLET_ONBOARDING.md). Provider wallet creation, recipient lookup, SERV chat and payment execution are not connected yet. New installations default to messaging disabled.

## What is implemented

- `GET /api/whatsapp/webhook`: Meta verification challenge.
- `POST /api/whatsapp/webhook`: bounded raw-body HMAC verification, expected WABA/phone ID checks, tester allowlist, timestamp checks and durable inbox acceptance.
- Separate SQLite inbox/outbox at `.data/whatsapp.sqlite`, with AES-256-GCM encrypted message/phone payloads and keyed sender lookup. The encryption key must remain stable; losing it makes queued messages unreadable. Changing it requires an explicit migration.
- Deduplication by inbound message ID, per-sender intake limit of 20 messages/minute, transactional reply preparation and atomic delivery claims.
- Interactive menu: Create account, View balance, Send payment, Receive payment, Recent activity, Manage contacts, Ask Steward, Help & settings. Users can type the menu label or its number (1–8). Unknown text returns the menu; free-form SERV routing is not connected yet.
- Create account now offers an explicit, expiring custody/testnet consent. Accepting records one test account with wallet setup pending; it does not create a provider wallet. Wallet actions report the pending state.

## Private configuration

Use the WhatsApp section in `apps/web/.env.example` as the template for your ignored `.env.local`. Do not replace existing SERV or web settings.

From `apps/web`, run `npm run whatsapp:setup -- --init` to add missing fields and generate the private verification token and encryption key. Existing nonempty values are preserved. This leaves a new configuration disabled, prints no secrets and sends no messages. Run it after saving/closing edits to the env file. It refuses to generate a new encryption key if a WhatsApp database already exists without its key.

Then fill in your Meta credentials and tester sender IDs locally. `npm run whatsapp:setup` reports only missing/present/invalid status; it does not authenticate credentials or send requests. Set `WHATSAPP_ENABLED=true` only when ready.

Set:

- `WHATSAPP_ENABLED=true` only when ready to receive events.
- `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_WABA_ID` from the Meta test-number panel.
- `WHATSAPP_APP_SECRET` from the Meta app's private settings.
- `WHATSAPP_VERIFY_TOKEN`: a separately generated random value, also entered into Meta's webhook configuration.
- `WHATSAPP_ACCESS_TOKEN`: the private messaging access token. Renew temporary credentials as required by the account.
- `WHATSAPP_DATA_KEY`: 32 cryptographically random bytes encoded as 64 hex characters. Store privately with backups; never commit it.
- `WHATSAPP_ALLOWED_SENDERS`: comma-separated tester sender IDs, international digits without `+` or spaces. Testers must also be permitted in Meta's test-number setup.
- `WHATSAPP_GRAPH_VERSION`: currently configured as `v25.0`, matching the user's Meta sample. Verify availability for the account before live use.
- `WHATSAPP_DATABASE_PATH`: persistent path shared by the web process and worker.

No secret values are needed in chat. No local secrets have been generated or changed by this implementation.

## Start and connect

1. Restart the web app after private configuration changes.
2. Make the app reachable over an HTTPS endpoint. Local development may use an explicitly configured tunnel; hosting and tunnel creation are not performed by these changes.
3. In Meta's webhook configuration, enter `https://YOUR_HOST/api/whatsapp/webhook` and your verify token. Subscribe to the WhatsApp `messages` field. Also ensure Steward Pay itself is subscribed to the WABA through `POST /{WABA_ID}/subscribed_apps`; the Meta testing app subscription alone was insufficient in our setup.
4. From `apps/web`, run `npm run whatsapp:worker`. This loads `.env.local` and starts delivery of queued replies to configured testers. **Starting the worker sends messages**; start it only when ready for the live test.
5. Send Hi from an allowed tester, open the menu, select Help & settings, then type Menu.

This worker currently requires the development dependency `tsx`. The existing production Docker image does not install it. Production worker packaging and supervision remain follow-up work; do not assume the older Compose file starts this worker.

## Delivery and recovery semantics

The webhook acknowledges only after persistence. Reply preparation and marking the inbox processed are one SQLite transaction. Meta acceptance is recorded as `accepted`, not delivered. Status webhooks are currently acknowledged but not used to track delivery/read status.

The worker expires replies 23 hours after the triggering message as a conservative session guard; no template sender is implemented. Messages older than that are ignored at intake. A delivery timeout, interrupted job or HTTP 5xx leaves `unknown`; a definitive non-success below 500 leaves `failed`. No automatic re-send occurs. A worker crash after Meta accepted a reply may leave an uncertain result. The tester can send a new Menu message; operator retry/status reconciliation is not implemented yet.

Do not clear unknown records and claim exactly-once delivery. Queue deduplication does not establish provider-level delivery idempotency. These jobs never authorize or execute payments.

Retain the database and key together in private backups. Automated retention/deletion and key rotation tooling remain to be implemented before broader use. No message bodies, tokens or phone numbers are printed by the worker.

## Next engineering steps

1. With authorization, exercise forged signatures, replayed events, menu choices, rate limits, expiry, process restarts and uncertain delivery locally; then run the two-way live Meta check.
2. Package the worker for production and implement message-status reconciliation.
3. Prove managed-wallet creation and a small DUSD transfer on chain 46630 with restricted provider credentials. No provider SDK is installed or provider selected yet.
4. Add consent-backed account creation and the three recipient resolvers from `WHATSAPP_CUSTODIAL_PLAN.md`.
5. Wire SERV through verified actor context, then immutable payment reviews and one-use confirmations before enabling the signer.

## References

The menu payload follows [Meta's interactive-message examples](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/interactive/). That SDK is archived; this implementation calls Graph directly, and the live API still needs verification. See also [Meta's Cloud API message collection](https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages).

[Privy's server wallet documentation](https://docs.privy.io/wallets/gas-and-asset-management/gas/ethereum) describes wallet creation and a viem adapter, but does not establish Robinhood testnet support, policy coverage or successful execution for this project. The compatibility gate remains open.
