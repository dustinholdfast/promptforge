import { env } from "cloudflare:workers";

/**
 * Secrets live in `.dev.vars` locally and in Worker secrets in production.
 * Nothing here ever reaches the client — these helpers are server-only.
 */
export function envString(key: string): string {
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

export function hasEnv(key: string): boolean {
  return envString(key).length > 0;
}
