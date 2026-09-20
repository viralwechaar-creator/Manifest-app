"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "./supabaseClient";
import { cacheGet, cacheSet, enqueueMutation, flushQueue, isOnline } from "./offlineCache";
import { Affirmation, Belief, Checkin, CoachMode, CoachReply, Goal, GratitudeEntry, Milestone, Profile, Step } from "./types";

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
    if (unique[i] === cursor.toISOString().slice(0, 10)) streak++;
    else break;
  }
  return streak;
}

export function useManifestData(userId: string | null) {
  const supabase = supabaseBrowser();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [beliefs, setBeliefs] = useState<Belief[]>([]);
  const [gratitude, setGratitude] = useState<GratitudeEntry[]>([]);
  const [affirmations, setAffirmations] = useState<Affirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    setOnline(isOnline());

    if (!isOnline()) {
      setProfile(cacheGet<Profile>("profiles")?.rows?.[0] || null);
      setGoal(cacheGet<Goal>("goals")?.rows?.[0] || null);
      setMilestones(cacheGet<Milestone>("milestones")?.rows || []);
      setSteps(cacheGet<Step>("steps")?.rows || []);
      setCheckins(cacheGet<Checkin>("checkins")?.rows || []);
      setBeliefs(cacheGet<Belief>("beliefs")?.rows || []);
      setGratitude(cacheGet<GratitudeEntry>("gratitude")?.rows || []);
      setAffirmations(cacheGet<Affirmation>("affirmations")?.rows || []);
      setLoading(false);
      return;
    }

    await flushQueue(supabase);

    const [p, g, c, gr, af] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("goals").select("*").eq("user_id", userId).eq("status", "active").order("created_at", { ascending: false }).limit(1),
      supabase.from("checkins").select("*").eq("user_id", userId).order("checkin_date", { ascending: false }).limit(14),
      supabase.from("gratitude").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
      supabase.from("affirmations").select("*").eq("user_id", userId).order("created_at", { ascending: false })
    ]);

    const activeGoal = g.data?.[0] || null;
    let m: Milestone[] = [];
    let s: Step[] = [];
    if (activeGoal) {
      const [mRes, sRes] = await Promise.all([
        supabase.from("milestones").select("*").eq("goal_id", activeGoal.id).order("sort_order"),
        supabase.from("steps").select("*").eq("goal_id", activeGoal.id).neq("status", "skipped").order("scheduled_for", { ascending: true, nullsFirst: false })
      ]);
      m = mRes.data || [];
      s = sRes.data || [];
    }
    const beliefsRes = await supabase.from("beliefs").select("*").eq("user_id", userId).eq("status", "active").order("created_at", { ascending: false });

    setProfile(p.data || null);
    setGoal(activeGoal);
    setMilestones(m);
    setSteps(s);
    setCheckins(c.data || []);
    setBeliefs(beliefsRes.data || []);
    setGratitude(gr.data || []);
    setAffirmations(af.data || []);

    cacheSet("profiles", p.data ? [p.data] : []);
    cacheSet("goals", activeGoal ? [activeGoal] : []);
    cacheSet("milestones", m);
    cacheSet("steps", s);
    cacheSet("checkins", c.data || []);
    cacheSet("beliefs", beliefsRes.data || []);
    cacheSet("gratitude", gr.data || []);
    cacheSet("affirmations", af.data || []);

    setLoading(false);
  }, [userId, supabase]);

  useEffect(() => {
    load();
    const onOnline = () => load();
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const today = new Date().toISOString().slice(0, 10);
  const streak = computeStreak(checkins.map((c) => c.checkin_date));

  async function toggleStep(step: Step) {
    const nextStatus = step.status === "done" ? "pending" : "done";
    setSteps((prev) => prev.map((s) => (s.id === step.id ? { ...s, status: nextStatus, completed_at: nextStatus === "done" ? new Date().toISOString() : null } : s)));
    const payload = { status: nextStatus, completed_at: nextStatus === "done" ? new Date().toISOString() : null };
    if (!isOnline()) {
      enqueueMutation({ table: "steps", type: "update", payload, match: { id: step.id } });
      return;
    }
    await supabase.from("steps").update(payload).eq("id", step.id);
  }

  async function addUserStep(title: string, bucket: "today" | "week") {
    if (!userId) return;
    const row = {
      user_id: userId,
      goal_id: goal?.id || null,
      title,
      status: "pending" as const,
      minutes: 10,
      done_when: "You did it.",
      scheduled_for: bucket === "today" ? today : null,
      source: "user"
    };
    if (!isOnline()) {
      enqueueMutation({ table: "steps", type: "insert", payload: row });
      setSteps((prev) => [...prev, { ...row, id: crypto.randomUUID(), description: null, milestone_id: null, scheduled_time: null, created_at: new Date().toISOString(), completed_at: null } as Step]);
      return;
    }
    const { data } = await supabase.from("steps").insert(row).select().single();
    if (data) setSteps((prev) => [...prev, data]);
  }

  async function addGratitude(text: string) {
    if (!userId || !text.trim()) return;
    const row = { user_id: userId, text: text.trim() };
    if (!isOnline()) {
      enqueueMutation({ table: "gratitude", type: "insert", payload: row });
      setGratitude((prev) => [{ ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }, ...prev]);
      return;
    }
    const { data } = await supabase.from("gratitude").insert(row).select().single();
    if (data) setGratitude((prev) => [data, ...prev]);
  }

  async function deleteGratitude(id: string) {
    setGratitude((prev) => prev.filter((g) => g.id !== id));
    if (!isOnline()) {
      enqueueMutation({ table: "gratitude", type: "delete", match: { id }, payload: {} });
      return;
    }
    await supabase.from("gratitude").delete().eq("id", id);
  }

  async function addAffirmation(text: string) {
    if (!userId || !text.trim()) return;
    const row = { user_id: userId, goal_id: goal?.id || null, text: text.trim(), active: true };
    if (!isOnline()) {
      enqueueMutation({ table: "affirmations", type: "insert", payload: row });
      setAffirmations((prev) => [{ ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }, ...prev]);
      return;
    }
    const { data } = await supabase.from("affirmations").insert(row).select().single();
    if (data) setAffirmations((prev) => [data, ...prev]);
  }

  async function deleteAffirmation(id: string) {
    setAffirmations((prev) => prev.filter((a) => a.id !== id));
    if (!isOnline()) {
      enqueueMutation({ table: "affirmations", type: "delete", match: { id }, payload: {} });
      return;
    }
    await supabase.from("affirmations").delete().eq("id", id);
  }

  async function sendCoachMessage(mode: CoachMode, message: string, goalOverride?: any): Promise<CoachReply & { goal_id?: string }> {
    const res = await fetch("/api/coach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, message, goalOverride })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Coach request failed");
    await load();
    return data;
  }

  return {
    profile,
    goal,
    milestones,
    steps,
    checkins,
    beliefs,
    gratitude,
    affirmations,
    loading,
    online,
    streak,
    today,
    reload: load,
    toggleStep,
    addUserStep,
    addGratitude,
    deleteGratitude,
    addAffirmation,
    deleteAffirmation,
    sendCoachMessage
  };
}
