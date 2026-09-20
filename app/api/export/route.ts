import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

const TABLES = ["profiles", "goals", "milestones", "steps", "checkins", "beliefs", "gratitude", "affirmations", "chat_messages"];

export async function GET() {
  const supabase = supabaseServer();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const out: Record<string, any> = { exported_at: new Date().toISOString(), user_id: user.id };

  for (const table of TABLES) {
    const query = table === "profiles" ? supabase.from(table).select("*").eq("id", user.id) : supabase.from(table).select("*").eq("user_id", user.id);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: `Export failed on ${table}: ${error.message}` }, { status: 500 });
    out[table] = data;
  }

  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="manifest-backup-${new Date().toISOString().slice(0, 10)}.json"`
    }
  });
}
