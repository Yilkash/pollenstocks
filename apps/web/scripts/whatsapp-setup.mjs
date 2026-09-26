import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Resolve from this script, so running from another directory cannot edit another app's secrets.
const app = fileURLToPath(new URL("../", import.meta.url));
const path = resolve(app, ".env.local");
const mode = process.argv[2] || "--check";
if (!["--init", "--check"].includes(mode)) {
  console.error("Usage: npm run whatsapp:setup -- --init | --check");
  process.exit(1);
}
function readSettings() {
  return parseEnv(existsSync(path) ? readFileSync(path, "utf8") : "");
}
function initialize() {
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  const current = parseEnv(original);
  const defaults = {
    WHATSAPP_ENABLED: "false",
    WHATSAPP_GRAPH_VERSION: "v25.0",
    WHATSAPP_PHONE_NUMBER_ID: "",
    WHATSAPP_WABA_ID: "",
    WHATSAPP_APP_SECRET: "",
    WHATSAPP_VERIFY_TOKEN: "",
    WHATSAPP_ACCESS_TOKEN: "",
    WHATSAPP_DATA_KEY: "",
    WHATSAPP_ALLOWED_SENDERS: "",
    WHATSAPP_DATABASE_PATH: ".data/whatsapp.sqlite",
  };
  const database = resolve(app, current.WHATSAPP_DATABASE_PATH || defaults.WHATSAPP_DATABASE_PATH);
  if (!current.WHATSAPP_DATA_KEY && existsSync(database)) {
    throw new Error(
      "Restore the existing WHATSAPP_DATA_KEY from your private backup before continuing; an existing database was found.",
    );
  }
  let updated = original;
  for (const [name, defaultValue] of Object.entries(defaults)) {
    if (current[name]?.trim()) continue;
    const value = ["WHATSAPP_VERIFY_TOKEN", "WHATSAPP_DATA_KEY"].includes(name)
      ? randomBytes(32).toString("hex")
      : defaultValue;
    if (Object.hasOwn(current, name)) {
      // Append nothing to existing blank account fields; replace only a plain empty value.
      if (!value) continue;
      const expression = new RegExp(
        `^(?:export[ \t]+)?${name}[ \t]*=[ \t]*(?:""|'')?[ \t]*(?:#.*)?$`,
        "m",
      );
      if (!expression.test(updated))
        throw new Error(
          `Set ${name} manually; its existing assignment is not a plain empty value.`,
        );
      updated = updated.replace(expression, `${name}=${value}`);
    } else {
      updated += `${updated.endsWith("\n") || !updated ? "" : "\n"}${name}=${value}\n`;
    }
  }
  // Avoid overwriting an editor save made while this command was preparing changes.
  const latest = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (latest !== original)
    throw new Error("The env file changed; rerun setup after saving your editor.");
  if (updated !== original) writeFileSync(path, updated, { mode: 0o600 });
  chmodSync(path, 0o600);
  console.log(
    "Private WhatsApp settings prepared. Existing nonempty values were preserved; no secrets printed.",
  );
}
function check() {
  const values = readSettings();
  let missing = 0;
  for (const name of [
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_WABA_ID",
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_DATA_KEY",
    "WHATSAPP_ALLOWED_SENDERS",
    "WHATSAPP_GRAPH_VERSION",
  ]) {
    const value = values[name]?.trim();
    let valid = !!value;
    if (value && ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_WABA_ID"].includes(name))
      valid = /^\d{5,20}$/.test(value);
    if (value && name === "WHATSAPP_DATA_KEY") valid = /^[a-f0-9]{64}$/i.test(value);
    if (value && name === "WHATSAPP_ALLOWED_SENDERS")
      valid = value.split(",").every((x) => /^\d{5,20}$/.test(x.trim()));
    if (value && name === "WHATSAPP_GRAPH_VERSION") valid = /^v\d+\.\d+$/.test(value);
    console.log(`${name}: ${!value ? "missing" : valid ? "present" : "invalid format"}`);
    if (!valid) missing++;
  }
  console.log(`WhatsApp channel: ${values.WHATSAPP_ENABLED === "true" ? "enabled" : "disabled"}`);
  console.log("Callback path: /api/whatsapp/webhook (public HTTPS host still required)");
  console.log(
    "Local file inspection only: credentials, API access and message delivery have not been verified.",
  );
  if (missing) process.exitCode = 1;
}
try {
  if (mode === "--init") initialize();
  check();
} catch {
  // Env parsing errors may contain sensitive source text; do not print exception details.
  console.error(
    "Setup stopped. Check env syntax, concurrent edits and file permissions. If a WhatsApp database exists, restore its original data key before initializing.",
  );
  process.exitCode = 1;
}
