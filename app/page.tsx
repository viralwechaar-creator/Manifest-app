"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { useManifestData } from "@/lib/useManifestData";
import { IntakePage, PlanPage, DailyPage, MindScanPage, GratitudePage, ProgressPage, SettingsPage } from "@/components/Pages";

const PAGES = ["Chat", "Plan", "Daily", "Mind scan", "Gratitude", "Progress", "Settings"];

export default function Home() {
  const supabase = supabaseBrowser();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(2);
  const swiperRef = useRef<HTMLDivElement>(null);
  const data = useManifestData(userId);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id || null);
      setEmail(data.user?.email || null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
      setEmail(session?.user?.email || null);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goTo(i: number) {
    setActiveIndex(i);
    const el = swiperRef.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * i, behavior: "smooth" });
  }

  function onScroll() {
    const el = swiperRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== activeIndex) setActiveIndex(i);
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (!userId || data.loading) {
    return (
      <div className="app">
        <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
          <p className="hint">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {!data.online && <div className="offlinepill">Offline — changes will sync later</div>}
      <div className="topbar">
        <span className="wordmark">Manifest</span>
        <span className="pill streakpill">{data.streak}d streak</span>
      </div>

      <div className="swiper" ref={swiperRef} onScroll={onScroll}>
        <IntakePage data={data} />
        <PlanPage data={data} />
        <DailyPage data={data} />
        <MindScanPage data={data} />
        <GratitudePage data={data} />
        <ProgressPage data={data} />
        <SettingsPage data={data} email={email} onSignOut={signOut} />
      </div>

      <div className="pager">
        <div className="nav">
          {PAGES.map((label, i) => (
            <button key={label} className={i === activeIndex ? "active" : ""} onClick={() => goTo(i)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
