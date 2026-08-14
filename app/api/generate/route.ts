import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { packs, runs } from "../../../db/schema";
import { HttpError, newId, requireUser } from "../../../lib/auth";
import { envString } from "../../../lib/env";
import { errorResponse, readJson, str } from "../../../lib/http";
import { PROVIDERS, resolveProvider } from "../../../lib/models";
import { ProviderError, streamCompletion } from "../../../lib/providers";
import { parseVariables, renderPrompt } from "../../../lib/template";

/**
 * Runs a pack against a real model and streams the result back as SSE.
 *
 * Wire format (one JSON object per `data:` line):
 *   {"type":"start","runId":...,"model":...}
 *   {"type":"delta","text":"..."}
 *   {"type":"done","runId":...,"inputTokens":n,"outputTokens":n,"latencyMs":n}
 *   {"type":"error","message":"..."}
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);

    const [pack] = await getDb().select().from(packs).where(eq(packs.id, str(body.packId))).limit(1);
    if (!pack) throw new HttpError("Pack not found.", 404);

    const values = (body.values && typeof body.values === "object" ? body.values : {}) as Record<string, string>;
    const variables = parseVariables(pack.variables);
    const { text: prompt, missing } = renderPrompt(pack.prompt, variables, values);
    if (missing.length) {
      const labels = missing.map((name) => variables.find((v) => v.name === name)?.label ?? name);
      throw new HttpError(`Fill in: ${labels.join(", ")}.`, 400);
    }

    // The runner may override the model for a single run without editing the pack.
    const modelId = str(body.model).trim() || pack.model;
    const provider = resolveProvider(modelId, pack.provider);
    const apiKey = envString(PROVIDERS[provider].envKey);
    if (!apiKey) {
      throw new ProviderError(
        `${PROVIDERS[provider].label} has no API key configured. Add ${PROVIDERS[provider].envKey} to .dev.vars (local) or run \`npx wrangler secret put ${PROVIDERS[provider].envKey}\` (deployed).`,
        401,
        provider,
      );
    }

    const runId = newId("run");
    const startedAt = Date.now();
    const db = getDb();
    await db.insert(runs).values({
      id: runId,
      userId: user.id,
      packId: pack.id,
      packVersion: pack.version,
      provider,
      model: modelId,
      status: "running",
      input: JSON.stringify(values),
      // Explicit ISO instant: SQLite's CURRENT_TIMESTAMP has no timezone marker
      // and is misread as local time by `new Date()` in the browser.
      createdAt: new Date(startedAt).toISOString(),
    });

    const encoder = new TextEncoder();
    const send = (controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown) =>
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let output = "";
        let inputTokens = 0;
        let outputTokens = 0;
        try {
          send(controller, { type: "start", runId, model: modelId, provider, packVersion: pack.version });

          for await (const event of streamCompletion({
            provider,
            model: modelId,
            systemPrompt: pack.systemPrompt,
            prompt,
            temperature: pack.temperature / 100,
            maxTokens: pack.maxTokens,
            apiKey,
            signal: request.signal,
          })) {
            if (event.type === "text") {
              output += event.text;
              send(controller, { type: "delta", text: event.text });
            } else {
              // Providers report the two counts in different frames; keep the max
              // so a later zero never clobbers a real number.
              inputTokens = Math.max(inputTokens, event.inputTokens);
              outputTokens = Math.max(outputTokens, event.outputTokens);
            }
          }

          const latencyMs = Date.now() - startedAt;
          await db
            .update(runs)
            .set({ status: "ok", output, inputTokens, outputTokens, latencyMs })
            .where(eq(runs.id, runId));
          send(controller, { type: "done", runId, inputTokens, outputTokens, latencyMs });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Generation failed.";
          // Persist the partial output: a half-finished answer plus the error is
          // far more debuggable than an empty row.
          await db
            .update(runs)
            .set({ status: "error", output, error: message, latencyMs: Date.now() - startedAt })
            .where(eq(runs.id, runId))
            .catch(() => undefined);
          send(controller, { type: "error", message, runId });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Streaming through a proxy that buffers defeats the whole point.
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
