import { env } from "cloudflare:workers";

let initialized = false;

export async function ensureDatabase() {
  if (initialized) return;
  const db = env.DB;
  if (!db) throw new Error("PromptForge database binding is unavailable");
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS packs (
      id TEXT PRIMARY KEY NOT NULL,
      creator_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL DEFAULT 0 NOT NULL,
      model TEXT DEFAULT 'Claude 3.7 Sonnet' NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
      prompt TEXT NOT NULL,
      variables TEXT DEFAULT '[]' NOT NULL,
      status TEXT DEFAULT 'published' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      amount REAL DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      favorite INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_purchases_user_pack ON purchases(user_id, pack_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_runs_user_created ON runs(user_id, created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_packs_status_created ON packs(status, created_at DESC)"),
  ]);
  initialized = true;
}
