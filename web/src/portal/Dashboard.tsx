import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Loading } from '../components/States';
import { fmtDate } from '../lib';

const LABELS: Record<string, [string, string?]> = {
  openVacancies: ['Vacant periods today', '/portal/substitutions'], pendingLeave: ['Leave to review', '/portal/leave'], staffAbsentToday: ['Staff absent today', '/portal/attendance'], studentsPresentPct: ['Students present today (%)', '/portal/attendance'],
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
      <text x="60" y="58" textAnchor="middle" fontSize="20" fontFamily="var(--font-display)">{total}</text><text x="60" y="74" textAnchor="middle" fontSize="8" fill="var(--grey)">students</text></svg>
      <ul>{parts.map((p, i) => <li key={p.label}><i style={{ background: colors[i % 3] }} />{p.label} <b>{p.n}</b></li>)}</ul></div>
  );
}

export function Dashboard() {
  const { me } = useAuth(); const reduce = useReducedMotion();
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { api('/admin/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <ErrorBox message={err} />;
  if (!d) return <Loading />;
  const entries = Object.entries(d.counts) as [string, number][];
  const sc = d.school ?? {};
  const max = Math.max(1, ...d.enquiryTrend.map((x: any) => x.count));
  const total = d.enquiryTrend.reduce((a: number, x: any) => a + x.count, 0);
  return (
    <>
      <div className="ph1"><h1>Hello, {me!.user.displayName.split(' ')[0]}</h1></div>
      {entries.length === 0 && <div className="panel"><p>Your account does not have any dashboard modules yet. Modules for your role are added as the school system grows.</p></div>}
      {entries.length > 0 && <div className="kpis">{entries.map(([k, v]) => { const [l, to] = LABELS[k] ?? [k]; const inner = <><b>{v}</b><span>{l}</span></>; return to ? <Link key={k} to={to} className="kpi">{inner}</Link> : <div key={k} className="kpi">{inner}</div>; })}</div>}
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', marginBottom: '1.2rem' }}>
        {sc.studentsByClass && <div className="panel"><h2>Students by class</h2><p className="muted" style={{ fontSize: '.8rem', marginTop: '-.5rem' }}>Select a class to see its students.</p>
          <Bars reduce={reduce} label="Students by class" data={sc.studentsByClass.map((c: any) => ({ label: c.name, n: c.n, to: `/portal/students?class_id=${c.class_id}&status=active` }))} /></div>}
        {sc.gender && <div className="panel"><h2>Who we teach</h2><Donut reduce={reduce} parts={sc.gender.map((g: any) => ({ label: g.gender, n: g.n }))} />
          {sc.studentsByStatus && <p className="muted" style={{ fontSize: '.82rem', marginTop: '1rem' }}>{sc.studentsByStatus.map((s: any) => `${s.n} ${s.status}`).join(' · ')}</p>}</div>}
        {sc.sectionLoad && <div className="panel"><h2>Section occupancy</h2><Bars reduce={reduce} label="Section occupancy" data={sc.sectionLoad.map((s: any) => ({ label: `${s.label} (${s.n}/${s.capacity})`, n: s.n, to: `/portal/students?section_id=${s.id}&status=active` }))} /></div>}
        {sc.staffByDepartment && <div className="panel"><h2>Staff by department</h2><Bars reduce={reduce} label="Staff by department" data={sc.staffByDepartment.map((s: any) => ({ label: s.name, n: s.n, to: s.id ? `/portal/staff?department_id=${s.id}` : '/portal/staff' }))} /></div>}
      </div>
      {d.enquiryTrend.length > 0 && (
        <div className="panel" style={{ marginBottom: '1.2rem' }}>
          <h2>Admission enquiries, last 30 days <span className="muted" style={{ fontSize: '.9rem' }}>({total} total)</span></h2>
          <div className="bars" role="img" aria-label={`Bar chart of enquiries per day, ${total} in the last 30 days`}>
            {d.enquiryTrend.map((x: any, i: number) => <motion.div key={x.day} title={`${x.day}: ${x.count}`} initial={reduce ? false : { height: 0 }} animate={{ height: `${(x.count / max) * 100}%` }} transition={{ delay: i * 0.015, duration: 0.5 }} style={{ opacity: x.count ? 1 : 0.35 }} />)}
          </div>
        </div>
      )}
      {d.recent?.length > 0 && <div className="panel"><h2>Recent activity</h2><table className="tbl" style={{ minWidth: 0 }}><tbody>{d.recent.map((r: any, i: number) => <tr key={i}><td>{fmtDate(r.at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td><td>{r.user_name ?? 'system'}</td><td><code>{r.action}</code></td></tr>)}</tbody></table><p style={{ marginTop: '.8rem' }}><Link className="link-arrow" to="/portal/audit">Full audit log →</Link></p></div>}
    </>
  );
}
