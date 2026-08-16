import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { packs, runs } from "../db/schema";
import type { SessionUser } from "./auth";
import { hasEnv, subscriptionsAvailable } from "./env";
import { MODELS, PROVIDERS, type ProviderId } from "./models";
import { seedStarterPacks } from "./seed";
import { parseVariables } from "./template";
import { WORKSPACES } from "./workspaces";

/**
 * Shared read paths. The page renders from these on the server so the app has
 * data on first paint; the API routes call the same functions so the client
 * can refresh after a mutation without a full reload.
 */

const RUN_LIST_LIMIT = 60;

export const toPack = (row: typeof packs.$inferSelect) => ({
  ...row,
  variables: parseVariables(row.variables),
  temperature: row.temperature / 100,
});

export const providerStatus = (): Record<ProviderId, boolean> =>
  ({
    anthropic: subscriptionsAvailable(),
    openai: subscriptionsAvailable(),
    google: hasEnv(PROVIDERS.google.envKey!),
  });

export async function loadCatalogue(user: SessionUser) {
  await seedStarterPacks(user.id);
  const rows = await getDb()
    .select()
    .from(packs)
    .where(eq(packs.status, "active"))
    .orderBy(asc(packs.workspace), asc(packs.title));
  return {
    user,
    packs: rows.map(toPack),
    workspaces: WORKSPACES,
    models: MODELS,
    providers: providerStatus(),
  };
}

export async function listRuns(userId: string, onlyFavorites = false) {
  const rows = await getDb()
    .select({
      id: runs.id,
      packId: runs.packId,
      packTitle: packs.title,
      packVersion: runs.packVersion,
      model: runs.model,
      provider: runs.provider,
      status: runs.status,
      error: runs.error,
      output: runs.output,
      inputTokens: runs.inputTokens,
      outputTokens: runs.outputTokens,
      latencyMs: runs.latencyMs,
      favorite: runs.favorite,
      createdAt: runs.createdAt,
    })
    .from(runs)
    .leftJoin(packs, eq(packs.id, runs.packId))
    .where(onlyFavorites ? and(eq(runs.userId, userId), eq(runs.favorite, true)) : eq(runs.userId, userId))
    .orderBy(desc(runs.createdAt))
    .limit(RUN_LIST_LIMIT);

  // The list only ever shows a preview; full output is fetched on demand.
  return rows.map(({ output, ...row }) => ({
    ...row,
    packTitle: row.packTitle ?? "Deleted pack",
    preview: output.slice(0, 400),
  }));
}
