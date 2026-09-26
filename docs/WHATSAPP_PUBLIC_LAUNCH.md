# Steward WhatsApp reviewer launch

## Prepared on 2026-09-24

Steward supports two explicit admission modes through `WHATSAPP_ACCESS_MODE`:

- `allowlist` (the default): only `WHATSAPP_ALLOWED_SENDERS` can use the bot.
- `public`: any valid sender delivered by Meta can enter the existing onboarding flow.
  `WHATSAPP_ALLOWED_SENDERS` becomes optional; leaving the old list in place does not restrict public mode.
- Any other mode causes startup/configuration to fail rather than accidentally opening access.

The policy applies to the webhook, outgoing replies, typing indicators, wallet provisioning,
and both transaction runners. Public access does not skip the signed Meta webhook,
WABA/phone ID checks, account consent, active-account checks, per-account wallet ownership,
per-sender message limits, AI limits, quote review or confirmation requirements.
No reviewer receives the operator wallet or its funds. New wallets start unfunded.
Production WhatsApp access still depends on Meta; setting this variable does not remove test-number restrictions.

## Dedicated number tomorrow

1. Obtain a number under your control that can receive SMS or voice verification.
   For this direct Cloud API registration, leave a fresh number unregistered in the mobile WhatsApp apps.
2. In the existing Meta app, complete production number setup, verify ownership and finish
   Cloud API registration (including the required two-step verification PIN).
   Address any publication, verification or account restrictions Meta displays; a test-number
   success does not establish production eligibility.
3. Assign the production WhatsApp Business Account to the existing system user.
   Confirm the system-user token can access this new account and phone number.
4. In Railway update `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_WABA_ID` to the production IDs.
   Update `WHATSAPP_ACCESS_TOKEN` if a new token is required. Do not post tokens or verification codes in chat.
5. Keep the callback `https://stewardopenserve.up.railway.app/api/whatsapp/webhook` and its existing
   verify token. Ensure the production WABA is subscribed to this app and the messages field is subscribed.
6. Keep access mode `allowlist` for the first production-number check from the operator phone.
   Confirm inbound messages and replies use the production number.
7. Set `WHATSAPP_ACCESS_MODE=public` in Railway and apply the deployment.
   Keep a single service replica and the local worker stopped.
8. Use a reviewer phone that is not on the old allowlist to check onboarding and isolated wallet ownership.
   This is still pending; no public-number end-to-end check was performed during preparation.
9. Share `https://wa.me/COUNTRYCODEANDNUMBER?text=Hi` (digits only, no +, spaces or punctuation).
   Create the final QR code only after the verified production number is known.

## Preserve the deployed data

Keep these existing values while changing the WhatsApp business number:

- `DATABASE_PATH=/app/.data/steward-migrated.sqlite`
- `WHATSAPP_DATABASE_PATH=/app/.data/whatsapp-migrated.sqlite`
- The exact existing `WHATSAPP_DATA_KEY`, Privy app/owner/policy identities and persistent volume.
- `STEWARD_WORKER_ENABLED=true` for the hosted worker.
- Existing mainnet execution configuration and review/confirmation rules.

The hosting environment is the current database of record. Do not upload the stale local database again.
Backups include sensitive data and must remain private. Railway automatic backup scheduling should
be confirmed in the volume Backups UI; this preparation does not claim it is enabled.

## Rollback admission

Set `WHATSAPP_ACCESS_MODE=allowlist` with the operator sender IDs retained and redeploy.
This restricts admission and worker eligibility without deleting reviewer accounts or wallets.
Review any pending/uncertain transaction records before changing execution or restarting a stopped worker.

## Scope of verification

Preparation deployed to Railway as deployment `2c04e9bf-630b-4cf5-b727-f472d6321c4e`.
The Docker/Next.js production build completed and startup logs confirmed Next.js ready,
worker running with allowlist access, and the existing mainnet execution setting enabled.
No test suite or live payment was run as part of preparation. Public-number onboarding remains
unverified until the dedicated number is registered. Successful startup is not evidence that
Meta has approved the new production number.
