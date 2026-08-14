import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { runs } from "../../../db/schema";
import { HttpError, requireUser } from "../../../lib/auth";
import { errorResponse, json, num, readJson, str } from "../../../lib/http";
import { listRuns } from "../../../lib/library";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const onlyFavorites = new URL(request.url).searchParams.get("favorites") === "1";
    return json({ runs: await listRuns(user.id, onlyFavorites) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);
    const action = str(body.action);
    const runId = str(body.runId);
    const db = getDb();

    if (action === "open") {
      const [row] = await db
        .select()
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.userId, user.id)))
        .limit(1);
      if (!row) throw new HttpError("Run not found.", 404);
      return json({ run: { ...row, input: JSON.parse(row.input || "{}") as Record<string, string> } });
    }

    if (action === "favorite") {
      const favorite = body.favorite !== false;
      const [row] = await db
        .update(runs)
        .set({ favorite })
        .where(and(eq(runs.id, runId), eq(runs.userId, user.id)))
        .returning({ id: runs.id, favorite: runs.favorite });
      if (!row) throw new HttpError("Run not found.", 404);
      return json({ run: row });
    }

    if (action === "delete") {
      const deleted = await db
        .delete(runs)
        .where(and(eq(runs.id, runId), eq(runs.userId, user.id)))
        .returning({ id: runs.id });
      if (!deleted.length) throw new HttpError("Run not found.", 404);
      return json({ ok: true });
    }

    if (action === "stats") {
      const rows = await db
        .select({ status: runs.status, outputTokens: runs.outputTokens, latencyMs: runs.latencyMs })
        .from(runs)
        .where(eq(runs.userId, user.id))
        .orderBy(desc(runs.createdAt))
        .limit(num(body.limit, 200));
      const ok = rows.filter((row) => row.status === "ok");
      return json({
        total: rows.length,
        failed: rows.filter((row) => row.status === "error").length,
        outputTokens: ok.reduce((sum, row) => sum + row.outputTokens, 0),
        medianLatencyMs: median(ok.map((row) => row.latencyMs)),
      });
    }

    throw new HttpError("Unsupported action.", 400);
  } catch (error) {
    return errorResponse(error);
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
