import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const packs = sqliteTable("packs", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  price: real("price").notNull().default(0),
  model: text("model").notNull().default("Claude 3.7 Sonnet"),
  version: integer("version").notNull().default(1),
  prompt: text("prompt").notNull(),
  variables: text("variables").notNull().default("[]"),
  status: text("status").notNull().default("published"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const purchases = sqliteTable("purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  packId: text("pack_id").notNull(),
  amount: real("amount").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  packId: text("pack_id").notNull(),
  model: text("model").notNull(),
  input: text("input").notNull(),
  output: text("output").notNull(),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
