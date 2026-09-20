"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      if (!data.session) {
        setError("Account created, but email confirmation is still turned on for this project. Disable it in Supabase (Authentication > Providers > Email) or check your inbox to confirm.");
        setBusy(false);
        return;
      }
      window.location.href = "/";
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="authwrap">
      <div className="authcard">
        <h1>Manifest</h1>
        <p className="hint">
          {mode === "signup" ? "Create an account with an email and password." : "Log in with your email and password."}
        </p>
        <form onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </label>
          {error && <p className="note" style={{ color: "var(--red)" }}>{error}</p>}
          <button className="btn" disabled={busy} type="submit">
            {busy ? "…" : mode === "signup" ? "Create account" : "Log in"}
          </button>
        </form>
        <p className="note">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button className="textbtn" style={{ textAlign: "left", display: "inline", minHeight: "auto" }} onClick={() => { setMode("login"); setError(null); }}>
                Log in
              </button>
            </>
          ) : (
            <>
              Need an account?{" "}
              <button className="textbtn" style={{ textAlign: "left", display: "inline", minHeight: "auto" }} onClick={() => { setMode("signup"); setError(null); }}>
                Sign up
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
