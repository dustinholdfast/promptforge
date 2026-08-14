import assert from "node:assert/strict";
import test from "node:test";
import {
  checkPassword,
  hashPassword,
  isEmail,
  normaliseEmail,
  timingSafeEqual,
  verifyPassword,
} from "../lib/password.ts";

test("a hash verifies against its own password and nothing else", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.match(hash, /^pbkdf2\$\d+\$[\w+/=]+\$[\w+/=]+$/);
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("Correct horse battery staple", hash), false);
});

test("each hash uses a fresh salt", async () => {
  const [a, b] = await Promise.all([hashPassword("same password here"), hashPassword("same password here")]);
  assert.notEqual(a, b);
});

test("malformed or absent hashes never verify", async () => {
  for (const stored of [null, "", "notahash", "pbkdf2$abc$x$y", "pbkdf2$10$c2FsdA==$aGFzaA=="]) {
    assert.equal(await verifyPassword("anything at all", stored), false);
  }
});

test("timingSafeEqual compares by value and length", () => {
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});

test("password policy", () => {
  assert.ok(checkPassword("short"));
  assert.equal(checkPassword("twelve chars ok"), null);
  assert.ok(checkPassword("x".repeat(201)));
});

test("email normalisation and validation", () => {
  assert.equal(normaliseEmail("  Dustin@Example.COM "), "dustin@example.com");
  assert.equal(isEmail("dustin@example.com"), true);
  assert.equal(isEmail("nope"), false);
  assert.equal(isEmail("a@b"), false);
});
