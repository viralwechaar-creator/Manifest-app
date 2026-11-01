import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { isFamilyOnly, useAuth } from '../auth';
import { Loading } from '../components/States';
import { useSettings } from '../site/SiteData';
import { Bell } from './Bell';
import { CommandPalette } from './CommandPalette';
import { activeCategory, buildNav } from './nav';
import { clearSchemaCache, useSchema } from './schema';
import { useTheme } from './theme';

const ROLE_NAMES: Record<string, string> = {
  super_admin: 'Super Admin', school_admin: 'School Admin', principal: 'Principal', department_head: 'Department Head', teacher: 'Teacher',
  student: 'Student', parent: 'Parent', accounts_staff: 'Accounts', admission_staff: 'Admissions', hr_staff: 'HR', transport_staff: 'Transport', librarian: 'Library',
};
const Icon = ({ d, size = 18 }: { d: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
const SEARCH = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3';
const GRID = 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z';
const USER = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0';

export function PortalLayout() {
  const { me, loading, signOut, can } = useAuth(); const { s } = useSettings(); const { schema } = useSchema(); const { theme, toggle } = useTheme();
  const loc = useLocation(); const nav = useNavigate(); const reduce = useReducedMotion();
  const [menu, setMenu] = useState(false); const [search, setSearch] = useState(false); const [browse, setBrowse] = useState(false); const avatar = useRef<HTMLDivElement>(null);
  const cats = useMemo(() => buildNav(can, schema?.entities ?? []), [can, schema]);
  const { cat: active } = activeCategory(cats, loc.pathname);
  useEffect(() => { setMenu(false); setBrowse(false); }, [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch((v) => !v); } };
    const out = (e: MouseEvent) => { if (avatar.current && !avatar.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('keydown', k); document.addEventListener('mousedown', out);
    return () => { document.removeEventListener('keydown', k); document.removeEventListener('mousedown', out); };
  }, []);
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  if (isFamilyOnly(me.roles)) return <Navigate to="/family" replace />;
  if (me.user.mustChangePassword && loc.pathname !== '/portal/account') return <Navigate to="/portal/account" replace />;
  const shown = active ?? cats[0];
  const initials = me.user.displayName.split(' ').map((x) => x[0]).slice(0, 2).join('');
  const out = async () => { clearSchemaCache(); await signOut(); nav('/login'); };

  return (
    <div className="shell">
      <a className="skip" href="#portal-main">Skip to content</a>
      <header className="shell-top">
        <Link to="/portal" className="shell-brand" aria-label="Dashboard"><span className="brand-mark">{(s.school_name || 'S')[0]}</span><span className="sb-name"><b>{s.school_name}</b><small>Staff portal</small></span></Link>
        <nav className="pillnav" aria-label="Sections">
          {cats.map((c) => (
            <button key={c.id} className={'pn' + (c.id === shown?.id ? ' on' : '')} onClick={() => nav(c.items[0].to)} aria-current={c.id === shown?.id ? 'page' : undefined}>
              {c.id === shown?.id && <motion.span layoutId="pn-bg" className="pn-bg" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />}
              <span className="pn-in"><Icon d={c.icon} size={16} />{c.label}</span>
            </button>
          ))}
        </nav>
        <div className="shell-tools">
          <button className="iconbtn" aria-label="Search (Ctrl K)" title="Search (Ctrl K)" onClick={() => setSearch(true)}><Icon d={SEARCH} /></button>
          <Bell />
          <div className="avatar-wrap" ref={avatar}>
            <button className="avatar" aria-label="Account menu" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((v) => !v)}>{initials}</button>
            <AnimatePresence>{menu && (
              <motion.div className="pop avatar-menu" role="menu" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
                <div className="am-head"><b>{me.user.displayName}</b><small>{me.roles.map((r) => ROLE_NAMES[r] ?? r).join(', ')}</small></div>
                <Link role="menuitem" to="/portal/account">My account & security</Link>
                <button role="menuitem" onClick={toggle}>{theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</button>
                <a role="menuitem" href="/">View website ↗</a>
                <button role="menuitem" onClick={out}>Sign out</button>
              </motion.div>
            )}</AnimatePresence>
          </div>
        </div>
      </header>
      {shown && shown.items.length > 1 && (
        <nav className="subnav" aria-label={`${shown.label} pages`}>
          {shown.items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/portal'} className="sp" title={i.hint}>{i.label}</NavLink>)}
        </nav>
      )}
      <motion.main id="portal-main" key={loc.pathname} className="pcontent" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <Outlet />
      </motion.main>

      <nav className="bottombar" aria-label="Quick navigation">
        <NavLink to="/portal" end className="bb"><Icon d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" size={22} /><span>Home</span></NavLink>
        <button className={'bb' + (browse ? ' active' : '')} onClick={() => setBrowse(true)} aria-haspopup="dialog"><Icon d={GRID} size={22} /><span>Browse</span></button>
        <button className="bb" onClick={() => setSearch(true)}><Icon d={SEARCH} size={22} /><span>Search</span></button>
        <NavLink to="/portal/account" className="bb"><Icon d={USER} size={22} /><span>Me</span></NavLink>
      </nav>

      <AnimatePresence>{browse && (
        <motion.div className="scrim sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && setBrowse(false)}>
          <motion.div className="sheet" role="dialog" aria-modal="true" aria-label="All sections" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 420, damping: 40 }}>
            <div className="sheet-grab" aria-hidden />
            {cats.map((c) => (
              <section key={c.id}><h3><Icon d={c.icon} size={16} /> {c.label}</h3><div className="sheet-items">{c.items.map((i) => <Link key={i.to} to={i.to} className="sheet-i"><b>{i.label}</b>{i.hint && <small>{i.hint}</small>}</Link>)}</div></section>
            ))}
            <div className="flex" style={{ marginTop: '1rem' }}><button className="btn ghost sm" onClick={toggle}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button><button className="btn ghost sm" onClick={out}>Sign out</button></div>
          </motion.div>
        </motion.div>
      )}</AnimatePresence>
      <CommandPalette open={search} onClose={() => setSearch(false)} cats={cats} />
    </div>
  );
}
