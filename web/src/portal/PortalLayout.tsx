import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Loading } from '../components/States';
import { useSettings } from '../site/SiteData';
import { Bell } from './Bell';
import { isFamilyOnly } from '../auth';
import { clearSchemaCache, useSchema } from './schema';

const ROLE_NAMES: Record<string, string> = {
  super_admin: 'Super Admin', school_admin: 'School Admin', principal: 'Principal', department_head: 'Department Head', teacher: 'Teacher',
  student: 'Student', parent: 'Parent', accounts_staff: 'Accounts', admission_staff: 'Admissions', hr_staff: 'HR', transport_staff: 'Transport', librarian: 'Library',
};

export function PortalLayout() {
  const { me, loading, signOut, can } = useAuth();
  const { s } = useSettings();
  const { schema } = useSchema();
  const loc = useLocation(); const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  if (isFamilyOnly(me.roles)) return <Navigate to="/family" replace />;
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
        {(can('notices.manage') || can('student_leave.decide')) && <h5>Parents & students</h5>}
        {can('notices.manage') && link('/portal/notices', 'Notices')}
        {can('student_leave.decide') && link('/portal/student-leave', 'Student leave')}
        {(can('leave.apply') || can('substitutions.manage')) && <h5>Staff</h5>}
        {can('leave.apply') && link('/portal/leave', 'Leave')}
        {can('substitutions.manage') && link('/portal/substitutions', 'Substitutions')}
        {(can('admissions.review') || can('admissions.view') || can('fees.view') || can('expenses.manage')) && <h5>Admissions & fees</h5>}
        {(can('admissions.review') || can('admissions.view')) && link('/portal/admissions', 'Admission applications')}
        {(can('fees.view') || can('expenses.manage')) && link('/portal/finance', 'Fees & accounts')}
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
          <Bell />
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
