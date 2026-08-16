import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodexPrompt,
  decodeClaudeLine,
  decodeCodexLine,
  mapCliModel,
} from "../local/subscription-bridge.mjs";

test("maps stored catalogue ids to subscription CLI model names", () => {
  assert.equal(mapCliModel("openai", "gpt-5.6"), "gpt-5.6-sol");
  assert.equal(mapCliModel("openai", "gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(mapCliModel("anthropic", "claude-sonnet-5"), "sonnet");
  assert.equal(mapCliModel("anthropic", "claude-opus-5"), "opus");
});

test("Codex JSONL normalizes final text and usage", () => {
  assert.deepEqual(
    decodeCodexLine({ type: "item.completed", item: { type: "agent_message", text: "Hello" } }),
    [{ type: "text", text: "Hello" }],
  );
  assert.deepEqual(
    decodeCodexLine({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 7 } }),
    [{ type: "usage", inputTokens: 12, outputTokens: 7 }],
  );
  assert.throws(() => decodeCodexLine({ type: "error", message: "not logged in" }), /not logged in/);
});

test("Claude stream JSON normalizes text deltas and result usage", () => {
  assert.deepEqual(
    decodeClaudeLine({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
    }),
    [{ type: "text", text: "Hi" }],
  );
  assert.deepEqual(
    decodeClaudeLine({ type: "result", subtype: "success", usage: { input_tokens: 9, output_tokens: 4 } }),
    [{ type: "usage", inputTokens: 9, outputTokens: 4 }],
  );
  assert.deepEqual(
    decodeClaudeLine({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hidden" } },
    }),
    [],
  );
});

test("Codex prompt preserves system and user boundaries", () => {
  const prompt = buildCodexPrompt("Be concise.", "Write a summary.", 800);
  assert.match(prompt, /<system_instructions>\nBe concise\./);
  assert.match(prompt, /<user_prompt>\nWrite a summary\./);
  assert.match(prompt, /800 output tokens/);
});
