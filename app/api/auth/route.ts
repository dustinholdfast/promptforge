import {
  HttpError,
  SESSION_COOKIE,
  clearedCookie,
  createSession,
  destroySession,
  getCurrentUser,
  readCookie,
  sessionCookie,
  signIn,
  signUp,
  signupState,
} from "../../../lib/auth";
import { checkPassword } from "../../../lib/password";
import { errorResponse, json, readJson, str } from "../../../lib/http";

/** Who am I, and is signup available? Drives the login screen. */
export async function GET(request: Request) {
  try {
    const [user, state] = await Promise.all([getCurrentUser(request), signupState()]);
    return json({ user, signup: state });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const action = str(body.action);

    if (action === "logout") {
      const token = readCookie(request, SESSION_COOKIE);
      if (token) await destroySession(token);
      return json({ ok: true }, { headers: { "set-cookie": clearedCookie(request) } });
    }

    if (action === "signup") {
      const password = str(body.password);
      const problem = checkPassword(password);
      if (problem) throw new HttpError(problem, 400);
      const user = await signUp({
        email: str(body.email),
        name: str(body.name),
        password,
        inviteCode: str(body.inviteCode),
      });
      const { token, maxAgeSeconds } = await createSession(user.id);
      return json(
        { user },
        { status: 201, headers: { "set-cookie": sessionCookie(request, token, maxAgeSeconds) } },
      );
    }

    if (action === "login") {
      const user = await signIn(str(body.email), str(body.password));
      const { token, maxAgeSeconds } = await createSession(user.id);
      return json({ user }, { headers: { "set-cookie": sessionCookie(request, token, maxAgeSeconds) } });
    }

    throw new HttpError("Unsupported action.", 400);
  } catch (error) {
    return errorResponse(error);
  }
}
