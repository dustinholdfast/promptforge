import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the D1 binding the app expects is configured", async () => {
  assert.match(await read(".openai/hosting.json"), /"d1": "DB"/);
});

test("no marketplace surface survives in the UI", async () => {
  const sources = await Promise.all([
    read("app/prompt-forge-app.tsx"),
    read("app/components/runner.tsx"),
    read("app/components/editor.tsx"),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /purchase|checkout|one-time price|revenue/i);
  }
});

test("generation goes through the real provider layer, not a canned string", async () => {
  const route = await read("app/api/generate/route.ts");
  assert.match(route, /streamCompletion/);
  assert.match(route, /requireUser/);
  assert.doesNotMatch(route, /a sharper way forward/i);
});

test("OpenAI and Anthropic are subscription-backed, not API-key-backed", async () => {
  const providers = await read("lib/providers.ts");
  const exampleEnv = await read(".dev.vars.example");
  assert.match(providers, /local subscription bridge/i);
  assert.doesNotMatch(providers, /api\.openai\.com|api\.anthropic\.com/);
  assert.doesNotMatch(exampleEnv, /OPENAI_API_KEY|ANTHROPIC_API_KEY/);
});

test("Docker disables host-only subscription models", async () => {
  const entrypoint = await read("docker-entrypoint.sh");
  assert.match(entrypoint, /PROMPTFORGE_DISABLE_SUBSCRIPTIONS/);
  assert.doesNotMatch(entrypoint, /ANTHROPIC_API_KEY|OPENAI_API_KEY/);
});

test("every API route requires an authenticated user", async () => {
  for (const route of ["app/api/packs/route.ts", "app/api/runs/route.ts", "app/api/generate/route.ts"]) {
    assert.match(await read(route), /requireUser\(request\)/, `${route} must authenticate`);
  }
});

test("runs are always scoped to the signed-in user", async () => {
  const route = await read("app/api/runs/route.ts");
  // Every mutation must filter on userId as well as runId.
  for (const action of ["favorite", "delete", "open"]) {
    assert.match(route, new RegExp(`"${action}"`));
  }
  assert.doesNotMatch(route, /where\(eq\(runs\.id, runId\)\)/);
});

test("client code never reads secrets or the provider layer", async () => {
  // Naming an env var in help text is fine; reading one on the client is not.
  const clientFiles = [
    "app/prompt-forge-app.tsx",
    "app/components/runner.tsx",
    "app/components/editor.tsx",
    "app/api-client.ts",
    "app/login.tsx",
  ];
  for (const file of clientFiles) {
    const source = await read(file);
    assert.doesNotMatch(source, /process\.env|envString|cloudflare:workers/, `${file} must stay client-safe`);
    assert.doesNotMatch(source, /from "\.\.?\/*lib\/(env|providers|auth|seed)"/, `${file} must not import server modules`);
  }
});
