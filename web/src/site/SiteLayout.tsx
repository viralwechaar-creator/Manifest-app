import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useSettings } from './SiteData';
import { BrandMark } from '../components/BrandMark';

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
    { to: '/admissions/apply', label: 'Online admission' }, { to: '/admissions/track', label: 'Track application' }, { to: '/transport', label: 'Transport' }] },
  { label: 'Campus life', items: [
    { to: '/gallery', label: 'Gallery' }, { to: '/events', label: 'Events' }, { to: '/achievements', label: 'Achievements' },
    { to: '/calendar', label: 'Calendar' }, { to: '/alumni', label: 'Alumni' }] },
  { label: 'More', items: [
    { to: '/news', label: 'News & announcements' }, { to: '/documents', label: 'Documents' },
    { to: '/policies', label: 'Policies' }, { to: '/careers', label: 'Careers' }, { to: '/contact', label: 'Contact' }] },
];

function Brand({ light }: { light?: boolean }) {
  const { s } = useSettings();
  return (
    <Link to="/" className="brand" aria-label={`${s.school_name || 'School'} home`} style={light ? { color: '#fff' } : undefined}>
      <BrandMark logoUrl={s.logo_url} />
      <span style={{ minWidth: 0 }}><b>{s.school_name || 'School'}</b></span>
    </Link>
  );
}

function MenuOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s } = useSettings();
  const [active, setActive] = useState(0);
  const loc = useLocation();
  useEffect(() => { onClose(); }, [loc.pathname]); // eslint-disable-line
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="menu" role="dialog" aria-modal="true" aria-label="Site menu"
          initial={{ clipPath: 'inset(0 0 100% 0)' }} animate={{ clipPath: 'inset(0 0 0% 0)' }} exit={{ clipPath: 'inset(0 0 100% 0)' }} transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}>
          <div className="menu-top wrap">
            <Brand light />
            <button className="pillbtn light" onClick={onClose} aria-label="Close menu">Close <span aria-hidden>✕</span></button>
          </div>
          <div className="wrap menu-body">
            <ol className="menu-groups">
              {GROUPS.map((g, i) => (
                <motion.li key={g.label} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.06, duration: 0.5 }}>
                  <button className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)} aria-expanded={i === active}>
                    <span className="num">{String(i + 1).padStart(2, '0')}</span><span className="lbl">{g.label}</span>
                  </button>
                  <div className="menu-sub-m" hidden={i !== active}>{g.items.map((it) => <Link key={it.to} to={it.to}>{it.label}</Link>)}</div>
                </motion.li>
              ))}
            </ol>
            <div className="menu-panel">
              <AnimatePresence mode="wait">
                <motion.div key={active} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                  <small>{GROUPS[active].label}</small>
                  {GROUPS[active].items.map((it) => <Link key={it.to} to={it.to}>{it.label}<span aria-hidden>→</span></Link>)}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          <div className="wrap menu-foot">
            <Link to="/">Home</Link>
            <Link to="/login">Portal login</Link>
            {s.phone && <a href={`tel:${s.phone.replace(/\s/g, '')}`}>{s.phone}</a>}
            {s.email && <a href={`mailto:${s.email}`}>{s.email}</a>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Header() {
  const [solid, setSolid] = useState(false);
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const onHero = loc.pathname === '/';
  useEffect(() => { const f = () => setSolid(window.scrollY > (onHero ? window.innerHeight * 0.8 : 24)); f(); window.addEventListener('scroll', f, { passive: true }); return () => window.removeEventListener('scroll', f); }, [onHero]);
  const light = onHero && !solid;
  return (
    <>
      <header className={'hdr' + (solid ? ' solid' : '') + (light ? ' over' : '')}>
        <div className="wrap hdr-in">
          <Brand light={light} />
          <div className="flex" style={{ flexWrap: 'nowrap' }}>
            <Link className={'pillbtn hide-sm' + (light ? ' light' : '')} to="/admissions/enquiry">Admission enquiry</Link>
            <button className={'pillbtn' + (light ? ' light' : '')} onClick={() => setMenu(true)} aria-haspopup="dialog" aria-expanded={menu}>
              Menu <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden><path d="M0 1h16M0 7h16" stroke="currentColor" strokeWidth="1.4" /></svg>
            </button>
          </div>
        </div>
      </header>
      <MenuOverlay open={menu} onClose={() => setMenu(false)} />
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
            <p style={{ color: '#d9d0c6', maxWidth: '34ch' }}>{s.tagline}</p>
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
      <motion.main id="main" key={loc.pathname} initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 0.8, 0.24, 1] }}>
        <Outlet />
      </motion.main>
      <Footer />
    </>
  );
}
