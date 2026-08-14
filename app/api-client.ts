"use client";

/** Thin fetch wrapper: every API route answers `{ error }` on failure. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export type StreamMessage =
  | { type: "start"; runId: string; model: string; provider: string; packVersion: number }
  | { type: "delta"; text: string }
  | { type: "done"; runId: string; inputTokens: number; outputTokens: number; latencyMs: number }
  | { type: "error"; message: string; runId?: string };

/**
 * POST to an SSE endpoint and yield decoded messages. EventSource can't POST,
 * so we read the body ourselves.
 */
export async function* streamRun(
  body: unknown,
  signal: AbortSignal,
): AsyncGenerator<StreamMessage> {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Generation failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const record = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of record.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          yield JSON.parse(line.slice(5).trim()) as StreamMessage;
        } catch {
          /* ignore malformed frames rather than killing the stream */
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
