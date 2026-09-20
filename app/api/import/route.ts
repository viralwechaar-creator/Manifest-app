import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

const TABLES_IN_ORDER = ["profiles", "goals", "milestones", "steps", "checkins", "beliefs", "gratitude", "affirmations", "chat_messages"];

export async function POST(req: NextRequest) {
  const supabase = supabaseServer();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const results: Record<string, { upserted: number; error?: string }> = {};

  for (const table of TABLES_IN_ORDER) {
    const rows = body[table];
    if (!Array.isArray(rows) || rows.length === 0) {
      results[table] = { upserted: 0 };
      continue;
    }
    const safeRows = rows.map((r: any) => (table === "profiles" ? { ...r, id: user.id } : { ...r, user_id: user.id }));
    const conflictKey = table === "profiles" ? "id" : "id";
    const { error, count } = await supabase.from(table).upsert(safeRows, { onConflict: conflictKey, count: "exact" });
    results[table] = { upserted: count || safeRows.length, error: error?.message };
  }

  return NextResponse.json({ results });
}
