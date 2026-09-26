import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, copyFileSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const folder = join(homedir(), "steward-backups", new Date().toISOString().replaceAll(":", "-"));

mkdirSync(folder, { recursive: true, mode: 0o700 });

const settings = join(folder, ".env.local");
copyFileSync(".env.local", settings);
chmodSync(settings, 0o600);

const databases = [
  [process.env.DATABASE_PATH || ".data/steward.sqlite", "steward.sqlite"],
  [process.env.WHATSAPP_DATABASE_PATH || ".data/whatsapp.sqlite", "whatsapp.sqlite"],
];

for (const [source, name] of databases) {
  if (!existsSync(source)) {
    console.log(`Not found: ${name}`);
    continue;
  }

  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, join(folder, name));
    console.log(`Backed up: ${name}`);
  } finally {
    db.close();
  }
}

console.log(`Backup folder: ${folder}`);
