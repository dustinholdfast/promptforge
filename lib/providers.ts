/**
 * Local model transports.
 *
 * OpenAI and Anthropic requests go to the loopback-only Node bridge started by
 * `npm run dev`; that bridge invokes the authenticated Codex and Claude CLIs.
 * Gemini remains an optional direct API integration because Google has no
 * equivalent subscription CLI in PromptForge.
 */

import type { ProviderId } from "./models";

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number };

export type GenerateOptions = {
  provider: ProviderId;
  model: string;
  systemPrompt: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  apiKey?: string;
  bridgeUrl?: string;
  signal?: AbortSignal;
};

export class ProviderError extends Error {
  status: number;
  provider: ProviderId;

  constructor(message: string, status: number, provider: ProviderId) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.provider = provider;
  }
}

export type SseEvent = { event: string; data: string };

/** Parse a byte stream of server-sent events, tolerating arbitrary chunking. */
export async function* sseEvents(source: AsyncIterable<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of source) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + buffer.slice(boundary).match(/^\r?\n\r?\n/)![0].length);
      const parsed = parseSseRecord(raw);
      if (parsed) yield parsed;
      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }
  buffer += decoder.decode();
  const tail = parseSseRecord(buffer);
  if (tail) yield tail;
}

function parseSseRecord(raw: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

function bodyIterable(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

type Json = Record<string, unknown>;
const asRecord = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
const asNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function decodeGoogle(payload: unknown): StreamEvent[] {
  const event = asRecord(payload);
  if (!event) return [];
  if (asRecord(event.error)) {
    throw new ProviderError(String(asRecord(event.error)?.message ?? "Gemini stream error"), 502, "google");
  }
  const out: StreamEvent[] = [];
  const candidates = Array.isArray(event.candidates) ? event.candidates : [];
  for (const candidate of candidates) {
    const parts = asRecord(asRecord(candidate)?.content)?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const text = asRecord(part)?.text;
      if (typeof text === "string" && text) out.push({ type: "text", text });
    }
  }
  const usage = asRecord(event.usageMetadata);
  if (usage) {
    out.push({
      type: "usage",
      inputTokens: asNumber(usage.promptTokenCount),
      outputTokens: asNumber(usage.candidatesTokenCount),
    });
  }
  return out;
}

/** Pull the most useful message out of a provider's error body. */
export function readErrorMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as Json;
    const error = asRecord(parsed.error) ?? parsed;
    const message = error.message ?? error.detail ?? parsed.message ?? parsed.error;
    if (typeof message === "string" && message) return message;
  } catch {
    /* fall through to the raw body */
  }
  const trimmed = body.trim();
  if (trimmed) return trimmed.slice(0, 400);
  return `Provider returned HTTP ${status}`;
}

function bridgeEndpoint(configured = "http://127.0.0.1:4317"): string {
  const url = new URL("/generate", configured);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("PROMPTFORGE_BRIDGE_URL must use HTTP on the local loopback interface.");
  }
  return url.toString();
}

async function* streamSubscription(options: GenerateOptions): AsyncGenerator<StreamEvent> {
  let response: Response;
  try {
    response = await fetch(bridgeEndpoint(options.bridgeUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: options.provider,
        model: options.model,
        systemPrompt: options.systemPrompt,
        prompt: options.prompt,
        maxTokens: options.maxTokens,
      }),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ProviderError(
      `Could not reach the local subscription bridge. Start PromptForge with \`npm run dev\`. ${
        error instanceof Error ? error.message : ""
      }`.trim(),
      503,
      options.provider,
    );
  }

  if (!response.ok || !response.body) {
    const body = response.body ? await response.text() : "";
    throw new ProviderError(readErrorMessage(body, response.status), response.status, options.provider);
  }

  for await (const event of sseEvents(bodyIterable(response.body))) {
    let payload: Json | null = null;
    try {
      payload = asRecord(JSON.parse(event.data));
    } catch {
      continue;
    }
    if (!payload) continue;
    if (payload.type === "text" && typeof payload.text === "string") {
      yield { type: "text", text: payload.text };
    } else if (payload.type === "usage") {
      yield {
        type: "usage",
        inputTokens: asNumber(payload.inputTokens),
        outputTokens: asNumber(payload.outputTokens),
      };
    } else if (payload.type === "error") {
      throw new ProviderError(String(payload.message ?? "Subscription CLI failed."), 502, options.provider);
    }
  }
}

async function* streamGoogle(options: GenerateOptions): AsyncGenerator<StreamEvent> {
  if (!options.apiKey) {
    throw new ProviderError("No Google API key configured. Add GOOGLE_API_KEY to .dev.vars.", 401, "google");
  }
  const system = options.systemPrompt.trim();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: options.prompt }] }],
        generationConfig: { temperature: options.temperature, maxOutputTokens: options.maxTokens },
      }),
      signal: options.signal,
    },
  );

  if (!response.ok || !response.body) {
    const body = response.body ? await response.text() : "";
    throw new ProviderError(readErrorMessage(body, response.status), response.status, "google");
  }
  for await (const event of sseEvents(bodyIterable(response.body))) {
    if (event.data === "[DONE]") return;
    try {
      yield* decodeGoogle(JSON.parse(event.data));
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
}

export async function* streamCompletion(options: GenerateOptions): AsyncGenerator<StreamEvent> {
  if (options.provider === "google") yield* streamGoogle(options);
  else yield* streamSubscription(options);
}
