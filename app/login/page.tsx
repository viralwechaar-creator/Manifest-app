"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined }
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="authwrap">
      <div className="authcard">
        <h1>Manifest</h1>
        <p className="hint">Sign in with your email. We'll send you a magic link — no password to remember.</p>
        {sent ? (
          <p className="statement">Check your inbox for a sign-in link.</p>
        ) : (
          <form onSubmit={sendLink}>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {error && <p className="note" style={{ color: "var(--red)" }}>{error}</p>}
            <button className="btn" disabled={busy} type="submit">
              {busy ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
