/**
 * Real model calls. One small adapter per provider, all over `fetch` so this
 * runs unmodified on Cloudflare Workers (no Node-only SDKs).
 *
 * Everything below the transport layer is a pure function over already-parsed
 * JSON, which is what makes the wire formats testable without a network or an
 * API key — see tests/providers.test.mjs.
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
  /** 0–2, as the providers express it. */
  temperature: number;
  maxTokens: number;
  apiKey: string;
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

/* ------------------------------------------------------------------ *
 * SSE plumbing
 * ------------------------------------------------------------------ */

export type SseEvent = { event: string; data: string };

/** Parse a byte stream of server-sent events, tolerating arbitrary chunking. */
export async function* sseEvents(source: AsyncIterable<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of source) {
    buffer += decoder.decode(chunk, { stream: true });
    // Records are separated by a blank line; \r\n is legal too.
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
  // Workers' ReadableStream is not reliably async-iterable across runtimes,
  // so drive the reader ourselves.
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

/* ------------------------------------------------------------------ *
 * Per-provider decoders (pure)
 * ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
const asNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function decodeAnthropic(payload: unknown): StreamEvent[] {
  const event = asRecord(payload);
  if (!event) return [];
  switch (event.type) {
    case "content_block_delta": {
      const delta = asRecord(event.delta);
      const text = delta?.type === "text_delta" && typeof delta.text === "string" ? delta.text : "";
      return text ? [{ type: "text", text }] : [];
    }
    case "message_start": {
      const usage = asRecord(asRecord(event.message)?.usage);
      return usage ? [{ type: "usage", inputTokens: asNumber(usage.input_tokens), outputTokens: 0 }] : [];
    }
    case "message_delta": {
      const usage = asRecord(event.usage);
      return usage ? [{ type: "usage", inputTokens: 0, outputTokens: asNumber(usage.output_tokens) }] : [];
    }
    case "error": {
      const error = asRecord(event.error);
      throw new ProviderError(String(error?.message ?? "Anthropic stream error"), 502, "anthropic");
    }
    default:
      return [];
  }
}

export function decodeOpenAI(payload: unknown): StreamEvent[] {
  const event = asRecord(payload);
  if (!event) return [];
  if (asRecord(event.error)) {
    throw new ProviderError(String(asRecord(event.error)?.message ?? "OpenAI stream error"), 502, "openai");
  }
  const out: StreamEvent[] = [];
  const choices = Array.isArray(event.choices) ? event.choices : [];
  for (const choice of choices) {
    const delta = asRecord(asRecord(choice)?.delta);
    if (typeof delta?.content === "string" && delta.content) out.push({ type: "text", text: delta.content });
  }
  const usage = asRecord(event.usage);
  if (usage) {
    out.push({
      type: "usage",
      inputTokens: asNumber(usage.prompt_tokens),
      outputTokens: asNumber(usage.completion_tokens),
    });
  }
  return out;
}

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

/**
 * Reasoning-family OpenAI models reject any temperature other than the
 * default, so we omit the field entirely rather than fail the whole run.
 */
export function openAISupportsTemperature(model: string): boolean {
  return !/^(gpt-5|o[1-9])/.test(model);
}

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

type Wire = { url: string; init: RequestInit; decode: (payload: unknown) => StreamEvent[] };

function buildRequest(options: GenerateOptions): Wire {
  const { model, systemPrompt, prompt, temperature, maxTokens, apiKey } = options;
  const system = systemPrompt.trim();

  if (options.provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: Math.min(temperature, 1), // Anthropic caps temperature at 1
          stream: true,
          ...(system ? { system } : {}),
          messages: [{ role: "user", content: prompt }],
        }),
      },
      decode: decodeAnthropic,
    };
  }

  if (options.provider === "openai") {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      init: {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: maxTokens,
          ...(openAISupportsTemperature(model) ? { temperature } : {}),
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: prompt },
          ],
        }),
      },
      decode: decodeOpenAI,
    };
  }

  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    },
    decode: decodeGoogle,
  };
}

/** Pull the most useful message out of a provider's error body. */
export function readErrorMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as Json;
    const error = asRecord(parsed.error) ?? parsed;
    const message = error.message ?? error.detail ?? parsed.message;
    if (typeof message === "string" && message) return message;
  } catch {
    /* fall through to the raw body */
  }
  const trimmed = body.trim();
  if (trimmed) return trimmed.slice(0, 400);
  return `Provider returned HTTP ${status}`;
}

export async function* streamCompletion(options: GenerateOptions): AsyncGenerator<StreamEvent> {
  if (!options.apiKey) {
    throw new ProviderError(
      `No API key configured for ${options.provider}. Add it to .dev.vars locally or as a Worker secret in production.`,
      401,
      options.provider,
    );
  }

  const { url, init, decode } = buildRequest(options);
  const response = await fetch(url, { ...init, signal: options.signal });

  if (!response.ok || !response.body) {
    const body = response.body ? await response.text() : "";
    throw new ProviderError(readErrorMessage(body, response.status), response.status, options.provider);
  }

  for await (const event of sseEvents(bodyIterable(response.body))) {
    if (event.data === "[DONE]") return;
    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      continue; // keep-alive or partial comment frames
    }
    yield* decode(payload);
  }
}
