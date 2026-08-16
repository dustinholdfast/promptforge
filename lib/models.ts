/**
 * The model catalogue.
 *
 * Model IDs move fast — this file is the single place to update them. Each
 * entry names the provider adapter (see lib/providers.ts) and the exact API
 * model string. Verified against provider docs in August 2026; if a run comes
 * back with a "model not found" error, this list is the first thing to check.
 */

export type ProviderId = "anthropic" | "openai" | "google";

export type ModelOption = {
  provider: ProviderId;
  id: string;
  label: string;
  note: string;
};

export const PROVIDERS: Record<
  ProviderId,
  { label: string; access: "subscription" | "api"; envKey?: string; docs: string }
> = {
  anthropic: {
    label: "Anthropic",
    access: "subscription",
    docs: "https://code.claude.com/docs/en/headless",
  },
  openai: {
    label: "OpenAI",
    access: "subscription",
    docs: "https://developers.openai.com/codex/cli/reference",
  },
  google: {
    label: "Google",
    access: "api",
    envKey: "GOOGLE_API_KEY",
    docs: "https://ai.google.dev/gemini-api/docs/models",
  },
};

export const MODELS: ModelOption[] = [
  { provider: "anthropic", id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "Balanced default" },
  { provider: "anthropic", id: "claude-opus-5", label: "Claude Opus 5", note: "Hardest reasoning" },
  { provider: "anthropic", id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Fast and cheap" },
  { provider: "openai", id: "gpt-5.6", label: "GPT-5.6 Sol", note: "Frontier" },
  { provider: "openai", id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "Balanced" },
  { provider: "openai", id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "Cost-sensitive" },
  { provider: "google", id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", note: "Fast, long context" },
  { provider: "google", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "Deeper reasoning" },
];

export const DEFAULT_MODEL = MODELS[0];

export function findModel(id: string): ModelOption | undefined {
  return MODELS.find((model) => model.id === id);
}

/** Trust the catalogue over a stored pack row, but never silently drop a custom id. */
export function resolveProvider(modelId: string, fallback: string): ProviderId {
  const known = findModel(modelId);
  if (known) return known.provider;
  return (["anthropic", "openai", "google"] as const).includes(fallback as ProviderId)
    ? (fallback as ProviderId)
    : DEFAULT_MODEL.provider;
}
