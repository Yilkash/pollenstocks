import { z } from "zod";
import { equalSecret, signedBody, whatsappConfig, senderAllowed } from "@/server/whatsapp/config";
import { WhatsAppStore, type Incoming } from "@/server/whatsapp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const messageSchema = z.object({
  id: z.string().min(1).max(512),
  from: z.string().regex(/^\d{5,20}$/),
  timestamp: z.string().regex(/^\d{1,12}$/),
  type: z.string(),
  text: z.object({ body: z.string().max(4096) }).optional(),
  interactive: z
    .object({
      list_reply: z.object({ id: z.string().max(200) }).optional(),
      button_reply: z.object({ id: z.string().max(200) }).optional(),
    })
    .optional(),
});
const envelope = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }).optional(),
            messages: z.array(z.unknown()).optional(),
          }),
        }),
      ),
    }),
  ),
});
export async function GET(request: Request) {
  try {
    const config = whatsappConfig();
    const query = new URL(request.url).searchParams;
    const challenge = query.get("hub.challenge");
    if (
      query.get("hub.mode") !== "subscribe" ||
      !equalSecret(query.get("hub.verify_token") || "", config.verifyToken) ||
      !challenge ||
      challenge.length > 200
    )
      return new Response("Forbidden", { status: 403 });
    return new Response(challenge, {
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("WhatsApp unavailable", { status: 503 });
  }
}
export async function POST(request: Request) {
  let config: ReturnType<typeof whatsappConfig>;
  try {
    config = whatsappConfig();
  } catch {
    return new Response("WhatsApp unavailable", { status: 503 });
  }
  // Read bytes with a hard limit before parsing; HMAC must cover the original body.
  const reader = request.body?.getReader();
  if (!reader) return new Response("Missing body", { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256_000) {
        await reader.cancel();
        return new Response("Too large", { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return new Response("Invalid body", { status: 400 });
  }
  const raw = Buffer.concat(chunks);
  if (!signedBody(raw, request.headers.get("x-hub-signature-256"), config.secret))
    return new Response("Forbidden", { status: 403 });
  let parsed: z.infer<typeof envelope>;
  try {
    parsed = envelope.parse(JSON.parse(raw.toString("utf8")));
  } catch {
    return new Response("Invalid event", { status: 400 });
  }
  const messages: Incoming[] = [];
  for (const entry of parsed.entry) {
    if (entry.id !== config.wabaId) continue;
    for (const change of entry.changes) {
      if (change.field !== "messages" || change.value.metadata?.phone_number_id !== config.phoneId)
        continue;
      for (const item of change.value.messages || []) {
        const result = messageSchema.safeParse(item);
        if (!result.success) continue;
        const m = result.data,
          timestamp = Number(m.timestamp) * 1000;
        if (
          !senderAllowed(config.allowed, m.from, config.publicAccess) ||
          timestamp > Date.now() + 300_000 ||
          timestamp < Date.now() - 23 * 60 * 60_000
        )
          continue;
        messages.push({
          id: m.id,
          from: m.from,
          timestamp,
          input:
            m.type === "text"
              ? m.text?.body || ""
              : m.type === "interactive"
                ? m.interactive?.list_reply?.id || m.interactive?.button_reply?.id || ""
                : "",
        });
      }
    }
  }
  let store: WhatsAppStore | undefined;
  try {
    store = new WhatsAppStore(config.key);
    store.accept(messages);
  } catch {
    return new Response("Storage unavailable", { status: 503 });
  } finally {
    store?.close();
  }
  // Durable acceptance precedes acknowledgement. Delivery is handled by the worker.
  return Response.json({ received: true });
}
