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
  const [menuOpen, setMenuOpen] = useState(false);
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
    const clamped = Math.max(0, Math.min(PAGES.length - 1, i));
    setActiveIndex(clamped);
    setMenuOpen(false);
    const el = swiperRef.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * clamped, behavior: "smooth" });
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
    <div className={`app${menuOpen ? " menu-open" : ""}`}>
      {!data.online && <div className="offlinepill">Offline — changes will sync later</div>}

      <header className="topbar">
        <span className="wordmark">Manifest</span>
        <button
          className="textbtn menupill"
          aria-expanded={menuOpen}
          aria-controls="menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </header>

      <main className="swiper" ref={swiperRef} onScroll={onScroll}>
        <IntakePage data={data} />
        <PlanPage data={data} />
        <DailyPage data={data} />
        <MindScanPage data={data} />
        <GratitudePage data={data} />
        <ProgressPage data={data} />
        <SettingsPage data={data} email={email} onSignOut={signOut} />
      </main>

      <footer className="pager">
        <span>
          {activeIndex + 1} / {PAGES.length}
        </span>
        <div className="nav">
          <button disabled={activeIndex === 0} onClick={() => goTo(activeIndex - 1)}>
            Prev
          </button>
          <button disabled={activeIndex === PAGES.length - 1} onClick={() => goTo(activeIndex + 1)}>
            Next
          </button>
        </div>
      </footer>

      <nav className="menu" id="menu" aria-label="Sections" aria-hidden={!menuOpen}>
        <ul>
          {PAGES.map((label, i) => (
            <li key={label}>
              <button aria-current={i === activeIndex} onClick={() => goTo(i)}>
                {label}
                <span className="here" />
              </button>
            </li>
          ))}
        </ul>
        <div className="menu-foot">
          <span>{data.streak}d streak</span>
          <span>{new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        </div>
      </nav>
    </div>
  );
}
