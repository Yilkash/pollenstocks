import { mainnetAction } from "../src/server/whatsapp/mainnet-payments";
import { processMainnetTrade } from "../src/server/stocks/mainnet-runner";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { setDefaultResultOrder } from "node:dns";
import { assistantReply, purgeAssistantMemory } from "../src/server/whatsapp/assistant";
import { setTimeout as sleep } from "node:timers/promises";
import {
  deliveryConfig,
  seal,
  unseal,
  whatsappConfig,
  senderLookup,
  senderAllowed,
  senderKeyAccess,
} from "../src/server/whatsapp/config";
import { processPayment, reviewPayment } from "../src/server/whatsapp/payment-runner";
import { balanceReply } from "../src/server/whatsapp/balance";
import { provisionWallet } from "../src/server/whatsapp/provision-wallet";
import { WhatsAppStore } from "../src/server/whatsapp/store";

// Best-effort feedback for slow replies. It never blocks the actual response.
function typingWhileWaiting(url: string, token: string, messageId: string) {
  let stopped = false;
  let pending: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const pulse = async () => {
    if (stopped) return;
    pending = new AbortController();
    let shown = false;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" },
        }),
        signal: AbortSignal.any([pending.signal, AbortSignal.timeout(3000)]),
        redirect: "error",
      });
      shown = response.ok;
      await response.body?.cancel();
    } catch {
      // Feedback failure must not prevent the balance, menu or payment review reply.
    } finally {
      pending = undefined;
      if (!stopped)
        timer = setTimeout(
          () => {
            void pulse();
          },
          shown ? 18000 : 3000,
        );
    }
  };
  timer = setTimeout(() => {
    void pulse();
  }, 500);
  return () => {
    stopped = true;
    clearTimeout(timer);
    pending?.abort();
  };
}

async function main() {
  setDefaultResultOrder("ipv4first");
  setDefaultAutoSelectFamilyAttemptTimeout(1500);
  const config = whatsappConfig();
  const delivery = deliveryConfig();
  const store = new WhatsAppStore(config.key);
  const paymentTyping = new Map<string, () => void>();
  const canProcessSender = senderKeyAccess(config.allowed, config.key, config.publicAccess);
  const refreshPaymentTyping = (restartSender?: string) => {
    const rows = store.db
      .prepare(
        `SELECT p.id,p.sender,t.message_id FROM wa_payments p
      JOIN wa_payment_typing t ON t.payment_id=p.id JOIN wa_accounts a ON a.id=p.account_id
      WHERE p.state IN ('queued','preflight','submitting','unknown','broadcast')
      AND a.status='active' AND p.confirmed_at>?
      UNION ALL
      SELECT 'stock:' || o.id AS id,o.sender,o.confirmation_message AS message_id
      FROM wa_mainnet_orders o JOIN wa_accounts a ON a.id=o.account_id
      WHERE o.state IN ('queued','running','unknown') AND a.status='active'
      AND o.confirmation_message IS NOT NULL AND o.confirmed_at>?`,
      )
      .all(Date.now() - 180000, Date.now() - 180000) as {
      id: string;
      sender: string;
      message_id: string;
    }[];
    // Sending a chat message clears Meta's typing indicator. Restart only the
    // same sender's active operations after delivering an acknowledgement.
    for (const row of rows)
      if (row.sender === restartSender) {
        paymentTyping.get(row.id)?.();
        paymentTyping.delete(row.id);
      }
    const active = new Set(rows.filter((r) => canProcessSender(r.sender)).map((r) => r.id));
    for (const [id, stop] of paymentTyping)
      if (!active.has(id)) {
        stop();
        paymentTyping.delete(id);
      }
    for (const row of rows)
      if (active.has(row.id) && !paymentTyping.has(row.id))
        paymentTyping.set(
          row.id,
          typingWhileWaiting(
            `https://graph.facebook.com/${delivery.version}/${config.phoneId}/messages`,
            delivery.token,
            row.message_id,
          ),
        );
  };
  let running = true;
  process.on("SIGINT", () => {
    running = false;
  });
  process.on("SIGTERM", () => {
    running = false;
  });
  console.log(`WhatsApp worker started (${config.publicAccess ? "public" : "allowlist"} access).`);
  console.log(
    `Mainnet execution: ${process.env.MAINNET_STOCK_TRADING_ENABLED === "true" ? "enabled" : "disabled"}.`,
  );
  try {
    do {
      purgeAssistantMemory(store.db);
      store.prepare();
      refreshPaymentTyping();
      const job = store.claim();
      if (job) {
        let stopTyping: (() => void) | undefined;
        try {
          let payload = unseal<{ to: string } & Record<string, unknown>>(job.payload, config.key);
          if (!senderAllowed(config.allowed, payload.to, config.publicAccess)) {
            store.finish(job.id, "blocked", null, "sender_removed");
            continue;
          }
          // Outbox IDs from the inbox are actual Meta message IDs. Scheduled
          // wallet/payment notices have their own IDs and must not use them here.
          if (
            payload._steward_type !== "typing" &&
            store.db.prepare("SELECT id FROM wa_inbox WHERE id=?").get(job.id)
          ) {
            stopTyping = typingWhileWaiting(
              `https://graph.facebook.com/${delivery.version}/${config.phoneId}/messages`,
              delivery.token,
              job.id,
            );
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
          if (payload._steward_type === "mainnet_action" && typeof payload.action === "string") {
            payload = {
              to: payload.to,
              ...(await mainnetAction(
                store.db,
                config.key,
                payload.to,
                job.id,
                payload.action,
                typeof payload.recipient === "string" ? payload.recipient : undefined,
                typeof payload.amount === "string" ? payload.amount : undefined,
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
              signal: AbortSignal.timeout(typing ? 5_000 : 30_000),
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
            if (id && !typing) refreshPaymentTyping(senderLookup(payload.to, config.key));
            store.finish(
              job.id,
              id || (typing && body.success === true) ? "accepted" : "unknown",
              id || null,
              id || (typing && body.success === true) ? null : "missing_message_id",
            );
          }
        } catch (error) {
          // A timeout can follow successful delivery. Do not automatically send a second message.
          // Keep only known diagnostic codes; raw errors may contain request details.
          const failure = error as { name?: string; cause?: { code?: string } } | null;
          const code = failure?.cause?.code;
          const detail =
            failure?.name === "TimeoutError"
              ? "timeout"
              : code &&
                  [
                    "UND_ERR_CONNECT_TIMEOUT",
                    "ENOTFOUND",
                    "EAI_AGAIN",
                    "ECONNRESET",
                    "ETIMEDOUT",
                    "ECONNREFUSED",
                    "UND_ERR_SOCKET",
                  ].includes(code)
                ? code
                : "unclassified";
          store.finish(job.id, "unknown", null, "delivery_uncertain:" + detail);
        } finally {
          stopTyping?.();
        }
      }
      await provisionWallet(store.db, config.allowed, config.key, config.publicAccess);
      await processPayment(store.db, config.key, config.allowed, config.publicAccess);
      await processMainnetTrade(store.db, config.key, config.allowed, config.publicAccess);
      refreshPaymentTyping();
      if (process.argv.includes("--once")) break;
      await sleep(job ? 100 : 1000);
    } while (running);
  } finally {
    for (const stop of paymentTyping.values()) stop();
    store.close();
  }
}
main().catch(() => {
  console.error(
    "WhatsApp worker stopped. Check configuration and database access; no secrets logged.",
  );
  process.exitCode = 1;
});
