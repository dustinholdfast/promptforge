/**
 * Password hashing on WebCrypto only — no native modules, so it runs the same
 * on Cloudflare Workers and in `node --test`.
 *
 * Format: pbkdf2$<iterations>$<salt-b64>$<hash-b64>
 */

// OWASP's floor for PBKDF2-HMAC-SHA256. This costs ~100ms of CPU per login.
// If you deploy to the Workers *free* plan and see CPU-limit errors on sign-in,
// lower this — and re-hash existing passwords, since the count is stored per hash.
const ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Constant-time comparison — never short-circuit on the first differing byte. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const rounds = Number(iterations);
  if (!Number.isInteger(rounds) || rounds < 1000 || rounds > 5_000_000) return false;
  try {
    const candidate = await derive(password, fromBase64(salt), rounds);
    return timingSafeEqual(candidate, fromBase64(hash));
  } catch {
    return false;
  }
}

export type PasswordProblem = string | null;

export function checkPassword(password: string): PasswordProblem {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
