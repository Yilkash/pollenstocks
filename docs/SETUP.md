# Setup

## Services you need

| Service                 | What for                                                     |
| ----------------------- | ------------------------------------------------------------ |
| SERV (OpenServ)         | Intent understanding and the prompt guard                    |
| Privy                   | Server wallets and the wallet policy                         |
| Meta WhatsApp Cloud API | A WhatsApp Business number, app secret and system-user token |
| Railway (or any Docker) | Hosting with a persistent volume at `/app/.data`             |

The ArcStocks desk and the backing are read on-chain, and Robinhood's price API is public: none needs a key.

## Environment variables

Copy `apps/web/.env.example` to `.env.local` for local runs, or set these on the host.

| Variable                                                   | Value                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `APP_ORIGIN`                                               | Public URL of the deployment                                      |
| `SERV_API_KEY`                                             | SERV key                                                          |
| `WHATSAPP_ENABLED`                                         | `true`                                                            |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`             | From WhatsApp Manager                                             |
| `WHATSAPP_APP_SECRET`                                      | The Meta app secret, for webhook signatures                       |
| `WHATSAPP_VERIFY_TOKEN`                                    | Any random string; the same value goes in Meta's webhook settings |
| `WHATSAPP_ACCESS_TOKEN`                                    | The system-user token                                             |
| `WHATSAPP_DATA_KEY`                                        | 64 hex characters (`openssl rand -hex 32`); never change it later |
| `WHATSAPP_ACCESS_MODE`                                     | `allowlist` while testing, `public` for launch                    |
| `STEWARD_WORKER_ENABLED`                                   | `true` to run the WhatsApp worker                                 |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET`                         | From the Privy dashboard                                          |
| `PRIVY_WALLET_OWNER_ID`, `PRIVY_AUTHORIZATION_PRIVATE_KEY` | The authorization key that owns and signs user wallets            |
| `PRIVY_WALLET_CREATION_ENABLED`                            | `false` (legacy testnet wallets only)                             |
| `MAINNET_STOCK_TRADING_ENABLED`                            | `true` once the policy is created and verified                    |
| `PRIVY_MAINNET_POLICY_ID`                                  | Printed by `scripts/mainnet-policy-create.ts`                     |
| `MAINNET_MAX_USDC_PER_TRADE`                               | For example `50` (maximum `500`, the desk's limit)                |

## First deployment

1. **Deploy** the Docker image from `apps/web` with a volume at `/app/.data`.
2. **Create the wallet policy**, then set `PRIVY_MAINNET_POLICY_ID` and redeploy:
   ```bash
   railway run npx tsx scripts/mainnet-policy-create.ts
   ```
   Changing the rules later (new stocks or a new cap) updates the same policy in place:
   ```bash
   railway run npx tsx scripts/mainnet-policy-update.ts          # dry run
   railway run npx tsx scripts/mainnet-policy-update.ts --apply
   ```
3. **Verify** the pins and the policy:
   ```bash
   railway run npx tsx scripts/mainnet-verify-setup.ts
   ```
4. **Connect WhatsApp:** webhook URL `https://<your-host>/api/whatsapp/webhook`, subscribe the `messages` field, subscribe the app to your WABA and publish the app.
5. **Fund a test wallet** with a few **USDC on Arc** (chain 5042). No other coin is needed: USDC also pays the network fee.
6. **Test trade:** `Buy NVIDIA with 1 USDC`, check Details, confirm, and open the explorer link.
