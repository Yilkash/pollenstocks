import { setTimeout as sleep } from "node:timers/promises";
import { deliveryConfig, unseal, whatsappConfig } from "../src/server/whatsapp/config";
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
  console.log("WhatsApp transport worker started (wallet execution unavailable).");
  try {
    do {
      store.prepare();
      const job = store.claim();
      if (job) {
        try {
          const payload = unseal<{ to: string } & Record<string, unknown>>(job.payload, config.key);
          if (!config.allowed.has(payload.to)) {
            store.finish(job.id, "blocked", null, "sender_removed");
            continue;
          }
          const response = await fetch(
            `https://graph.facebook.com/${delivery.version}/${config.phoneId}/messages`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${delivery.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                ...payload,
                messaging_product: "whatsapp",
                recipient_type: "individual",
              }),
              signal: AbortSignal.timeout(15_000),
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
            const body = (await response.json()) as { messages?: { id?: string }[] };
            const id = body.messages?.[0]?.id;
            store.finish(
              job.id,
              id ? "accepted" : "unknown",
              id || null,
              id ? null : "missing_message_id",
            );
          }
        } catch {
          // A timeout can follow successful delivery. Do not automatically send a second message.
          store.finish(job.id, "unknown", null, "delivery_uncertain");
        }
      }
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
