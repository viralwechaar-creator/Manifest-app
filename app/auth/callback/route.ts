import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const redirectTo = req.nextUrl.clone();
  redirectTo.pathname = "/";
  redirectTo.search = "";

  if (code) {
    const supabase = supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = `?error=${encodeURIComponent(error.message)}`;
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.redirect(redirectTo);
}
