import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSettings } from './SiteData';

interface NavItem { to: string; label: string }
const GROUPS: { label: string; items: NavItem[] }[] = [
  { label: 'About', items: [
    { to: '/about', label: 'About us' }, { to: '/principal', label: "Principal's message" },
    { to: '/vision-mission', label: 'Vision & mission' }, { to: '/infrastructure', label: 'Infrastructure' }] },
  { label: 'Academics', items: [
    { to: '/academics', label: 'Our approach' }, { to: '/curriculum', label: 'Classes & curriculum' },
    { to: '/departments', label: 'Departments' }, { to: '/faculty', label: 'Faculty' }] },
  { label: 'Admissions', items: [
    { to: '/admissions', label: 'How to join' }, { to: '/admissions/enquiry', label: 'Admission enquiry' },
    { to: '/admissions/apply', label: 'Online admission' }, { to: '/transport', label: 'Transport' }] },
  { label: 'Campus life', items: [
    { to: '/gallery', label: 'Gallery' }, { to: '/events', label: 'Events' }, { to: '/achievements', label: 'Achievements' },
    { to: '/calendar', label: 'Calendar' }, { to: '/alumni', label: 'Alumni' }] },
  { label: 'More', items: [
    { to: '/news', label: 'News & announcements' }, { to: '/documents', label: 'Documents' },
    { to: '/policies', label: 'Policies' }, { to: '/careers', label: 'Careers' }, { to: '/contact', label: 'Contact' }] },
];

function Brand() {
  const { s } = useSettings();
  return (
    <Link to="/" className="brand" aria-label={`${s.school_name || 'School'} home`}>
      {s.logo_url ? <img src={s.logo_url} alt="" /> : <span className="brand-mark" aria-hidden>{(s.school_name || 'S')[0]}</span>}
      <span style={{ minWidth: 0 }}><b>{s.school_name || 'School'}</b>{s.tagline && <small>{s.tagline}</small>}</span>
    </Link>
  );
}

function Dropdown({ g }: { g: (typeof GROUPS)[number] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, []);
  const active = g.items.some((i) => loc.pathname === i.to);
  return (
    <div className="nav-dd" ref={ref} onMouseEnter={() => matchMedia('(hover:hover)').matches && setOpen(true)} onMouseLeave={() => matchMedia('(hover:hover)').matches && setOpen(false)}>
      <button aria-expanded={open} aria-haspopup="true" className={active ? 'active' : ''} onClick={() => setOpen((o) => !o)}>
        {g.label}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden style={{ transition: 'transform .25s', transform: open ? 'rotate(180deg)' : 'none' }}><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="dd-panel" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {g.items.map((i) => <NavLink key={i.to} to={i.to} end>{i.label}</NavLink>)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Header() {
  const [solid, setSolid] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => { const f = () => setSolid(window.scrollY > 24); f(); window.addEventListener('scroll', f, { passive: true }); return () => window.removeEventListener('scroll', f); }, []);
  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => { document.body.style.overflow = drawer ? 'hidden' : ''; }, [drawer]);
  return (
    <>
      <header className={'hdr' + (solid ? ' solid' : '')}>
        <div className="wrap hdr-in">
          <Brand />
          <nav className="nav" aria-label="Main">
            {GROUPS.map((g) => <Dropdown key={g.label} g={g} />)}
          </nav>
          <div className="flex">
            <Link className="btn sm ghost portal-link" to="/login">Portal login</Link>
            <button className="burger" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
              <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden><path d="M0 1h18M0 6h18M0 11h18" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
          </div>
        </div>
      </header>
      <AnimatePresence>
        {drawer && (
          <motion.div className="drawer" role="dialog" aria-modal="true" aria-label="Menu" initial={{ clipPath: 'circle(0% at 95% 4%)' }} animate={{ clipPath: 'circle(150% at 95% 4%)' }} exit={{ clipPath: 'circle(0% at 95% 4%)' }} transition={{ duration: 0.55, ease: [0.76, 0, 0.24, 1] }}>
            <button className="close" aria-label="Close menu" onClick={() => setDrawer(false)}>✕</button>
            <Link to="/">Home</Link>
            {GROUPS.map((g) => (<div key={g.label}><small>{g.label}</small>{g.items.map((i) => <Link key={i.to} to={i.to}>{i.label}</Link>)}</div>))}
            <small>Staff, parents & students</small>
            <Link to="/login">Portal login</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Footer() {
  const { s } = useSettings();
  return (
    <footer className="ftr">
      <div className="wrap">
        <div className="ftr-grid">
          <div>
            <div className="big">{s.school_name}</div>
            <p style={{ color: '#c8d3c6', maxWidth: '34ch' }}>{s.tagline}</p>
            {s.address && <p style={{ whiteSpace: 'pre-line', fontSize: '.9rem' }}>{s.address}</p>}
            {s.phone && <a href={`tel:${s.phone.replace(/\s/g, '')}`}>{s.phone}</a>}
            {s.email && <a href={`mailto:${s.email}`}>{s.email}</a>}
          </div>
          {GROUPS.slice(0, 3).map((g) => (<div key={g.label}><h4>{g.label}</h4>{g.items.map((i) => <Link key={i.to} to={i.to}>{i.label}</Link>)}</div>))}
        </div>
        <div className="bottom">
          <span>© {new Date().getFullYear()} {s.school_name}</span>
          <span style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
            {[['Facebook', s.facebook_url], ['Instagram', s.instagram_url], ['YouTube', s.youtube_url]].filter(([, u]) => u).map(([n, u]) => <a key={n} href={u} target="_blank" rel="noopener noreferrer" style={{ display: 'inline' }}>{n}</a>)}
            <Link to="/policies" style={{ display: 'inline' }}>Privacy & policies</Link>
            <Link to="/login" style={{ display: 'inline' }}>Portal login</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}

export function SiteLayout() {
  const loc = useLocation();
  const reduce = useReducedMotion();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [loc.pathname]);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Header />
      <AnimatePresence mode="wait" initial={false}>
        <motion.main id="main" key={loc.pathname} initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 0.8, 0.24, 1] }}>
          <Outlet />
        </motion.main>
      </AnimatePresence>
      <Footer />
    </>
  );
}
