import { SupabaseClient } from "@supabase/supabase-js";
import { guessLifeArea } from "./lifeArea";

function computeStreak(checkinDates: string[]): number {
  const unique = Array.from(new Set(checkinDates)).sort().reverse();
  if (unique.length === 0) return 0;

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (unique[0] !== today && unique[0] !== yesterday) return 0;

  let streak = 1;
  let cursor = new Date(unique[0]);
  for (let i = 1; i < unique.length; i++) {
    cursor = new Date(cursor.getTime() - 86400000);
    const expected = cursor.toISOString().slice(0, 10);
    if (unique[i] === expected) streak++;
    else break;
  }
  return streak;
}

export async function buildContextBundle(supabase: SupabaseClient, userId: string, userMessage: string) {
  const [{ data: profile }, { data: goals }, { data: beliefs }, { data: gratitude }, { data: checkins }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("goals")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1),
      supabase.from("beliefs").select("*").eq("user_id", userId).eq("status", "active").order("created_at", { ascending: false }),
      supabase.from("gratitude").select("text").eq("user_id", userId).order("created_at", { ascending: false }).limit(5),
      supabase.from("checkins").select("*").eq("user_id", userId).order("checkin_date", { ascending: false }).limit(14)
    ]);

  const activeGoal = goals && goals.length ? goals[0] : null;

  let milestones: any[] = [];
  let steps: any[] = [];
  if (activeGoal) {
    const [{ data: m }, { data: s }] = await Promise.all([
      supabase.from("milestones").select("*").eq("goal_id", activeGoal.id).order("sort_order"),
      supabase.from("steps").select("*").eq("goal_id", activeGoal.id).neq("status", "skipped").order("scheduled_for", { ascending: true, nullsFirst: false })
    ]);
    milestones = m || [];
    steps = s || [];
  }

  const today = new Date().toISOString().slice(0, 10);
  const lifeArea = guessLifeArea(activeGoal?.title, activeGoal?.description, userMessage);

  const bundle = {
    profile: {
      display_name: profile?.display_name || null
    },
    active_goal: activeGoal
      ? {
          id: activeGoal.id,
          title: activeGoal.title,
          description: activeGoal.description,
          target_date: activeGoal.target_date
        }
      : null,
    plan: {
      milestones: milestones.map((m) => ({ id: m.id, title: m.title, status: m.status })),
      this_week_steps: steps.filter((s) => s.status === "pending" && s.scheduled_for !== today).map((s) => ({ id: s.id, title: s.title })),
      today_steps: steps.filter((s) => s.status === "pending" && s.scheduled_for === today).map((s) => ({ id: s.id, title: s.title }))
    },
    recent_checkins: (checkins || []).slice(0, 7).map((c) => ({
      date: c.checkin_date,
      message: c.done_text,
      feeling: c.feeling
    })),
    active_beliefs: (beliefs || []).map((b) => ({ belief: b.original_text, replacement: b.replacement_text })),
    recent_gratitude: (gratitude || []).map((g) => g.text),
    streak: computeStreak((checkins || []).map((c) => c.checkin_date)),
    user_message: userMessage
  };

  return { bundle, activeGoal, profile, lifeArea };
}
