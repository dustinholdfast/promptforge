import { headers } from "next/headers";
import { getCurrentUser, signupState, type SessionUser } from "../lib/auth";
import { listRuns, loadCatalogue } from "../lib/library";
import Login from "./login";
import PromptForgeApp from "./prompt-forge-app";

// Session state is per-request, so this page can never be statically cached.
export const dynamic = "force-dynamic";

export default async function Home() {
  // getCurrentUser reads cookies and upstream identity headers, so hand it a
  // Request built from this request's headers.
  const request = new Request("https://promptforge.local/", { headers: await headers() });

  let user: SessionUser | null = null;
  let signup = { bootstrap: false, open: false };
  let bootError = "";
  try {
    [user, signup] = await Promise.all([getCurrentUser(request), signupState()]);
  } catch (error) {
    bootError = error instanceof Error ? error.message : "Could not reach the database.";
  }

  if (bootError) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand-mark">PF</div>
          <h1>PromptForge can&rsquo;t start</h1>
          <p className="auth-lede">{bootError}</p>
          <p className="auth-switch muted">
            Check that the D1 binding <code>DB</code> is configured, then restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  if (!user) return <Login bootstrap={signup.bootstrap} open={signup.open} />;

  // Load the library on the server so the app has data on first paint.
  const [catalogue, initialRuns] = await Promise.all([loadCatalogue(user), listRuns(user.id)]);
  return <PromptForgeApp catalogue={catalogue} initialRuns={initialRuns} />;
}
