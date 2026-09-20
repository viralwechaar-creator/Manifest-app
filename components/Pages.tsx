"use client";

import { useState } from "react";
import { CoachReply, Step } from "@/lib/types";

type DataApi = ReturnType<typeof import("@/lib/useManifestData").useManifestData>;

type PartialReply = Partial<CoachReply> & { reply: string };
function shellReply(text: string): PartialReply {
  return { reply: text };
}

function PrincipleLine({ p }: { p: { name: string; chapter: string; why_it_applies: string } }) {
  return (
    <p className="principle">
      <b>{p.name}</b> — {p.chapter}. {p.why_it_applies}
    </p>
  );
}

function CoachReplyBubble({ reply }: { reply: PartialReply }) {
  return (
    <div className="bubble coach">
      <div>{reply.reply}</div>
      {reply.mind_practice?.practice && reply.mind_practice.practice !== "Other" && (
        <p className="principle">
          <b>Try:</b> {reply.mind_practice.practice} ({reply.mind_practice.minutes} min) — {reply.mind_practice.instructions}
        </p>
      )}
      {reply.book_principles?.map((p, i) => (
        <PrincipleLine key={i} p={p} />
      ))}
      {reply.follow_up_question && <p className="principle">{reply.follow_up_question}</p>}
    </div>
  );
}

export function IntakePage({ data }: { data: DataApi }) {
  const [text, setText] = useState("");
  const [log, setLog] = useState<{ role: "user" | "coach"; content: string; reply?: PartialReply }[]>([]);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!text.trim() || busy) return;
    const msg = text.trim();
    setLog((l) => [...l, { role: "user", content: msg }]);
    setText("");
    setBusy(true);
    try {
      const reply = await data.sendCoachMessage("intake", msg);
      setLog((l) => [...l, { role: "coach", content: reply.reply, reply }]);
    } catch (e: any) {
      setLog((l) => [...l, { role: "coach", content: `Something went wrong: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <h2 className="gap">Let's talk.</h2>
      {log.length === 0 && (
        <p className="hint">
          Tell me what's going on and where you want to get to. I'll ask a couple of questions, then build you a real plan —
          goal, milestones, this week, and three things to do today.
        </p>
      )}
      <div className="chatlog">
        {log.map((m, i) =>
          m.role === "user" ? (
            <div className="bubble user" key={i}>
              {m.content}
            </div>
          ) : (
            <CoachReplyBubble key={i} reply={m.reply || shellReply(m.content)} />
          )
        )}
      </div>
      <div className="chatinput">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's on your mind, and what do you want instead?"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn" disabled={busy} onClick={send}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </section>
  );
}

export function PlanPage({ data }: { data: DataApi }) {
  const { goal, milestones, steps, today } = data;
  const weekSteps = steps.filter((s) => s.status !== "done" && s.status !== "skipped" && s.scheduled_for !== today);
  const todaySteps = steps.filter((s) => s.scheduled_for === today || s.status === "done");

  return (
    <section className="page">
      <h2 className="gap">Your plan.</h2>
      {!goal ? (
        <p className="empty">No active goal yet. Head to Chat and tell the coach what you're working on.</p>
      ) : (
        <>
          <div className="row">
            <div className="lbl">Goal</div>
            <div className="val statement">{goal.title}</div>
          </div>
          {goal.description && (
            <div className="row">
              <div className="lbl">Details</div>
              <div className="val big">{goal.description}</div>
            </div>
          )}
          {goal.target_date && (
            <div className="row">
              <div className="lbl">By</div>
              <div className="val big">{goal.target_date}</div>
            </div>
          )}

          <h3 className="sub">Milestones</h3>
          {milestones.length === 0 && <p className="empty">None yet — these show up once the coach builds your plan.</p>}
          {milestones.map((m) => (
            <div className="entry" key={m.id}>
              <span style={{ textDecoration: m.status === "completed" ? "line-through" : "none", color: m.status === "completed" ? "var(--grey)" : "inherit" }}>{m.title}</span>
            </div>
          ))}

          <h3 className="sub">This week</h3>
          {weekSteps.length === 0 && <p className="empty">Nothing queued for the week yet.</p>}
          {weekSteps.map((s) => (
            <StepRow key={s.id} step={s} data={data} />
          ))}

          <h3 className="sub">Today</h3>
          {todaySteps.length === 0 && <p className="empty">Nothing queued for today yet.</p>}
          {todaySteps.map((s) => (
            <StepRow key={s.id} step={s} data={data} />
          ))}
        </>
      )}
    </section>
  );
}

function StepRow({ step, data }: { step: Step; data: DataApi }) {
  const done = step.status === "done";
  return (
    <div className="taskrow">
      <label className="task">
        <input type="checkbox" checked={done} onChange={() => data.toggleStep(step)} />
        <span className="box" />
        <span>
          <span className="t">{step.title}</span>
          <span className="meta">
            {step.minutes ? `${step.minutes} min` : ""}
            {step.done_when ? ` · done when: ${step.done_when}` : ""}
          </span>
        </span>
      </label>
    </div>
  );
}

export function DailyPage({ data }: { data: DataApi }) {
  const todaySteps = data.steps.filter((s) => s.scheduled_for === data.today || s.status === "done");
  const [text, setText] = useState("");
  const [reply, setReply] = useState<PartialReply | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await data.sendCoachMessage("checkin", text.trim());
      setReply(r);
      setText("");
    } catch (e: any) {
      setReply(shellReply(`Something went wrong: ${e.message}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <h2 className="gap">Today.</h2>

      <p className="hint" style={{ marginBottom: 20 }}>
        Streak: {data.streak} day{data.streak === 1 ? "" : "s"}
      </p>

      <div className="listhead">
        <span>Steps</span>
        <span>
          {todaySteps.filter((s) => s.status === "done").length}/{todaySteps.length}
        </span>
      </div>
      {todaySteps.length === 0 && <p className="empty">No steps for today yet — chat with the coach or check your Plan.</p>}
      {todaySteps.map((s) => (
        <StepRow key={s.id} step={s} data={data} />
      ))}
      <AddTask data={data} bucket="today" />

      <div className="panel">
        <h3>How did it go?</h3>
        <p>Tell the coach what you did, what got in the way, and how you feel. It'll adjust tomorrow's steps.</p>
        <textarea
          style={{ color: "var(--paper)", borderBottomColor: "var(--paper)", marginTop: 14 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Did the first two, got stuck calling the supplier, feeling a bit flat."
        />
        <button className="btn" disabled={busy} onClick={send}>
          {busy ? "Thinking…" : "Check in"}
        </button>
      </div>

      {reply && (
        <div className="result">
          <CoachReplyBubble reply={reply} />
        </div>
      )}
    </section>
  );
}

function AddTask({ data, bucket }: { data: DataApi; bucket: "today" | "week" }) {
  const [v, setV] = useState("");
  function submit() {
    if (v.trim()) {
      data.addUserStep(v.trim(), bucket);
      setV("");
    }
  }
  return (
    <div className="addrow addtask">
      <input
        type="text"
        placeholder={`Add your own ${bucket === "today" ? "today" : "week"} step`}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button className="btn small ghost" onClick={submit}>
        Add
      </button>
    </div>
  );
}

export function MindScanPage({ data }: { data: DataApi }) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState<PartialReply | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await data.sendCoachMessage("mindscan", text.trim());
      setReply(r);
      setText("");
    } catch (e: any) {
      setReply(shellReply(`Something went wrong: ${e.message}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <h2 className="gap">Mind scan.</h2>
      <p className="hint">
        Write freely about what's bothering you. The coach reads your own words for a limiting belief, and gives you one
        believable replacement plus one small action — never a belief you didn't actually express.
      </p>
      <div className="chatinput" style={{ marginBottom: 20 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="I keep telling myself…" />
        <button className="btn" disabled={busy} onClick={send}>
          {busy ? "…" : "Scan"}
        </button>
      </div>

      {reply && (
        <div className="result">
          <CoachReplyBubble reply={reply} />
          {reply.beliefs_detected?.length === 0 && <p className="note">No clear limiting belief found in that — which is good.</p>}
        </div>
      )}

      <h3 className="sub">Beliefs on file</h3>
      {data.beliefs.length === 0 && <p className="empty">None detected yet.</p>}
      {data.beliefs.map((b) => (
        <div className="scanrow" key={b.id}>
          <div className="scantop">
            <span>{b.original_text}</span>
          </div>
          {b.replacement_text && <p className="fix">→ {b.replacement_text}</p>}
          {b.action_text && <p className="note">{b.action_text}</p>}
        </div>
      ))}
    </section>
  );
}

export function GratitudePage({ data }: { data: DataApi }) {
  const [g, setG] = useState("");
  const [a, setA] = useState("");

  return (
    <section className="page">
      <h2 className="gap">Gratitude.</h2>
      <div className="addrow">
        <input
          type="text"
          placeholder="Something you're genuinely thankful for"
          value={g}
          onChange={(e) => setG(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && g.trim()) {
              data.addGratitude(g);
              setG("");
            }
          }}
        />
        <button
          className="btn small"
          onClick={() => {
            if (g.trim()) {
              data.addGratitude(g);
              setG("");
            }
          }}
        >
          Add
        </button>
      </div>
      {data.gratitude.length === 0 && <p className="empty" style={{ marginTop: 20 }}>Nothing yet — start with one small thing.</p>}
      {data.gratitude.map((entry) => (
        <div className="entry" key={entry.id}>
          <span>{entry.text}</span>
          <button className="x" onClick={() => data.deleteGratitude(entry.id)} aria-label="Remove">
            ×
          </button>
        </div>
      ))}

      <h3 className="sub">Affirmations</h3>
      <div className="addrow">
        <input
          type="text"
          placeholder="A present-tense statement of what you want"
          value={a}
          onChange={(e) => setA(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && a.trim()) {
              data.addAffirmation(a);
              setA("");
            }
          }}
        />
        <button
          className="btn small"
          onClick={() => {
            if (a.trim()) {
              data.addAffirmation(a);
              setA("");
            }
          }}
        >
          Add
        </button>
      </div>
      {data.affirmations.length === 0 && <p className="empty" style={{ marginTop: 20 }}>None yet.</p>}
      {data.affirmations.map((entry) => (
        <div className="entry" key={entry.id}>
          <span>{entry.text}</span>
          <button className="x" onClick={() => data.deleteAffirmation(entry.id)} aria-label="Remove">
            ×
          </button>
        </div>
      ))}
    </section>
  );
}

export function ProgressPage({ data }: { data: DataApi }) {
  const allSteps = data.steps;
  const doneCount = allSteps.filter((s) => s.status === "done").length;
  const total = allSteps.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const doneMilestones = data.milestones.filter((m) => m.status === "completed").length;

  return (
    <section className="page">
      <h2 className="gap">Progress.</h2>
      <div className="bignum">
        <b>{data.streak}</b>
        <span>day streak</span>
      </div>
      <div className="spec">
        <dt>Steps completed</dt>
        <dd>
          {doneCount}/{total} ({pct}%)
        </dd>
      </div>
      <div className="spec">
        <dt>Milestones done</dt>
        <dd>
          {doneMilestones}/{data.milestones.length}
        </dd>
      </div>
      <div className="spec">
        <dt>Check-ins logged</dt>
        <dd>{data.checkins.length}</dd>
      </div>
      <div className="spec">
        <dt>Beliefs being worked on</dt>
        <dd>{data.beliefs.length}</dd>
      </div>
      <div className="spec">
        <dt>Gratitude entries</dt>
        <dd>{data.gratitude.length}</dd>
      </div>

      <h3 className="sub">Recent check-ins</h3>
      {data.checkins.length === 0 && <p className="empty">None yet.</p>}
      {data.checkins.map((c) => (
        <div className="row" key={c.id}>
          <div className="lbl">{c.checkin_date}</div>
          <div className="val">
            <p>{c.done_text}</p>
          </div>
        </div>
      ))}
    </section>
  );
}

export function SettingsPage({ data, email, onSignOut }: { data: DataApi; email: string | null; onSignOut: () => void }) {
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function doImport(file: File) {
    setImporting(true);
    setMsg(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "Import failed");
      setMsg("Restore complete.");
      data.reload();
    } catch (e: any) {
      setMsg(`Import failed: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="page">
      <h2 className="gap">Settings.</h2>

      <div className="firstrun">
        <h3>Signed in as</h3>
        <p>{email || "…"}</p>
      </div>

      <h3 className="sub">Backup</h3>
      <p className="backup-note">
        Your data lives in your own Supabase project. You can also export a full JSON copy any time, and restore it later or
        on another device.
      </p>
      <div className="actions">
        <a className="btn" href="/api/export">
          Export JSON
        </a>
        <label className="btn ghost" style={{ cursor: "pointer" }}>
          {importing ? "Restoring…" : "Restore from file"}
          <input
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doImport(f);
            }}
          />
        </label>
      </div>
      {msg && <p className="note">{msg}</p>}

      <h3 className="sub">Account</h3>
      <button className="btn ghost" onClick={onSignOut}>
        Sign out
      </button>

      <h3 className="sub">About</h3>
      <p className="note">
        Manifest presents the method in <i>The Secret</i> as "the book's method" — a mindset framework, not a guarantee of
        outcomes — paired with concrete real-world actions. It never advises stopping medical treatment, never gives
        investment advice, and steps back from coaching if you mention crisis or self-harm.
      </p>
    </section>
  );
}
