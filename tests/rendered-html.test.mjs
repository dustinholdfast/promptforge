import assert from "node:assert/strict";
import test from "node:test";

test("PromptForge ships its product surface and capability routes", async () => {
  const page = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../app/prompt-forge-app.tsx", import.meta.url), "utf8"));
  const hosting = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"));
  assert.match(page, /Skip the prompting/);
  assert.match(page, /Creator studio/);
  assert.match(page, /Generate output/);
  assert.match(hosting, /"d1": "DB"/);
});
