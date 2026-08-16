import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeGoogle,
  readErrorMessage,
  sseEvents,
} from "../lib/providers.ts";

const encoder = new TextEncoder();
const chunks = (...parts) => ({
  async *[Symbol.asyncIterator]() {
    for (const part of parts) yield encoder.encode(part);
  },
});
const collect = async (source) => {
  const out = [];
  for await (const event of sseEvents(source)) out.push(event);
  return out;
};

test("parses events split across arbitrary chunk boundaries", async () => {
  const events = await collect(chunks("data: {\"a\":", "1}\n\ndata: {\"b\":2}\n", "\n"));
  assert.deepEqual(events, [
    { event: "message", data: '{"a":1}' },
    { event: "message", data: '{"b":2}' },
  ]);
});

test("honours named events and CRLF line endings", async () => {
  const events = await collect(chunks("event: ping\r\ndata: hi\r\n\r\n"));
  assert.deepEqual(events, [{ event: "ping", data: "hi" }]);
});

test("joins multi-line data fields and skips comments", async () => {
  const events = await collect(chunks(": keep-alive\ndata: one\ndata: two\n\n"));
  assert.deepEqual(events, [{ event: "message", data: "one\ntwo" }]);
});

test("emits a trailing record with no terminating blank line", async () => {
  const events = await collect(chunks("data: [DONE]"));
  assert.deepEqual(events, [{ event: "message", data: "[DONE]" }]);
});

test("multi-byte characters survive chunk splits", async () => {
  const bytes = encoder.encode("data: {\"t\":\"é✦\"}\n\n");
  const source = {
    async *[Symbol.asyncIterator]() {
      for (const byte of bytes) yield new Uint8Array([byte]); // worst case: one byte at a time
    },
  };
  const events = await collect(source);
  assert.deepEqual(events, [{ event: "message", data: '{"t":"é✦"}' }]);
});

test("google: nested parts and usage metadata", () => {
  assert.deepEqual(
    decodeGoogle({ candidates: [{ content: { parts: [{ text: "A" }, { text: "B" }] } }] }),
    [
      { type: "text", text: "A" },
      { type: "text", text: "B" },
    ],
  );
  assert.deepEqual(decodeGoogle({ usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 7 } }), [
    { type: "usage", inputTokens: 3, outputTokens: 7 },
  ]);
  assert.deepEqual(decodeGoogle({ candidates: [{ finishReason: "STOP" }] }), []);
});

test("provider error bodies are unwrapped into a readable message", () => {
  assert.equal(readErrorMessage('{"error":{"message":"bad key"}}', 401), "bad key");
  assert.equal(readErrorMessage('{"message":"nope"}', 400), "nope");
  assert.equal(readErrorMessage("plain text failure", 500), "plain text failure");
  assert.equal(readErrorMessage("", 502), "Provider returned HTTP 502");
});
