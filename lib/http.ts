import { HttpError } from "./auth";
import { ProviderError } from "./providers";

export const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
  if (error instanceof ProviderError) {
    return json({ error: error.message, provider: error.provider }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Something went wrong.";
  // Server-side visibility: these show up in `wrangler tail`.
  console.error("PromptForge request failed:", error);
  return json({ error: message }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new HttpError("Expected a JSON body.", 400);
  }
}

export const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
export const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
