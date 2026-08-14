/**
 * Prompt templates use {{variable}} placeholders. This module is deliberately
 * dependency-free and side-effect-free so it can be unit tested directly with
 * `node --test` — no Workers runtime required.
 */

export type VariableType = "text" | "textarea" | "select";

export type PackVariable = {
  name: string;
  label: string;
  type: VariableType;
  required: boolean;
  placeholder: string;
  options: string[];
};

const PLACEHOLDER = /\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g;

export function humanise(name: string): string {
  const spaced = name.replace(/[-_]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function defaultVariable(name: string): PackVariable {
  return {
    name,
    label: humanise(name),
    // Long-form fields get a textarea; short identifiers get a single line.
    type: /(context|notes?|details?|source|content|background|transcript|body|description)$/i.test(name)
      ? "textarea"
      : "text",
    required: true,
    placeholder: "",
    options: [],
  };
}

/** Placeholder names in the order they first appear, de-duplicated. */
export function extractVariableNames(prompt: string): string[] {
  const seen = new Set<string>();
  for (const match of prompt.matchAll(PLACEHOLDER)) seen.add(match[1]);
  return [...seen];
}

/**
 * Re-derive the variable list from the prompt text while keeping any labels,
 * types and options the author already customised. Variables removed from the
 * prompt drop out; new ones get sensible defaults.
 */
export function syncVariables(prompt: string, existing: PackVariable[] = []): PackVariable[] {
  const byName = new Map(existing.map((variable) => [variable.name, variable]));
  return extractVariableNames(prompt).map((name) => byName.get(name) ?? defaultVariable(name));
}

/** Tolerant of the old string[] format and of anything hand-edited in the DB. */
export function parseVariables(raw: unknown): PackVariable[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): PackVariable[] => {
    if (typeof entry === "string") return [defaultVariable(entry)];
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name : "";
    if (!name) return [];
    const base = defaultVariable(name);
    const type = candidate.type;
    return [
      {
        name,
        label: typeof candidate.label === "string" && candidate.label ? candidate.label : base.label,
        type: type === "text" || type === "textarea" || type === "select" ? type : base.type,
        required: typeof candidate.required === "boolean" ? candidate.required : true,
        placeholder: typeof candidate.placeholder === "string" ? candidate.placeholder : "",
        options: Array.isArray(candidate.options)
          ? candidate.options.filter((option): option is string => typeof option === "string")
          : [],
      },
    ];
  });
}

export type RenderResult = { text: string; missing: string[] };

/**
 * Substitute values into the template. Missing required values are reported
 * rather than thrown so the caller can show every problem at once; optional
 * blanks collapse to an empty string.
 */
export function renderPrompt(
  prompt: string,
  variables: PackVariable[],
  values: Record<string, string>,
): RenderResult {
  const spec = new Map(variables.map((variable) => [variable.name, variable]));
  const missing: string[] = [];
  const text = prompt.replace(PLACEHOLDER, (_match, name: string) => {
    const value = (values[name] ?? "").trim();
    if (value) return value;
    const variable = spec.get(name);
    // Unknown placeholders are treated as required: silently blanking them is
    // how you end up with a prompt that says "write about ." and a bad answer.
    if (!variable || variable.required) missing.push(name);
    return "";
  });
  return { text, missing: [...new Set(missing)] };
}

/** A short, human-readable label for a run, derived from its first real line. */
export function runTitle(output: string, fallback: string): string {
  const line = output
    .split("\n")
    .map((entry) => entry.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim())
    .find((entry) => entry.length > 0);
  if (!line) return fallback;
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}
