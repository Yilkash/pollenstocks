import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
export function whatsappConfig() {
  if (process.env.WHATSAPP_ENABLED !== "true") throw new Error("WhatsApp is disabled");
  const keyHex = required("WHATSAPP_DATA_KEY");
  if (!/^[a-f0-9]{64}$/i.test(keyHex))
    throw new Error("WHATSAPP_DATA_KEY must be 32 random bytes in hex");
  const phoneId = required("WHATSAPP_PHONE_NUMBER_ID");
  const wabaId = required("WHATSAPP_WABA_ID");
  const allowed = new Set(
    required("WHATSAPP_ALLOWED_SENDERS")
      .split(",")
      .map((x) => x.trim()),
  );
  if (![phoneId, wabaId, ...allowed].every((x) => /^[0-9]{5,20}$/.test(x)))
    throw new Error("Invalid WhatsApp IDs");
  return {
    key: Buffer.from(keyHex, "hex"),
    phoneId,
    wabaId,
    allowed,
    secret: required("WHATSAPP_APP_SECRET"),
    verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
  };
}
export function deliveryConfig() {
  const version = required("WHATSAPP_GRAPH_VERSION");
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Invalid Graph version");
  return { token: required("WHATSAPP_ACCESS_TOKEN"), version };
}
export function equalSecret(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function signedBody(body: Buffer, signature: string | null, secret: string) {
  return (
    !!signature &&
    /^sha256=[a-f0-9]{64}$/.test(signature) &&
    equalSecret(signature, "sha256=" + createHmac("sha256", secret).update(body).digest("hex"))
  );
}
export function senderLookup(sender: string, key: Buffer) {
  return createHmac("sha256", key)
    .update("steward:whatsapp:sender:" + sender)
    .digest("hex");
}
// Authenticated encryption keeps phone numbers and message bodies out of plaintext SQLite.
export function seal(value: unknown, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("steward:whatsapp:v1"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
export function unseal<T>(value: string, key: Buffer): T {
  const bytes = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from("steward:whatsapp:v1"));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8"),
  ) as T;
}
