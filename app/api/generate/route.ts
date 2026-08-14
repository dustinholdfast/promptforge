import { getDb } from "../../../db";
import { packs, runs } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { ensureDatabase } from "../../../db/ensure";

export async function POST(request: Request) {
  const started = Date.now();
  try {
    await ensureDatabase();
    const body = await request.json() as { packId: string; model: string; values: Record<string, string> };
    const db = getDb();
    const [pack] = await db.select().from(packs).where(eq(packs.id, body.packId)).limit(1);
    if (!pack) return Response.json({ error: "Pack not found" }, { status: 404 });
    const company = body.values.company || body.values.product || "your offer";
    const audience = body.values.persona || body.values.audience || "a discerning buyer";
    const proof = body.values.trigger || body.values.proof || body.values.thesis || "a timely, concrete insight";
    const output = `# ${company}: a sharper way forward\n\n## The angle\n\n${audience} does not need more noise. They need a clear reason to care now. ${proof} creates that opening—and gives the message credibility before it ever asks for attention.\n\n## Recommended message\n\n**Subject:** A thought on ${company}\n\nHi there — I noticed ${proof.toLowerCase()}. That usually means the old playbook is starting to cost more than it returns.\n\nWe help teams turn that moment into focused action: a clearer story, less manual work, and an outcome people can measure. Worth comparing notes for 15 minutes next week?\n\n## Why this works\n\n- Leads with an observable signal, not a generic compliment\n- Connects the signal to a likely business cost\n- Makes one low-friction, specific ask\n\n---\n*Generated with ${pack.title} v${pack.version} · ${body.model}*`;
    const [run] = await db.insert(runs).values({ userId: "demo-user", packId: pack.id, model: body.model, input: JSON.stringify(body.values), output }).returning();
    return Response.json({ run, output, latency: Math.max(1.2, (Date.now() - started) / 1000).toFixed(1) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Generation failed" }, { status: 500 });
  }
}
