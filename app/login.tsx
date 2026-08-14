"use client";

import { useState } from "react";
import { api } from "./api-client";

type Props = { bootstrap: boolean; open: boolean };

export default function Login({ bootstrap, open }: Props) {
  const [mode, setMode] = useState<"login" | "signup">(bootstrap ? "signup" : "login");
  const [form, setForm] = useState({ email: "", password: "", name: "", inviteCode: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth", { action: mode, ...form });
      // Reload so the server component picks up the new session cookie.
      window.location.reload();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-mark">PF</div>
        <h1>PromptForge</h1>
        <p className="auth-lede">
          {bootstrap
            ? "No accounts yet. The first one you create is the owner."
            : mode === "signup"
              ? "You'll need the invite code from the owner."
              : "Your shared prompt library."}
        </p>

        {mode === "signup" && (
          <label>
            <span>Name</span>
            <input value={form.name} onChange={set("name")} autoComplete="name" placeholder="Dustin" />
          </label>
        )}

        <label>
          <span>Email</span>
          <input
            type="email"
            required
            value={form.email}
            onChange={set("email")}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>

        <label>
          <span>Password</span>
          <input
            type="password"
            required
            value={form.password}
            onChange={set("password")}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder={mode === "signup" ? "At least 12 characters" : ""}
          />
        </label>

        {mode === "signup" && !bootstrap && (
          <label>
            <span>Invite code</span>
            <input value={form.inviteCode} onChange={set("inviteCode")} placeholder="From the owner" />
          </label>
        )}

        {error && <p className="auth-error">{error}</p>}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>

        {!bootstrap && (
          <p className="auth-switch">
            {mode === "login" ? (
              open ? (
                <>
                  Have an invite?{" "}
                  <button type="button" onClick={() => setMode("signup")}>
                    Create an account
                  </button>
                </>
              ) : (
                <span className="muted">Signup is closed. Ask the owner for an account.</span>
              )
            ) : (
              <>
                Already set up?{" "}
                <button type="button" onClick={() => setMode("login")}>
                  Sign in
                </button>
              </>
            )}
          </p>
        )}
      </form>
    </div>
  );
}
