import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Loading } from '../components/States';
import { fmtDate } from '../lib';

const LABELS: Record<string, [string, string?]> = {
  openVacancies: ['Vacant periods today', '/portal/substitutions'], pendingLeave: ['Leave to review', '/portal/leave'], staffAbsentToday: ['Staff absent today', '/portal/attendance'], studentsPresentPct: ['Students present today (%)', '/portal/attendance'],
  openApplications: ['Open applications', '/portal/admissions'], collectedThisMonth: ['Collected this month (₹)', '/portal/finance/reports'], paymentsToConfirm: ['Payments to confirm', '/portal/finance/claims'], refundsToApprove: ['Refunds to approve', '/portal/finance/refunds'],
  openComplaints: ['Open complaints', '/portal/complaints'], unreadMessages: ['Unread messages (parents)', '/portal/messages'], booksOut: ['Books on loan', '/portal/library/loans'], booksOverdue: ['Books overdue', '/portal/library/loans'], studentsOnTransport: ['Students on transport', '/portal/transport'], newJobApplications: ['New job applications', '/portal/hr/recruitment'], payrollToApprove: ['Payroll to approve', '/portal/hr/payroll'],
  totalStudents: ['Active students', '/portal/students?status=active'], newAdmissionsThisMonth: ['Admitted this month'],
  teachers: ['Teachers', '/portal/staff?kind=teacher'], totalStaff: ['Staff in total', '/portal/staff'], staffOnLeave: ['Staff on leave'],
  newEnquiries: ['New enquiries', '/portal/inbox/enquiries'], newMessages: ['Unread messages', '/portal/inbox/messages'], enquiriesThisMonth: ['Enquiries this month'],
  publishedNews: ['Published stories', '/portal/content/news'], upcomingEvents: ['Upcoming events', '/portal/content/events'], galleryPhotos: ['Gallery photos', '/portal/content/gallery_items'], activeUsers: ['Active users', '/portal/users'],
};

function Bars({ data, label, to, reduce }: { data: { label: string; n: number; to?: string }[]; label: string; to?: boolean; reduce: boolean | null }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="hbars" role="list" aria-label={label}>
      {data.map((d, i) => {
        const inner = <><span className="hl">{d.label}</span><span className="hb"><motion.i initial={reduce ? false : { width: 0 }} animate={{ width: `${(d.n / max) * 100}%` }} transition={{ delay: i * 0.04, duration: 0.6 }} /></span><b>{d.n}</b></>;
        return d.to ? <Link role="listitem" key={d.label} to={d.to} className="hrow">{inner}</Link> : <div role="listitem" key={d.label} className="hrow">{inner}</div>;
      })}
    </div>
  );
}

function Donut({ parts, reduce }: { parts: { label: string; n: number }[]; reduce: boolean | null }) {
  const total = parts.reduce((a, p) => a + p.n, 0) || 1; const R = 42, C = 2 * Math.PI * R; let off = 0;
  const colors = ['#3c7059', '#cfd49f', '#e8d6ac'];
  return (
    <div className="donut"><svg viewBox="0 0 120 120" width="150" height="150" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(', ')}>
      <circle cx="60" cy="60" r={R} fill="none" stroke="var(--paper-2)" strokeWidth="16" />
      {parts.map((p, i) => { const len = (p.n / total) * C; const el = <motion.circle key={p.label} cx="60" cy="60" r={R} fill="none" stroke={colors[i % 3]} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.15 }} />; off += len; return el; })}
      <text x="60" y="58" textAnchor="middle" fontSize="20" fontFamily="var(--font-display)" fill="var(--ink)">{total}</text><text x="60" y="74" textAnchor="middle" fontSize="8" fill="var(--grey)">students</text></svg>
      <ul>{parts.map((p, i) => <li key={p.label}><i style={{ background: colors[i % 3] }} />{p.label} <b>{p.n}</b></li>)}</ul></div>
  );
}

const GROUPS: { title: string; icon: string; keys: string[] }[] = [
  { title: 'People', icon: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0', keys: ['totalStudents', 'newAdmissionsThisMonth', 'totalStaff', 'teachers', 'staffOnLeave', 'openApplications'] },
  { title: 'Teaching today', icon: 'M4 5h16v15H4zM4 10h16', keys: ['studentsPresentPct', 'staffAbsentToday', 'openVacancies', 'pendingLeave'] },
  { title: 'Money', icon: 'M4 7h16v12H4zM4 11h16', keys: ['collectedThisMonth', 'paymentsToConfirm', 'refundsToApprove', 'payrollToApprove'] },
  { title: 'Departments', icon: 'M3 7h13v9H3zM16 10h3l2 3v3h-5', keys: ['studentsOnTransport', 'booksOut', 'booksOverdue', 'newJobApplications'] },
  { title: 'Families & website', icon: 'M4 5h16v11H9l-5 4z', keys: ['newEnquiries', 'newMessages', 'unreadMessages', 'openComplaints', 'enquiriesThisMonth', 'publishedNews', 'upcomingEvents', 'galleryPhotos', 'activeUsers'] },
];
const SEVERITY: Record<string, 'urgent' | 'hot'> = { refundsToApprove: 'urgent', payrollToApprove: 'urgent', openVacancies: 'urgent', booksOverdue: 'urgent', newEnquiries: 'hot', paymentsToConfirm: 'hot', pendingLeave: 'hot', openComplaints: 'hot', openApplications: 'hot', staffAbsentToday: 'hot' };
const ATTENTION = ['openVacancies', 'refundsToApprove', 'payrollToApprove', 'paymentsToConfirm', 'pendingLeave', 'openComplaints', 'openApplications', 'newEnquiries', 'newMessages', 'unreadMessages', 'newJobApplications', 'booksOverdue'];
const ATTN_TEXT: Record<string, string> = { openVacancies: 'Vacant periods need a substitute today', refundsToApprove: 'Refunds waiting for your approval', payrollToApprove: 'Payroll waiting for your approval', paymentsToConfirm: 'Parent payments to confirm', pendingLeave: 'Leave requests to review', openComplaints: 'Open complaints', openApplications: 'Admission applications in progress', newEnquiries: 'New admission enquiries', newMessages: 'Unread contact messages', unreadMessages: 'Unread messages from parents', newJobApplications: 'New job applications', booksOverdue: 'Library books overdue' };

export function Dashboard() {
  const { me, can } = useAuth(); const reduce = useReducedMotion();
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { api('/admin/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <ErrorBox message={err} />;
  if (!d) return <Loading />;
  const c: Record<string, number> = d.counts; const sc = d.school ?? {};
  const val = (k: string) => (k === 'studentsPresentPct' ? `${c[k]}%` : k === 'collectedThisMonth' ? '₹' + c[k].toLocaleString('en-IN') : c[k]);
  const attention = ATTENTION.filter((k) => (c[k] ?? 0) > 0);
  const quick = ([['attendance.students.mark', '/portal/attendance', 'Mark attendance'], ['marks.enter', '/portal/exams', 'Enter marks'], ['fees.collect', '/portal/finance/collect', 'Record a payment'], ['students.manage', '/portal/students/new', 'Register a student'], ['admissions.review', '/portal/admissions', 'Review applications'], ['substitutions.manage', '/portal/substitutions', 'Arrange substitutes'], ['library.manage', '/portal/library', 'Issue a book'], ['notices.manage', '/portal/notices', 'Publish a notice'], ['messages.use', '/portal/messages', 'Messages']] as [string, string, string][]).filter(([p]) => can(p)).slice(0, 5);
  const max = Math.max(1, ...d.enquiryTrend.map((x: any) => x.count)); const total = d.enquiryTrend.reduce((a: number, x: any) => a + x.count, 0);
  const hour = new Date().getHours(); const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <div className="stack" style={{ gap: '1.1rem' }}>
      <section className="dash-hero"><div style={{ position: 'relative', zIndex: 1 }}><div className="eyebrow">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1 style={{ margin: '.5rem 0 0' }}>{greet}, {me!.user.displayName.split(' ')[0]}</h1><p style={{ margin: '.4rem 0 0', color: '#dbe6d6' }}>{attention.length ? `${attention.length} thing${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} your attention.` : 'Nothing needs your attention right now.'}</p></div>
        {quick.length > 0 && <div className="quick">{quick.map(([, to, label]) => <Link key={to} to={to}>{label}</Link>)}</div>}</section>
      {attention.length > 0 && <section className="panel"><h2>Needs your attention</h2><div className="attn">{attention.map((k) => <Link key={k} to={(LABELS[k] ?? [])[1] ?? '/portal'} className={SEVERITY[k] ?? ''}><span>{ATTN_TEXT[k]}</span><b>{c[k]}</b></Link>)}</div></section>}
      <div className="bento">
        {GROUPS.map((g) => { const keys = g.keys.filter((k) => c[k] !== undefined); if (!keys.length) return null; return (
          <section className="panel group-card" key={g.title}><h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={g.icon} /></svg>{g.title}</h2>
            <div className="group-kpis">{keys.map((k) => { const [l, to] = LABELS[k] ?? [k]; const inner = <><b>{val(k)}</b><span>{l}</span></>; return to ? <Link key={k} to={to} className="gk">{inner}</Link> : <div key={k} className="gk">{inner}</div>; })}</div></section>); })}
      </div>
      <div className="bento">
        {sc.studentsByClass && <div className="panel"><h2>Students by class</h2><p className="muted" style={{ fontSize: '.8rem', marginTop: '-.5rem' }}>Select a class to see its students.</p><Bars reduce={reduce} label="Students by class" data={sc.studentsByClass.map((x: any) => ({ label: x.name, n: x.n, to: `/portal/students?class_id=${x.class_id}&status=active` }))} /></div>}
        {sc.gender && <div className="panel"><h2>Who we teach</h2><Donut reduce={reduce} parts={sc.gender.map((g: any) => ({ label: g.gender, n: g.n }))} />{sc.studentsByStatus && <p className="muted" style={{ fontSize: '.82rem', marginTop: '1rem' }}>{sc.studentsByStatus.map((x: any) => `${x.n} ${x.status}`).join(' · ')}</p>}</div>}
        {sc.sectionLoad && <div className="panel"><h2>Section occupancy</h2><Bars reduce={reduce} label="Section occupancy" data={sc.sectionLoad.map((x: any) => ({ label: `${x.label} (${x.n}/${x.capacity})`, n: x.n, to: `/portal/students?section_id=${x.id}&status=active` }))} /></div>}
        {sc.staffByDepartment && <div className="panel"><h2>Staff by department</h2><Bars reduce={reduce} label="Staff by department" data={sc.staffByDepartment.map((x: any) => ({ label: x.name, n: x.n, to: x.id ? `/portal/staff?department_id=${x.id}` : '/portal/staff' }))} /></div>}
        {d.enquiryTrend.length > 0 && <div className="panel"><h2>Admission enquiries, last 30 days <span className="muted" style={{ fontSize: '.9rem' }}>({total})</span></h2><div className="bars" role="img" aria-label={`Bar chart of enquiries per day, ${total} in the last 30 days`}>{d.enquiryTrend.map((x: any, i: number) => <motion.div key={x.day} title={`${x.day}: ${x.count}`} initial={reduce ? false : { height: 0 }} animate={{ height: `${(x.count / max) * 100}%` }} transition={{ delay: i * 0.015, duration: 0.5 }} style={{ opacity: x.count ? 1 : 0.35 }} />)}</div></div>}
        {d.recent?.length > 0 && <div className="panel wide"><h2>Recent activity</h2><table className="tbl nowrap" style={{ minWidth: 0 }}><tbody>{d.recent.map((r: any, i: number) => <tr key={i}><td>{fmtDate(r.at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td><td>{r.user_name ?? 'system'}</td><td><code>{r.action}</code></td></tr>)}</tbody></table><p style={{ marginTop: '.8rem' }}><Link className="link-arrow" to="/portal/audit">Full audit log →</Link></p></div>}
      </div>
      {Object.keys(c).length === 0 && !sc.studentsByClass && <div className="panel"><p>Your account does not have any dashboard modules yet. Use the menu above to open the areas you can work in.</p></div>}
    </div>
  );
}
