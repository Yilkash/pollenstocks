import { assistantReply } from "../src/server/whatsapp/assistant";
import { setTimeout as sleep } from "node:timers/promises";
import { deliveryConfig, seal, unseal, whatsappConfig } from "../src/server/whatsapp/config";
import { processPayment, reviewPayment } from "../src/server/whatsapp/payment-runner";
import { balanceReply } from "../src/server/whatsapp/balance";
import { provisionWallet } from "../src/server/whatsapp/provision-wallet";
import { WhatsAppStore } from "../src/server/whatsapp/store";

async function main() {
  const config = whatsappConfig();
  const delivery = deliveryConfig();
  const store = new WhatsAppStore(config.key);
  let running = true;
  process.on("SIGINT", () => {
    running = false;
  });
  process.on("SIGTERM", () => {
    running = false;
  });
  console.log(
    process.env.WHATSAPP_PAYMENTS_ENABLED === "true"
      ? "WhatsApp worker started (confirmed testnet payments enabled)."
      : "WhatsApp worker started (payment review enabled; sending disabled).",
  );
  try {
    do {
      store.prepare();
      const job = store.claim();
      if (job) {
        try {
          let payload = unseal<{ to: string } & Record<string, unknown>>(job.payload, config.key);
          if (!config.allowed.has(payload.to)) {
            store.finish(job.id, "blocked", null, "sender_removed");
            continue;
          }
          if (
            payload._steward_type === "assistant" &&
            typeof payload.input === "string" &&
            typeof payload.message_id === "string"
          ) {
            payload = {
              to: payload.to,
              ...(await assistantReply(
                store.db,
                config.key,
                payload.to,
                payload.input,
                payload.message_id,
              )),
            };
            store.db
              .prepare("UPDATE wa_outbox SET payload=? WHERE id=? AND state='sending'")
              .run(seal(payload, config.key), job.id);
          }
          if (payload._steward_type === "balance") {
            payload = { to: payload.to, ...(await balanceReply(store.db, config.key, payload.to)) };
            // Persist the resolved reply before delivery so stored output remains reviewable.
            store.db
              .prepare("UPDATE wa_outbox SET payload=? WHERE id=? AND state='sending'")
              .run(seal(payload, config.key), job.id);
          }
          if (
            payload._steward_type === "payment_review" &&
            typeof payload.payment_id === "string"
          ) {
            payload = {
              to: payload.to,
              ...(await reviewPayment(store.db, config.key, payload.to, payload.payment_id)),
            };
            store.db
              .prepare("UPDATE wa_outbox SET payload=? WHERE id=? AND state='sending'")
              .run(seal(payload, config.key), job.id);
          }
          const typing = payload._steward_type === "typing";
          const response = await fetch(
            `https://graph.facebook.com/${delivery.version}/${config.phoneId}/messages`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${delivery.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(
                typing
                  ? {
                      messaging_product: "whatsapp",
                      status: "read",
                      message_id: payload.message_id,
                      typing_indicator: { type: "text" },
                    }
                  : { ...payload, messaging_product: "whatsapp", recipient_type: "individual" },
              ),
              signal: AbortSignal.timeout(typing ? 5_000 : 15_000),
              redirect: "error",
            },
          );
          if (!response.ok) {
            // Retain numeric Meta diagnostics without persisting raw error messages.
            const failure = (await response.json().catch(() => null)) as {
              error?: { code?: unknown };
            } | null;
            const metaCode =
              typeof failure?.error?.code === "number" ? `:meta_${failure.error.code}` : "";
            store.finish(
              job.id,
              response.status >= 500 ? "unknown" : "failed",
              null,
              `http_${response.status}${metaCode}`,
            );
          } else {
            const body = (await response.json()) as {
              success?: boolean;
              messages?: { id?: string }[];
            };
            const id = body.messages?.[0]?.id;
            store.finish(
              job.id,
              id || (typing && body.success === true) ? "accepted" : "unknown",
              id || null,
              id || (typing && body.success === true) ? null : "missing_message_id",
            );
          }
        } catch {
          // A timeout can follow successful delivery. Do not automatically send a second message.
          store.finish(job.id, "unknown", null, "delivery_uncertain");
        }
      }
      await provisionWallet(store.db, config.allowed, config.key);
      await processPayment(store.db, config.key, config.allowed);
      if (process.argv.includes("--once")) break;
      await sleep(job ? 100 : 1000);
    } while (running);
  } finally {
    store.close();
  }
}
main().catch(() => {
  console.error(
    "WhatsApp worker stopped. Check configuration and database access; no secrets logged.",
  );
  process.exitCode = 1;
});
