import { env } from "cloudflare:workers";

let initialized: Promise<void> | null = null;

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT,
    role TEXT DEFAULT 'member' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS packs (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    workspace TEXT DEFAULT 'shared' NOT NULL,
    system_prompt TEXT DEFAULT '' NOT NULL,
    prompt TEXT NOT NULL,
    variables TEXT DEFAULT '[]' NOT NULL,
    provider TEXT DEFAULT 'anthropic' NOT NULL,
    model TEXT NOT NULL,
    temperature INTEGER DEFAULT 70 NOT NULL,
    max_tokens INTEGER DEFAULT 2000 NOT NULL,
    version INTEGER DEFAULT 1 NOT NULL,
    status TEXT DEFAULT 'active' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_packs_status_updated ON packs(status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS pack_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    pack_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    system_prompt TEXT DEFAULT '' NOT NULL,
    prompt TEXT NOT NULL,
    variables TEXT DEFAULT '[]' NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    note TEXT DEFAULT '' NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pack_versions_pack_version ON pack_versions(pack_id, version)`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    pack_version INTEGER DEFAULT 1 NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT DEFAULT 'running' NOT NULL,
    input TEXT DEFAULT '{}' NOT NULL,
    output TEXT DEFAULT '' NOT NULL,
    error TEXT,
    input_tokens INTEGER DEFAULT 0 NOT NULL,
    output_tokens INTEGER DEFAULT 0 NOT NULL,
    latency_ms INTEGER DEFAULT 0 NOT NULL,
    favorite INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runs_user_created ON runs(user_id, created_at DESC)`,
];

/**
 * The pre-auth prototype used a different `packs`/`runs` shape (price,
 * purchases, integer run ids). Rather than dropping anyone's rows we rename
 * those tables aside once, then build the current schema next to them. The
 * `*_legacy_v0` tables are safe to delete by hand whenever you like.
 */
async function retireLegacyTables(db: D1Database) {
  const legacy: Array<[table: string, missingColumn: string]> = [
    ["packs", "workspace"],
    ["runs", "status"],
  ];
  for (const [table, requiredColumn] of legacy) {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    if (!info.results?.length) continue; // table does not exist yet
    if (info.results.some((column) => column.name === requiredColumn)) continue; // already current
    await db.exec(`ALTER TABLE ${table} RENAME TO ${table}_legacy_v0`);
  }
}

export async function ensureDatabase(): Promise<void> {
  const db = env.DB;
  if (!db) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Check `.openai/hosting.json` (or your wrangler config) and restart the dev server.",
    );
  }
  // Memoise the promise, not a boolean, so concurrent first requests share
  // one migration instead of racing three CREATE TABLE batches.
  initialized ??= (async () => {
    try {
      await retireLegacyTables(db);
      await db.batch(DDL.map((statement) => db.prepare(statement)));
    } catch (error) {
      initialized = null; // let the next request retry instead of caching failure
      throw error;
    }
  })();
  return initialized;
}
