import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Loading } from '../components/States';
import { useSettings } from '../site/SiteData';
import { clearSchemaCache, useSchema } from './schema';

const ROLE_NAMES: Record<string, string> = {
  super_admin: 'Super Admin', school_admin: 'School Admin', principal: 'Principal', department_head: 'Department Head', teacher: 'Teacher',
  student: 'Student', parent: 'Parent', accounts_staff: 'Accounts', admission_staff: 'Admissions', hr_staff: 'HR', transport_staff: 'Transport', librarian: 'Library',
};

function Bell() {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<{ rows: any[]; unread: number }>({ rows: [], unread: 0 });
  const nav = useNavigate();
  const load = () => api('/admin/notifications').then(setD).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  return (
    <div className="notif">
      <button className="iconbtn" aria-label={`Notifications${d.unread ? `, ${d.unread} unread` : ''}`} aria-expanded={open} onClick={() => { setOpen(!open); if (!open) load(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 19a2 2 0 0 0 4 0" /></svg>
        {d.unread > 0 && <span className="dot">{d.unread}</span>}
      </button>
      {open && <div className="pop">
        <div className="flex" style={{ justifyContent: 'space-between', padding: '.7rem 1rem', borderBottom: '1px solid var(--line)' }}><b>Notifications</b>{d.unread > 0 && <button className="btn ghost sm" onClick={async () => { await api('/admin/notifications/read', { method: 'POST', body: {} }); load(); }}>Mark all read</button>}</div>
        {d.rows.length === 0 && <p className="muted" style={{ padding: '1rem' }}>Nothing new.</p>}
        {d.rows.map((n) => <a key={n.id} href={n.link ?? '#'} className={n.read_at ? '' : 'unread'} onClick={async (e) => { e.preventDefault(); await api('/admin/notifications/read', { method: 'POST', body: { ids: [n.id] } }); setOpen(false); load(); if (n.link) nav(n.link); }}><b>{n.title}</b><br /><span className="muted">{n.body}</span></a>)}
      </div>}
    </div>
  );
}

export function PortalLayout() {
  const { me, loading, signOut, can } = useAuth();
  const { s } = useSettings();
  const { schema } = useSchema();
  const loc = useLocation(); const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.user.mustChangePassword && loc.pathname !== '/portal/account') return <Navigate to="/portal/account" replace />;

  const groups: Record<string, { key: string; label: string }[]> = {};
  for (const e of schema?.entities ?? []) (groups[e.group] ??= []).push(e);
  const link = (to: string, label: string, end = false) => <NavLink key={to} to={to} end={end} className="nav-i">{label}</NavLink>;
  return (
    <div className="portal">
      <aside className={'side' + (open ? ' open' : '')} aria-label="Portal navigation">
        <Link to="/portal" className="brand-row"><span className="brand-mark" style={{ background: 'var(--paper)', color: 'var(--forest)' }}>{(s.school_name || 'S')[0]}</span><span><b>{s.school_name}</b><small>Staff portal</small></span></Link>
        {link('/portal', 'Dashboard', true)}
        {(can('students.view') || can('staff.view')) && <h5>School</h5>}
        {can('students.view') && link('/portal/students', 'Students')}
        {can('staff.view') && link('/portal/staff', 'Teachers & staff')}
        {(can('academics.manage') || can('staff.view')) && link('/portal/academics', 'Academic setup')}
        {(can('timetable.view') || can('attendance.students.mark') || can('exams.manage') || can('marks.enter') || can('homework.manage')) && <h5>Teaching</h5>}
        {can('timetable.view') && link('/portal/timetable', 'Timetable')}
        {(can('attendance.students.mark') || can('attendance.students.view_all') || can('attendance.staff.view')) && link('/portal/attendance', 'Attendance')}
        {can('homework.manage') && link('/portal/homework', 'Homework')}
        {(can('exams.manage') || can('marks.enter') || can('results.view_all')) && link('/portal/exams', 'Exams & rankings')}
        {(can('leave.apply') || can('substitutions.manage')) && <h5>Staff</h5>}
        {can('leave.apply') && link('/portal/leave', 'Leave')}
        {can('substitutions.manage') && link('/portal/substitutions', 'Substitutions')}
        {can('enquiries.manage') && <><h5>Inbox</h5>{link('/portal/inbox/enquiries', 'Admission enquiries')}{link('/portal/inbox/messages', 'Contact messages')}</>}
        {can('cms.manage') && Object.entries(groups).map(([g, items]) => <div key={g}><h5>{g === 'Pages' ? 'Website' : g}</h5>{items.map((e) => link(`/portal/content/${e.key}`, e.label))}</div>)}
        {can('settings.manage') && <><h5>Website</h5>{link('/portal/settings', 'Site settings')}</>}
        {(can('users.manage') || can('audit.view')) && <h5>Administration</h5>}
        {can('users.manage') && link('/portal/users', 'Users & roles')}
        {can('audit.view') && link('/portal/audit', 'Audit log')}
        <div className="push" />
        {link('/portal/account', 'My account')}
        <a className="nav-i" href="/">View website ↗</a>
      </aside>
      <div className="pmain">
        <header className="ptop">
          <button className="iconbtn menu-btn" aria-label="Open navigation" onClick={() => setOpen(true)}><svg width="18" height="12" viewBox="0 0 18 12" aria-hidden><path d="M0 1h18M0 6h18M0 11h18" stroke="currentColor" strokeWidth="1.5" /></svg></button>
          <div className="grow" />
          {can('enquiries.manage') && <Bell />}
          <div className="who">{me.user.displayName}<small>{me.roles.map((r) => ROLE_NAMES[r] ?? r).join(', ')}</small></div>
          <button className="btn ghost sm" onClick={async () => { clearSchemaCache(); await signOut(); }}>Sign out</button>
        </header>
        {open && <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onClick={() => setOpen(false)} aria-hidden />}
        {/* Keyed wrapper: each page fades in once. (An exit animation would mount the next page twice.) */}
        <motion.div key={loc.pathname} className="pcontent" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <Outlet />
        </motion.div>
      </div>
    </div>
  );
}
