import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { ensureDatabase } from "../db/ensure";
import { sessions, users } from "../db/schema";
import { envString } from "./env";
import { hashPassword, isEmail, normaliseEmail, verifyPassword } from "./password";

export const SESSION_COOKIE = "pf_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "member";
};

/* ------------------------------------------------------------------ *
 * Cookies
 * ------------------------------------------------------------------ */

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function isSecureRequest(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return new URL(request.url).protocol === "https:";
}

export function sessionCookie(request: Request, token: string, maxAgeSeconds: number): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  // Secure would make the cookie unusable over plain http://localhost.
  if (isSecureRequest(request)) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearedCookie(request: Request): string {
  return sessionCookie(request, "", 0);
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export async function createSession(userId: string): Promise<{ token: string; maxAgeSeconds: number }> {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const db = getDb();
  await db.insert(sessions).values({ tokenHash: await sha256(token), userId, expiresAt });
  // Opportunistic cleanup; cheap and keeps the table from growing forever.
  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
  return { token, maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000) };
}

export async function destroySession(token: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.tokenHash, await sha256(token)));
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

const toSessionUser = (row: typeof users.$inferSelect): SessionUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role === "owner" ? "owner" : "member",
});

async function firstUserRole(): Promise<"owner" | "member"> {
  const [{ count }] = await getDb().select({ count: sql<number>`count(*)` }).from(users);
  return Number(count) === 0 ? "owner" : "member";
}

/**
 * When PromptForge is hosted on OpenAI's app platform the proxy injects a
 * verified identity. Trust it, and mirror the account locally so packs and runs
 * have a stable owner id either way.
 */
async function userFromUpstreamHeaders(request: Request): Promise<SessionUser | null> {
  const upstreamId = request.headers.get("oai-authenticated-user-id");
  const upstreamEmail = request.headers.get("oai-authenticated-user-email");
  if (!upstreamId || !upstreamEmail) return null;

  const email = normaliseEmail(upstreamEmail);
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) return toSessionUser(existing);

  const [created] = await db
    .insert(users)
    .values({
      id: `oai_${upstreamId}`,
      email,
      name: request.headers.get("oai-authenticated-user-full-name") ?? email.split("@")[0],
      passwordHash: null,
      role: await firstUserRole(),
    })
    .returning();
  return toSessionUser(created);
}

export async function getCurrentUser(request: Request): Promise<SessionUser | null> {
  await ensureDatabase();

  const upstream = await userFromUpstreamHeaders(request);
  if (upstream) return upstream;

  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const [row] = await getDb()
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, await sha256(token)))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    await destroySession(token);
    return null;
  }
  return toSessionUser(row.user);
}

export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getCurrentUser(request);
  if (!user) throw new HttpError("Sign in to continue.", 401);
  return user;
}

/* ------------------------------------------------------------------ *
 * Sign up / sign in
 * ------------------------------------------------------------------ */

export type SignupState = {
  /** True until the very first account exists — that signup needs no invite. */
  bootstrap: boolean;
  /** False when signup is closed: no invite code configured and an owner exists. */
  open: boolean;
};

export async function signupState(): Promise<SignupState> {
  await ensureDatabase();
  const [{ count }] = await getDb().select({ count: sql<number>`count(*)` }).from(users);
  const bootstrap = Number(count) === 0;
  return { bootstrap, open: bootstrap || envString("SIGNUP_INVITE_CODE").length > 0 };
}

export async function signUp(input: {
  email: string;
  name: string;
  password: string;
  inviteCode: string;
}): Promise<SessionUser> {
  const email = normaliseEmail(input.email);
  if (!isEmail(email)) throw new HttpError("Enter a valid email address.", 400);

  const state = await signupState();
  if (!state.open) throw new HttpError("Signup is closed. Ask the owner to set an invite code.", 403);
  if (!state.bootstrap) {
    const expected = envString("SIGNUP_INVITE_CODE");
    if (input.inviteCode.trim() !== expected) throw new HttpError("That invite code is not valid.", 403);
  }

  const db = getDb();
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (taken) throw new HttpError("An account already exists for that email.", 409);

  const [created] = await db
    .insert(users)
    .values({
      id: newId("usr"),
      email,
      name: input.name.trim() || email.split("@")[0],
      passwordHash: await hashPassword(input.password),
      role: state.bootstrap ? "owner" : "member",
    })
    .returning();
  return toSessionUser(created);
}

export async function signIn(email: string, password: string): Promise<SessionUser> {
  await ensureDatabase();
  const [row] = await getDb()
    .select()
    .from(users)
    .where(and(eq(users.email, normaliseEmail(email))))
    .limit(1);

  // Always run a verification so a missing account and a wrong password take
  // roughly the same time, and never say which one it was.
  const ok = await verifyPassword(password, row?.passwordHash ?? null);
  if (!row || !ok) throw new HttpError("Email or password is incorrect.", 401);
  return toSessionUser(row);
}
