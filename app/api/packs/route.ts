import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { packVersions, packs } from "../../../db/schema";
import { HttpError, requireUser } from "../../../lib/auth";
import { errorResponse, json, num, readJson, str } from "../../../lib/http";
import { MODELS, resolveProvider } from "../../../lib/models";
import { loadCatalogue, toPack } from "../../../lib/library";
import { parseVariables, syncVariables } from "../../../lib/template";
import { isWorkspace } from "../../../lib/workspaces";

export async function GET(request: Request) {
  try {
    return json(await loadCatalogue(await requireUser(request)));
  } catch (error) {
    return errorResponse(error);
  }
}

type PackInput = {
  title: string;
  description: string;
  workspace: string;
  systemPrompt: string;
  prompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

function readPackInput(body: Record<string, unknown>): PackInput {
  const title = str(body.title).trim();
  const prompt = str(body.prompt).trim();
  if (!title) throw new HttpError("Give the pack a name.", 400);
  if (!prompt) throw new HttpError("A pack needs a prompt template.", 400);

  const model = str(body.model).trim() || MODELS[0].id;
  const workspace = str(body.workspace, "shared");
  return {
    title,
    prompt,
    description: str(body.description).trim(),
    workspace: isWorkspace(workspace) ? workspace : "shared",
    systemPrompt: str(body.systemPrompt).trim(),
    model,
    // Clamp rather than reject: a slider that silently fails is worse than one that saturates.
    temperature: Math.round(Math.min(2, Math.max(0, num(body.temperature, 0.7))) * 100),
    maxTokens: Math.round(Math.min(32000, Math.max(256, num(body.maxTokens, 2000)))),
  };
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);
    const action = str(body.action);
    const db = getDb();
    const now = new Date().toISOString();

    if (action === "create") {
      const input = readPackInput(body);
      const provider = resolveProvider(input.model, str(body.provider, "anthropic"));
      const id = `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pack"}-${crypto.randomUUID().slice(0, 6)}`;
      const variables = JSON.stringify(syncVariables(input.prompt, parseVariables(body.variables)));

      const [row] = await db
        .insert(packs)
        .values({ ...input, id, ownerId: user.id, provider, variables, version: 1, createdAt: now, updatedAt: now })
        .returning();
      await db.insert(packVersions).values({
        packId: id,
        version: 1,
        systemPrompt: input.systemPrompt,
        prompt: input.prompt,
        variables,
        provider,
        model: input.model,
        note: str(body.note).trim() || "Created",
        createdBy: user.id,
        createdAt: now,
      });
      return json({ pack: toPack(row) }, { status: 201 });
    }

    if (action === "update") {
      const packId = str(body.id);
      const [existing] = await db.select().from(packs).where(eq(packs.id, packId)).limit(1);
      if (!existing) throw new HttpError("Pack not found.", 404);

      const input = readPackInput(body);
      const provider = resolveProvider(input.model, str(body.provider, existing.provider));
      const variables = JSON.stringify(syncVariables(input.prompt, parseVariables(body.variables)));

      // Only the parts that change what the model sees earn a new version.
      const substantive =
        input.prompt !== existing.prompt ||
        input.systemPrompt !== existing.systemPrompt ||
        input.model !== existing.model ||
        provider !== existing.provider;
      const version = substantive ? existing.version + 1 : existing.version;

      const [row] = await db
        .update(packs)
        .set({ ...input, provider, variables, version, updatedAt: now })
        .where(eq(packs.id, packId))
        .returning();

      if (substantive) {
        await db.insert(packVersions).values({
          packId,
          version,
          systemPrompt: input.systemPrompt,
          prompt: input.prompt,
          variables,
          provider,
          model: input.model,
          note: str(body.note).trim(),
          createdBy: user.id,
          createdAt: now,
        });
      }
      return json({ pack: toPack(row), versioned: substantive });
    }

    if (action === "archive" || action === "restore") {
      const packId = str(body.id);
      const [row] = await db
        .update(packs)
        .set({ status: action === "archive" ? "archived" : "active", updatedAt: now })
        .where(eq(packs.id, packId))
        .returning();
      if (!row) throw new HttpError("Pack not found.", 404);
      return json({ pack: toPack(row) });
    }

    if (action === "duplicate") {
      const [source] = await db.select().from(packs).where(eq(packs.id, str(body.id))).limit(1);
      if (!source) throw new HttpError("Pack not found.", 404);
      const id = `${source.id.slice(0, 40)}-copy-${crypto.randomUUID().slice(0, 6)}`;
      const [row] = await db
        .insert(packs)
        .values({
          ...source,
          id,
          ownerId: user.id,
          title: `${source.title} (copy)`,
          version: 1,
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await db.insert(packVersions).values({
        packId: id,
        version: 1,
        systemPrompt: source.systemPrompt,
        prompt: source.prompt,
        variables: source.variables,
        provider: source.provider,
        model: source.model,
        note: `Duplicated from ${source.title}`,
        createdBy: user.id,
        createdAt: now,
      });
      return json({ pack: toPack(row) }, { status: 201 });
    }

    if (action === "history") {
      const rows = await db
        .select()
        .from(packVersions)
        .where(eq(packVersions.packId, str(body.id)))
        .orderBy(desc(packVersions.version))
        .limit(30);
      return json({ versions: rows.map((row) => ({ ...row, variables: parseVariables(row.variables) })) });
    }

    if (action === "revert") {
      const packId = str(body.id);
      const target = num(body.version, 0);
      const [existing] = await db.select().from(packs).where(eq(packs.id, packId)).limit(1);
      if (!existing) throw new HttpError("Pack not found.", 404);
      const [snapshot] = await db
        .select()
        .from(packVersions)
        .where(and(eq(packVersions.packId, packId), eq(packVersions.version, target)))
        .limit(1);
      if (!snapshot) throw new HttpError("That version no longer exists.", 404);

      // Reverting moves forward: we write the old content as a new version so
      // the history stays append-only and nothing is lost.
      const version = existing.version + 1;
      const [row] = await db
        .update(packs)
        .set({
          systemPrompt: snapshot.systemPrompt,
          prompt: snapshot.prompt,
          variables: snapshot.variables,
          provider: snapshot.provider,
          model: snapshot.model,
          version,
          updatedAt: now,
        })
        .where(eq(packs.id, packId))
        .returning();
      await db.insert(packVersions).values({
        packId,
        version,
        systemPrompt: snapshot.systemPrompt,
        prompt: snapshot.prompt,
        variables: snapshot.variables,
        provider: snapshot.provider,
        model: snapshot.model,
        note: `Reverted to v${target}`,
        createdBy: user.id,
        createdAt: now,
      });
      return json({ pack: toPack(row) });
    }

    if (action === "preview-variables") {
      return json({ variables: syncVariables(str(body.prompt), parseVariables(body.variables)) });
    }

    throw new HttpError("Unsupported action.", 400);
  } catch (error) {
    return errorResponse(error);
  }
}
