import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { packs, purchases, runs } from "../../../db/schema";
import { ensureDatabase } from "../../../db/ensure";

const DEMO_USER = "demo-user";
const CREATOR = "studio-north";

async function seed() {
  await ensureDatabase();
  const db = getDb();
  const existing = await db.select({ count: sql<number>`count(*)` }).from(packs);
  if (existing[0]?.count) return;
  await db.insert(packs).values([
    {
      id: "outbound-os",
      creatorId: CREATOR,
      title: "Signal-Led Outbound OS",
      description: "Turn a company signal into a thoughtful 4-touch sequence that sounds researched, relevant, and human.",
      category: "Sales",
      price: 29,
      model: "Claude 3.7 Sonnet",
      version: 3,
      prompt: "Research {{company}} for the signal {{trigger}}. Write a concise outbound sequence for {{persona}} using the offer: {{offer}}.",
      variables: JSON.stringify(["company", "persona", "trigger", "offer"]),
    },
    {
      id: "product-story",
      creatorId: CREATOR,
      title: "Product Story Studio",
      description: "Convert raw product specs into vivid, on-brand product pages with benefit-led copy and SEO metadata.",
      category: "E-commerce",
      price: 0,
      model: "GPT-4.1",
      version: 2,
      prompt: "Create a premium product story for {{product}}. Audience: {{audience}}. Key proof: {{proof}}. Voice: {{voice}}.",
      variables: JSON.stringify(["product", "audience", "proof", "voice"]),
    },
    {
      id: "content-atomizer",
      creatorId: "good-reason-studio",
      title: "Content Atomizer Pro",
      description: "Transform one long-form idea into a complete week of sharp, channel-native content.",
      category: "Marketing",
      price: 19,
      model: "Gemini 2.5 Pro",
      version: 4,
      prompt: "Repurpose {{source}} for {{audience}} across {{channels}}. Keep this core belief: {{thesis}}.",
      variables: JSON.stringify(["source", "audience", "channels", "thesis"]),
    },
  ]);
}

function asPack(pack: typeof packs.$inferSelect) {
  return { ...pack, variables: JSON.parse(pack.variables) as string[] };
}

export async function GET() {
  try {
    await seed();
    const db = getDb();
    const [allPacks, owned, history] = await Promise.all([
      db.select().from(packs).where(eq(packs.status, "published")).orderBy(desc(packs.createdAt)),
      db.select({ packId: purchases.packId }).from(purchases).where(eq(purchases.userId, DEMO_USER)),
      db.select().from(runs).where(eq(runs.userId, DEMO_USER)).orderBy(desc(runs.createdAt)).limit(12),
    ]);
    const totalRuns = await db.select({ count: sql<number>`count(*)` }).from(runs);
    const revenue = await db.select({ total: sql<number>`coalesce(sum(${purchases.amount}), 0)` }).from(purchases);
    return Response.json({
      packs: allPacks.map(asPack),
      owned: owned.map((item) => item.packId),
      history,
      stats: { runs: totalRuns[0]?.count ?? 0, revenue: revenue[0]?.total ?? 0, rating: 4.9 },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load PromptForge" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await seed();
    const db = getDb();
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "acquire") {
      const packId = String(body.packId);
      const [pack] = await db.select().from(packs).where(eq(packs.id, packId)).limit(1);
      if (!pack) return Response.json({ error: "Pack not found" }, { status: 404 });
      const exists = await db.select().from(purchases).where(and(eq(purchases.userId, DEMO_USER), eq(purchases.packId, packId))).limit(1);
      if (!exists.length) await db.insert(purchases).values({ userId: DEMO_USER, packId, amount: pack.price });
      return Response.json({ ok: true });
    }
    if (body.action === "publish") {
      const title = String(body.title ?? "").trim();
      if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
      const id = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
      const variables = String(body.prompt ?? "").match(/{{\s*([\w-]+)\s*}}/g)?.map((v) => v.replace(/[{}\s]/g, "")) ?? [];
      const [pack] = await db.insert(packs).values({
        id, creatorId: CREATOR, title,
        description: String(body.description ?? ""), category: String(body.category ?? "Marketing"),
        price: Number(body.price ?? 0), model: String(body.model ?? "GPT-4.1"),
        prompt: String(body.prompt ?? ""), variables: JSON.stringify([...new Set(variables)]),
      }).returning();
      return Response.json({ pack: asPack(pack) }, { status: 201 });
    }
    if (body.action === "favorite") {
      await db.update(runs).set({ favorite: Boolean(body.favorite) }).where(and(eq(runs.id, Number(body.runId)), eq(runs.userId, DEMO_USER)));
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 500 });
  }
}
