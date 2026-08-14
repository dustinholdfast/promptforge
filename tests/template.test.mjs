import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultVariable,
  extractVariableNames,
  humanise,
  parseVariables,
  renderPrompt,
  runTitle,
  syncVariables,
} from "../lib/template.ts";

test("extracts placeholder names in order, de-duplicated", () => {
  const names = extractVariableNames("Hi {{name}}, about {{topic}} — {{ name }} again");
  assert.deepEqual(names, ["name", "topic"]);
});

test("ignores malformed and non-identifier placeholders", () => {
  assert.deepEqual(extractVariableNames("{{ }} {{1bad}} {{good_one}} {not_this}"), ["good_one"]);
});

test("humanise turns identifiers into labels", () => {
  assert.equal(humanise("destination_and_dates"), "Destination and dates");
  assert.equal(humanise("client-profile"), "Client profile");
});

test("long-form names default to a textarea", () => {
  assert.equal(defaultVariable("context").type, "textarea");
  assert.equal(defaultVariable("client").type, "text");
});

test("syncVariables keeps customised metadata and drops removed placeholders", () => {
  const existing = [
    { name: "topic", label: "Custom label", type: "select", required: false, placeholder: "", options: ["a"] },
    { name: "gone", label: "Gone", type: "text", required: true, placeholder: "", options: [] },
  ];
  const synced = syncVariables("About {{topic}} for {{audience}}", existing);
  assert.deepEqual(
    synced.map((v) => v.name),
    ["topic", "audience"],
  );
  assert.equal(synced[0].label, "Custom label");
  assert.equal(synced[0].type, "select");
  assert.equal(synced[1].label, "Audience");
});

test("parseVariables accepts the legacy string[] format", () => {
  const parsed = parseVariables(JSON.stringify(["company", "persona"]));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, "company");
  assert.equal(parsed[0].required, true);
});

test("parseVariables survives garbage without throwing", () => {
  assert.deepEqual(parseVariables("not json"), []);
  assert.deepEqual(parseVariables(null), []);
  assert.deepEqual(parseVariables([{ nope: 1 }]), []);
});

test("renderPrompt substitutes values", () => {
  const variables = syncVariables("Write about {{topic}} for {{audience}}");
  const { text, missing } = renderPrompt("Write about {{topic}} for {{audience}}", variables, {
    topic: "CMMC",
    audience: "an owner",
  });
  assert.equal(text, "Write about CMMC for an owner");
  assert.deepEqual(missing, []);
});

test("renderPrompt reports every missing required value at once", () => {
  const prompt = "{{a}} and {{b}} and {{c}}";
  const variables = syncVariables(prompt).map((v) => (v.name === "c" ? { ...v, required: false } : v));
  const { missing } = renderPrompt(prompt, variables, { a: "  " });
  assert.deepEqual(missing, ["a", "b"]);
});

test("renderPrompt treats unknown placeholders as required", () => {
  const { missing } = renderPrompt("{{surprise}}", [], {});
  assert.deepEqual(missing, ["surprise"]);
});

test("optional blanks collapse to empty string", () => {
  const variables = [{ name: "x", label: "X", type: "text", required: false, placeholder: "", options: [] }];
  const { text, missing } = renderPrompt("[{{x}}]", variables, {});
  assert.equal(text, "[]");
  assert.deepEqual(missing, []);
});

test("runTitle uses the first meaningful line", () => {
  assert.equal(runTitle("\n\n# **A sharper angle**\nbody", "fallback"), "A sharper angle");
  assert.equal(runTitle("   ", "fallback"), "fallback");
  assert.equal(runTitle("x".repeat(200), "fallback").length, 88);
  assert.ok(runTitle("x".repeat(200), "fallback").endsWith("…"));
});
