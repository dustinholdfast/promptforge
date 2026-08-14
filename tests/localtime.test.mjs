import assert from "node:assert/strict";
import test from "node:test";
import { toIso } from "../lib/time.ts";

test("SQLite's timezone-less timestamp is read as UTC, not local", () => {
  // The bug this prevents: new Date("2026-08-14 10:29:18") is local time.
  assert.equal(toIso("2026-08-14 10:29:18"), "2026-08-14T10:29:18.000Z");
});

test("already-ISO values pass through unchanged", () => {
  assert.equal(toIso("2026-08-14T10:29:18.000Z"), "2026-08-14T10:29:18.000Z");
  assert.equal(toIso("2026-08-14T06:29:18-04:00"), "2026-08-14T10:29:18.000Z");
});

test("garbage never throws", () => {
  assert.equal(toIso(""), "1970-01-01T00:00:00.000Z");
  assert.equal(toIso("not a date"), "1970-01-01T00:00:00.000Z");
});

test("utcLabel renders a locale-independent instant for the server", async () => {
  const { utcLabel } = await import("../lib/time.ts");
  assert.equal(utcLabel("2026-08-14T10:29:18.000Z"), "2026-08-14 10:29 UTC");
});
