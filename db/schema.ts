import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * PromptForge is an internal tool: a shared library of versioned prompt packs
 * that the team can run against real models. There is no marketplace, no
 * pricing and no purchases — everything here is about running prompts well.
 */

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    // Null when the account is provisioned by an upstream identity provider
    // (e.g. the ChatGPT host headers) rather than by password signup.
    passwordHash: text("password_hash"),
    role: text("role").notNull().default("member"), // "owner" | "member"
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_users_email").on(table.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    // SHA-256 of the opaque cookie token. The raw token is never stored.
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(), // epoch ms
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_sessions_user").on(table.userId)],
);

export const packs = sqliteTable(
  "packs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    // Which business this pack belongs to. See lib/workspaces.ts.
    workspace: text("workspace").notNull().default("shared"),
    systemPrompt: text("system_prompt").notNull().default(""),
    prompt: text("prompt").notNull(),
    // JSON array of PackVariable — see lib/template.ts.
    variables: text("variables").notNull().default("[]"),
    provider: text("provider").notNull().default("anthropic"),
    model: text("model").notNull(),
    temperature: integer("temperature").notNull().default(70), // stored as x100
    maxTokens: integer("max_tokens").notNull().default(2000),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("active"), // "active" | "archived"
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_packs_status_updated").on(table.status, table.updatedAt)],
);

/** An immutable snapshot of a pack, written every time the prompt changes. */
export const packVersions = sqliteTable(
  "pack_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    packId: text("pack_id").notNull(),
    version: integer("version").notNull(),
    systemPrompt: text("system_prompt").notNull().default(""),
    prompt: text("prompt").notNull(),
    variables: text("variables").notNull().default("[]"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_pack_versions_pack_version").on(table.packId, table.version)],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    packId: text("pack_id").notNull(),
    packVersion: integer("pack_version").notNull().default(1),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull().default("running"), // "running" | "ok" | "error"
    input: text("input").notNull().default("{}"),
    output: text("output").notNull().default(""),
    error: text("error"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_runs_user_created").on(table.userId, table.createdAt)],
);
