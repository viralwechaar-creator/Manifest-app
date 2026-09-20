import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";
import { buildContextBundle } from "@/lib/contextBundle";
import { renderBookContext } from "@/lib/bookKnowledge";
import { COACH_BASE_INSTRUCTIONS, modeFraming } from "@/lib/coachPrompt";
import { callCoach, GeminiUnavailableError } from "@/lib/gemini";
import { detectCrisisLanguage, CRISIS_REPLY, busyReply } from "@/lib/safety";
import { CoachMode, CoachReply } from "@/lib/types";

export async function POST(req: NextRequest) {
  let supabase;
  let user: User;
  let mode: CoachMode;
  let message: string;

  try {
    const body = await req.json();
    mode = body.mode;
    message = body.message;
    const goalOverride = body.goalOverride as
      | { title: string; description?: string; target_date?: string }
      | undefined;

    if (!mode || !message || !["intake", "checkin", "mindscan"].includes(mode)) {
      return NextResponse.json({ error: "mode ('intake'|'checkin'|'mindscan') and message are required" }, { status: 400 });
    }

    supabase = supabaseServer();
    const {
      data: { user: authedUser }
    } = await supabase.auth.getUser();
    if (!authedUser) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    user = authedUser;

    if (detectCrisisLanguage(message)) {
      await supabase.from("chat_messages").insert([
        { user_id: user.id, role: "user", content: message },
        { user_id: user.id, role: "assistant", content: CRISIS_REPLY.reply, metadata: CRISIS_REPLY }
      ]);
      return NextResponse.json(CRISIS_REPLY);
    }

    if (mode === "intake" && goalOverride?.title) {
      await supabase.from("goals").update({ status: "paused" }).eq("user_id", user.id).eq("status", "active");
      await supabase.from("goals").insert({
        user_id: user.id,
        title: goalOverride.title,
        description: goalOverride.description || "",
        target_date: goalOverride.target_date || null,
        status: "active"
      });
    }

    const { bundle, activeGoal, lifeArea } = await buildContextBundle(supabase, user.id, message);
    const playbook = renderBookContext(lifeArea);

    const systemPrompt = [
      COACH_BASE_INSTRUCTIONS,
      "\n" + modeFraming(mode),
      "\n## PLAYBOOK\n" + playbook,
      "\n## CONTEXT\n" + JSON.stringify(bundle, null, 2)
    ].join("\n");

    let coachReply: CoachReply;
    try {
      coachReply = await callCoach(systemPrompt, message);
    } catch (err) {
      if (err instanceof GeminiUnavailableError) {
        const fallback = busyReply();
        await supabase.from("chat_messages").insert([
          { user_id: user.id, goal_id: activeGoal?.id || null, role: "user", content: message },
          { user_id: user.id, goal_id: activeGoal?.id || null, role: "assistant", content: fallback.reply, metadata: { error: true } }
        ]);
        return NextResponse.json(fallback);
      }
      throw err;
    }

    await supabase.from("chat_messages").insert([
      { user_id: user.id, goal_id: activeGoal?.id || null, role: "user", content: message },
      { user_id: user.id, goal_id: activeGoal?.id || null, role: "assistant", content: coachReply.reply, metadata: coachReply }
    ]);

    if (coachReply.safety_flag) {
      return NextResponse.json(coachReply);
    }

    let goalId = activeGoal?.id || null;

    if (mode === "intake" && !goalId && (coachReply.actions?.length || coachReply.milestones?.length)) {
      const { data: newGoal } = await supabase
        .from("goals")
        .insert({ user_id: user.id, title: coachReply.situation_summary || message.slice(0, 120), status: "active" })
        .select()
        .single();
      goalId = newGoal?.id || null;
    }

    if (coachReply.milestones?.length && goalId) {
      const rows = coachReply.milestones
        .filter((m) => typeof m === "string" && m.trim())
        .map((title, i) => ({ user_id: user.id, goal_id: goalId, title, sort_order: i, status: "pending" as const }));
      if (rows.length) await supabase.from("milestones").insert(rows);
    }

    if (coachReply.actions?.length && goalId) {
      const today = new Date().toISOString().slice(0, 10);
      const rows = coachReply.actions.map((a) => ({
        user_id: user.id,
        goal_id: goalId,
        title: a.title,
        description: a.why,
        done_when: a.done_when,
        minutes: a.minutes,
        scheduled_for: /today/i.test(a.when) ? today : null,
        status: "pending" as const,
        source: "coach"
      }));
      await supabase.from("steps").insert(rows);
    }

    if (mode === "checkin") {
      await supabase.from("checkins").insert({
        user_id: user.id,
        goal_id: goalId,
        done_text: message,
        coach_reply: coachReply
      });
    }

    for (const b of coachReply.beliefs_detected || []) {
      const { data: existing } = await supabase
        .from("beliefs")
        .select("id")
        .eq("user_id", user.id)
        .eq("original_text", b.belief)
        .eq("status", "active")
        .maybeSingle();
      if (existing) {
        await supabase.from("beliefs").update({ replacement_text: b.replacement, action_text: b.action }).eq("id", existing.id);
      } else {
        await supabase.from("beliefs").insert({
          user_id: user.id,
          goal_id: goalId,
          original_text: b.belief,
          replacement_text: b.replacement,
          action_text: b.action,
          status: "active"
        });
      }
    }

    return NextResponse.json({ ...coachReply, goal_id: goalId });
  } catch (err: any) {
    console.error("Coach route error:", err);
    return NextResponse.json({ error: err.message || "Coach request failed" }, { status: 500 });
  }
}
