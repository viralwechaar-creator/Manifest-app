import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { api, ApiError } from '../api';
import { isFamilyOnly, useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { fmtDate } from '../lib';
import { Bell } from '../portal/Bell';
import { clearSchemaCache } from '../portal/schema';
import { useApi } from '../portal/ui';
import { useTheme, useThemeToggle } from '../portal/theme';
import { inr, MODE, Receipt } from '../portal/Receipt';
import { useSettings } from '../site/SiteData';
import { BrandMark } from '../components/BrandMark';

interface Child { id: number; student_code: string; full_name: string; status: string; section: string | null; section_id: number | null }
const Ctx = createContext<{ role: string; children: Child[]; child: Child; setChild: (id: number) => void }>(null as any);
import { HandIn } from './Family3';
import { LangSwitch, t } from '../i18n';
export const useChild = () => useContext(Ctx);
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const initials = (n: string) => n.split(' ').map((x) => x[0]).slice(0, 2).join('');

export function FamilyLayout() {
  useTheme(); const { me, loading } = useAuth(); const { s } = useSettings(); const loc = useLocation(); const reduce = useReducedMotion();
  const kids = useApi<{ role: string; children: Child[] }>(me ? '/family/children' : null);
  const [sel, setSel] = useState<number | null>(() => Number(localStorage.getItem('family_child')) || null);
  const [switcher, setSwitcher] = useState(false);
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  if (!isFamilyOnly(me.roles)) return <Navigate to="/portal" replace />;
  if (me.user.mustChangePassword && loc.pathname !== '/family/account') return <Navigate to="/family/account" replace />;
  const onAccount = loc.pathname === '/family/account';
  const list = kids.data?.children ?? [];
  const child = list.find((c) => c.id === sel) ?? list[0];
  const tabs: [string, string, string][] = [['/family', 'Home', 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'], ['/family/attendance', 'Attendance', 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4'], ['/family/results', 'Results', 'M5 20V10M12 20V4M19 20v-7'], ['/family/homework', 'Homework', 'M6 3h9l4 4v14H6zM9 12h7M9 16h7'], ['/family/more', 'More', 'M5 12h.01M12 12h.01M19 12h.01']];
  return (
    <div className="fam">
      <header className="fam-top">
        <Link to="/family" className="brand" style={{ minWidth: 0 }}><BrandMark logoUrl={s.logo_url} /><span className="fam-brand"><b>{s.school_name}</b></span></Link>
        <div className="flex" style={{ flexWrap: 'nowrap' }}>
          {child && !onAccount && <button className="fam-child" onClick={() => list.length > 1 && setSwitcher(true)} aria-haspopup={list.length > 1 ? 'dialog' : undefined} aria-label={`Showing ${child.full_name}${list.length > 1 ? '. Change child' : ''}`}>
            <span className="av">{initials(child.full_name)}</span><span className="nm">{child.full_name.split(' ')[0]}</span>{list.length > 1 && <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>}</button>}
          <Bell />
          <Link to="/family/account" className="iconbtn" aria-label="My account"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg></Link>
        </div>
      </header>
      <nav className="fam-tabs" aria-label="Sections">{tabs.map(([to, label, d]) => <NavLink key={to} to={to} end={to === '/family'} className="fam-tab"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg><span>{t(label)}</span></NavLink>)}</nav>
      <motion.main key={loc.pathname} className="fam-main" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        {kids.err ? <ErrorBox message={kids.err} /> : !kids.data ? <Loading /> : !child && !onAccount ? <Empty>No students are linked to this account yet. Please contact the school office.</Empty> : <Ctx.Provider value={{ role: kids.data.role, children: list, child, setChild: (id) => { localStorage.setItem('family_child', String(id)); setSel(id); } }}><Outlet /></Ctx.Provider>}
      </motion.main>
      <Modal open={switcher} onClose={() => setSwitcher(false)} label="Choose a child"><h3>Whose progress?</h3><div className="stack" style={{ gap: '.5rem' }}>{list.map((c) => <button key={c.id} className={'fam-pick' + (c.id === child?.id ? ' on' : '')} onClick={() => { localStorage.setItem('family_child', String(c.id)); setSel(c.id); setSwitcher(false); }}><span className="av">{initials(c.full_name)}</span><span style={{ textAlign: 'left' }}><b>{c.full_name}</b><br /><span className="muted" style={{ fontSize: '.82rem' }}>{c.section ?? 'No class'} · {c.student_code}</span></span></button>)}</div></Modal>
    </div>
  );
}

function FeesTile({ childId }: { childId: number }) {
  const { data } = useApi<any>(`/family/children/${childId}/fees`, [childId]);
  if (!data) return null; const t = data.totals;
  return (<Link to="/family/fees" className="panel soft" style={{ textDecoration: 'none', display: 'block' }}><h2>Fees</h2>{t.balance > 0 ? <p style={{ margin: 0 }}><b style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 400 }}>{inr(t.balance)}</b> to pay{t.overdue > 0 && <span className="err" style={{ marginLeft: '.6rem' }}>{inr(t.overdue)} overdue</span>}{t.nextDue && t.overdue === 0 && <span className="muted"> · next due {fmtDate(t.nextDue)}</span>}</p> : <p style={{ margin: 0 }}>{data.dues.length ? 'All fees are paid. Thank you.' : 'No fees have been raised yet.'}</p>}<span className="link-arrow" style={{ marginTop: '.6rem' }}>View fees and receipts →</span></Link>);
}

const chip = (s: string | null) => s ? <span className={'fchip ' + s}>{s}</span> : <span className="fchip none">not marked yet</span>;
const dayName = (v: string) => fmtDate(v, { weekday: 'short', day: 'numeric', month: 'short' });

export function FamilyHome() {
  const { child, role } = useChild(); const { me } = useAuth();
  const o = useApi<any>(`/family/children/${child.id}/overview`, [child.id]); const notices = useApi<any[]>('/family/notices'); const events = useApi<any[]>('/family/events');
  if (o.err) return <ErrorBox message={o.err} />; if (!o.data) return <Loading />;
  const d = o.data; const a = d.attendance.last30;
  return (<div className="stack" style={{ gap: '1.1rem' }}>
    <section className="fam-hero"><div className="eyebrow" style={{ color: 'var(--sand)' }}>{role === 'parent' ? `Hello, ${me!.user.displayName.split(' ')[0]}` : 'Welcome back'}</div>
      <h1>{d.student.full_name}</h1><p>{d.student.section ?? 'Class not assigned'} · ID {d.student.student_code}{d.student.class_teacher && <> · Class teacher {d.student.class_teacher}</>}</p>
      <div className="flex" style={{ marginTop: '.8rem' }}><span className="muted" style={{ color: '#e9e2da' }}>Today</span>{chip(d.attendance.today)}</div></section>
    <div className="fam-tiles">
      <Link to="/family/attendance" className="fam-tile"><span>Attendance, last 30 days</span><b>{a.percentage == null ? '—' : `${Math.round(a.percentage)}%`}</b><small>{a.absent} absent · {a.late} late</small></Link>
      <Link to="/family/homework" className="fam-tile"><span>Homework due</span><b>{d.homeworkDue}</b><small>upcoming</small></Link>
      <Link to="/family/results" className="fam-tile"><span>Latest results</span><b style={{ fontSize: '1.3rem' }}>{d.latestResults ? d.latestResults.name : 'None yet'}</b><small>{d.latestResults ? 'tap to view' : 'published by the school'}</small></Link>
      <Link to="/family/leave" className="fam-tile"><span>Leave requests</span><b>{d.pendingLeave}</b><small>pending</small></Link>
    </div>
    <div className="panel"><h2>Notices</h2>{!notices.data ? <Loading /> : notices.data.length === 0 ? <p className="muted">No notices right now.</p> : notices.data.slice(0, 3).map((n) => <div key={n.id} className="fam-row"><div style={{ display: 'flex', justifyContent: 'space-between', gap: '.8rem', flexWrap: 'wrap' }}><b>{n.title}</b><span className="muted">{fmtDate(n.published_at)}</span></div><p style={{ margin: '.2rem 0 0' }}>{n.body.slice(0, 140)}{n.body.length > 140 && '…'}</p></div>)}<Link className="link-arrow" to="/family/notices">All notices & events →</Link></div>
    {events.data && events.data.length > 0 && <div className="panel"><h2>Coming up</h2>{events.data.slice(0, 3).map((e) => <div key={e.id} className="fam-row" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}><span><b>{e.title}</b><br /><span className="muted" style={{ fontSize: '.82rem' }}>{e.location}</span></span><span className="muted">{fmtDate(e.starts_at, { day: 'numeric', month: 'short' })}</span></div>)}</div>}
    <FeesTile childId={child.id} />
  </div>);
}

export function FamilyAttendance() {
  const { child } = useChild(); const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, err } = useApi<any>(`/family/children/${child.id}/attendance?month=${month}`, [child.id, month]);
  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)); };
  const cells = useMemo(() => { const [y, m] = month.split('-').map(Number); const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]; }, [month]);
  const by = new Map<string, string>((data?.days ?? []).map((d: any) => [d.date, d.status]));
  return (<div className="stack"><h1 className="fam-h">Attendance</h1>{err && <ErrorBox message={err} />}
    <div className="panel"><div className="flex" style={{ justifyContent: 'space-between', marginBottom: '.8rem' }}><button className="btn ghost sm" onClick={() => shift(-1)} aria-label="Previous month">←</button><b style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem' }}>{fmtDate(month + '-01', { month: 'long', year: 'numeric' })}</b><button className="btn ghost sm" onClick={() => shift(1)} aria-label="Next month">→</button></div>
      <div className="fam-cal" role="group" aria-label="Attendance calendar">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="dow" aria-hidden>{d}</div>)}{cells.map((d, i) => d ? <div key={i} className={'fday ' + (by.get(d) ?? '')} role="img" aria-label={`${d}: ${by.get(d) ?? 'not marked'}`} title={`${d}: ${by.get(d) ?? 'not marked'}`}><span aria-hidden>{+d.slice(8)}</span></div> : <div key={i} aria-hidden />)}</div>
      <div className="flex" style={{ marginTop: '1rem', gap: '.5rem' }}>{['present', 'absent', 'late', 'excused'].map((s) => <span key={s} className={'fchip ' + s}>{s} {data?.totals[s] ?? 0}</span>)}</div></div>
    {data?.year.percentage != null && <div className="panel soft"><b>This academic year</b><p style={{ margin: '.3rem 0 0' }}>{data.year.percentage}% present or late ({data.year.present} of {data.year.marked} school days marked)</p></div>}</div>);
}

function ResultDetail({ examId, onBack }: { examId: number; onBack: () => void }) {
  const { child } = useChild(); const { data: r, err } = useApi<any>(`/family/children/${child.id}/report/${examId}`, [examId, child.id]);
  if (err) return <ErrorBox message={err} />; if (!r) return <Loading />; const x = r.result;
  return (<div className="stack"><div className="flex noprint"><button className="btn ghost sm" onClick={onBack}>← All results</button><button className="btn sm" onClick={() => window.print()}>Print / save PDF</button></div>
    <div className="panel rc"><div className="eyebrow">{r.school}</div><h2 style={{ fontSize: '1.8rem', margin: '.4rem 0' }}>{r.exam.name}</h2><p className="muted">{r.student.name} · {r.student.section} · {r.exam.year}</p>
      <div className="fam-subjects">{x.subjects.map((s: any) => <div key={s.examSubjectId} className="fsub"><div className="flex" style={{ justifyContent: 'space-between' }}><b>{s.subject}</b><span>{s.pending ? '—' : s.absent ? 'Absent' : <b>{s.marks}</b>}<span className="muted"> / {s.max}</span></span></div><div className="meter"><i style={{ width: `${s.pending || s.absent ? 0 : ((s.marks ?? 0) / s.max) * 100}%` }} /></div><small className="muted">{s.grade && `Grade ${s.grade}`}{s.rank ? ` · ${ordinal(s.rank)} in class` : ''}</small></div>)}</div>
      <div className="rc-total"><div><span>Total</span><b>{x.complete ? `${x.total}/${x.maxTotal}` : '—'}</b></div><div><span>Percentage</span><b>{x.complete ? `${x.percentage}%` : '—'}</b></div><div><span>Grade</span><b>{x.grade ?? '—'}</b></div><div><span>Class rank</span><b>{x.classRank ? `${ordinal(x.classRank)} of ${x.classSize}` : '—'}</b></div><div><span>Section rank</span><b>{x.sectionRank ? `${ordinal(x.sectionRank)} of ${x.sectionSize}` : '—'}</b></div><div><span>Result</span><b>{x.passed == null ? '—' : x.passed ? 'Pass' : 'Needs support'}</b></div></div>
      <div style={{ marginTop: '1rem' }}><b>Class teacher's remark</b><p style={{ margin: '.3rem 0 0' }}>{r.remark ?? <span className="muted">No remark yet.</span>}</p></div>
      <p className="muted" style={{ fontSize: '.75rem', marginTop: '1rem' }}>Attendance this year: {r.attendance.percentage == null ? 'not recorded' : `${r.attendance.percentage}%`}. Grades: {r.gradeScale.map(([m, g]: [number, string]) => `${g} ≥ ${m}%`).join(' · ')}</p></div></div>);
}

export function FamilyResults() {
  const { child } = useChild(); const [tab, setTab] = useState<'exams' | 'subjects'>('exams'); const [open, setOpen] = useState<number | null>(null);
  const res = useApi<any[]>(`/family/children/${child.id}/results`, [child.id]); const perf = useApi<any>(`/family/children/${child.id}/performance`, [child.id]);
  useEffect(() => setOpen(null), [child.id]);
  if (open) return <ResultDetail examId={open} onBack={() => setOpen(null)} />;
  return (<div className="stack"><h1 className="fam-h">Results</h1><Tabs tabs={[{ id: 'exams', label: 'Exams & tests' }, { id: 'subjects', label: 'Subject performance' }]} value={tab} onChange={setTab} />
    {tab === 'exams' && (res.err ? <ErrorBox message={res.err} /> : !res.data ? <Loading /> : res.data.length === 0 ? <Empty>No results have been published yet.</Empty> : <div className="stack" style={{ gap: '.7rem' }}>{res.data.map((e) => <button key={e.examId} className="fam-result" onClick={() => setOpen(e.examId)}>
      <span className="ring" style={{ ['--p' as any]: e.complete ? e.percentage : 0 }}><b>{e.complete ? `${Math.round(e.percentage)}%` : '—'}</b></span>
      <span style={{ flex: 1, textAlign: 'left' }}><b>{e.name}</b><br /><span className="muted" style={{ fontSize: '.85rem' }}>{e.complete ? `${e.total}/${e.maxTotal} · Grade ${e.grade}` : 'Some subjects pending'}</span></span>
      {e.classRank && <span className="rankpill">{ordinal(e.classRank)}<small>of {e.classSize}</small></span>}</button>)}</div>)}
    {tab === 'subjects' && (!perf.data ? <Loading /> : perf.data.subjects.length === 0 ? <Empty>Subject performance appears once results are published.</Empty> : <>
      <div className="panel"><h2>Average by subject</h2><p className="muted" style={{ fontSize: '.8rem', marginTop: '-.4rem' }}>The bar shows your child’s average. The thin line marks the class average.</p><div className="stack" style={{ gap: '.8rem' }}>{perf.data.subjects.map((s: any) => <div key={s.subject}><div className="flex" style={{ justifyContent: 'space-between' }}><b>{s.subject}</b><span>{s.averagePct}% <span className="muted">· class {s.classAveragePct ?? '—'}%</span></span></div><div className="meter dual"><i style={{ width: `${s.averagePct}%` }} />{s.classAveragePct != null && <i className="cls" style={{ left: `${s.classAveragePct}%` }} aria-hidden />}</div></div>)}</div></div>
      {perf.data.trend.length > 1 && <Trend points={perf.data.trend} />}</>)}</div>);
}
function Trend({ points }: { points: { exam: string; percentage: number }[] }) {
  const W = 320, H = 120, pad = 18; const xs = (i: number) => pad + (i * (W - 2 * pad)) / (points.length - 1); const ys = (v: number) => H - pad - (v / 100) * (H - 2 * pad);
  return (<div className="panel"><h2>Progress over time</h2><svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Percentage by exam: ${points.map((p) => `${p.exam} ${p.percentage}%`).join(', ')}`}><polyline fill="none" stroke="var(--forest-2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={points.map((p, i) => `${xs(i)},${ys(p.percentage)}`).join(' ')} />{points.map((p, i) => <g key={i}><circle cx={xs(i)} cy={ys(p.percentage)} r="4" fill="var(--forest)" /><text x={xs(i)} y={ys(p.percentage) - 8} textAnchor="middle" fontSize="9" fill="var(--ink)">{Math.round(p.percentage)}</text></g>)}</svg><div className="flex" style={{ justifyContent: 'space-between', fontSize: '.72rem' }}>{points.map((p, i) => <span key={i} className="muted">{p.exam}</span>)}</div></div>);
}

export function FamilyHomework() {
  const { child } = useChild(); const { data, err, reload } = useApi<any[]>(`/family/children/${child.id}/homework`, [child.id], true); const t = new Date().toISOString().slice(0, 10);
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  const up = data.filter((h) => h.due_on >= t), past = data.filter((h) => h.due_on < t).reverse();
  const card = (h: any) => <div className="fam-row" key={h.id}><div className="flex" style={{ justifyContent: 'space-between' }}><b>{h.title}</b><span className={'chip ' + (h.kind === 'homework' ? '' : 'sage')}>{h.kind}</span></div><span className="muted" style={{ fontSize: '.85rem' }}>{h.subject} · {h.teacher} · due {dayName(h.due_on)}</span>{h.description && <p style={{ margin: '.3rem 0 0' }}>{h.description}</p>}<HandIn homework={h} onDone={reload} /></div>;
  return (<div className="stack"><h1 className="fam-h">Homework</h1><div className="panel"><h2>Coming up</h2>{up.length ? up.map(card) : <p className="muted">Nothing due. Enjoy the break.</p>}</div>{past.length > 0 && <div className="panel soft"><h2>Recently due</h2>{past.map(card)}</div>}</div>);
}

export function FamilyMore() {
  const { role } = useChild(); const { theme, toggle } = useThemeToggle();
  const items: [string, string, string][] = [['/family/messages', 'Messages', 'Talk to your child’s teachers'], ['/family/meetings', 'Meet a teacher', 'Book a parent-teacher meeting'], ['/family/classwork', 'Classwork', 'What is being taught and shared files'], ['/family/growth', 'Beyond marks', 'Activities, achievements and teacher notes'], ['/family/safety', 'Safety', 'Pickup people, emergency contacts, arrivals'], ['/family/concerns', 'Concerns', 'Raise a concern with the school'], ['/family/transport', 'Transport', 'Route, stop, timings and driver'], ['/family/library', 'Library', 'Books borrowed and due dates'], ['/family/fees', 'Fees & receipts', 'Dues, payments and receipts'], ['/family/timetable', 'Class timetable', 'Weekly periods and teachers'], ['/family/remarks', 'Teacher remarks', 'Praise and notes from teachers'], ['/family/notices', 'Notices & events', 'News from the school'], ...(role === 'parent' ? [['/family/leave', 'Apply for leave', 'Tell the school about an absence'] as [string, string, string]] : []), ['/family/account', 'My account', 'Password and two-step verification']];
  return (<div className="stack"><h1 className="fam-h">{t('More')}</h1>{items.map(([to, title, d]) => <Link key={to} to={to} className="fam-link"><span><b>{t(title)}</b><br /><span className="muted" style={{ fontSize: '.85rem' }}>{t(d)}</span></span><span aria-hidden>→</span></Link>)}<button className="btn ghost" onClick={toggle}>{theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</button><LangSwitch className="btn ghost" /><SignOut /></div>);
}
function SignOut() { const { signOut } = useAuth(); const nav = useNavigate(); return <button className="btn ghost" onClick={async () => { clearSchemaCache(); await signOut(); nav('/login'); }}>{t('Sign out')}</button>; }

export function FamilyTimetable() {
  const { child } = useChild(); const { data, err } = useApi<any>(`/family/children/${child.id}/timetable`, [child.id]); const D = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  return (<div className="stack"><h1 className="fam-h">Timetable</h1><div className="tbl-wrap"><table className="tbl ttgrid"><thead><tr><th>Period</th>{D.map((d) => <th key={d}>{d}</th>)}</tr></thead><tbody>{data.periods.map((p: any) => <tr key={p.id} className={p.is_break ? 'brk' : ''}><td><b>{p.name}</b><div className="muted" style={{ fontSize: '.72rem' }}>{p.starts_at}</div></td>{p.is_break ? <td colSpan={6} className="muted" style={{ textAlign: 'center' }}>Break</td> : D.map((_, i) => { const s = data.slots.find((x: any) => x.day === i + 1 && x.period_id === p.id); return <td key={i}>{s ? <><b style={{ fontSize: '.85rem' }}>{s.subject}</b><div className="muted" style={{ fontSize: '.72rem' }}>{s.teacher}</div></> : ''}</td>; })}</tr>)}</tbody></table></div></div>);
}
export function FamilyRemarks() {
  const { child } = useChild(); const { data, err } = useApi<any[]>(`/family/children/${child.id}/remarks`, [child.id]);
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  return (<div className="stack"><h1 className="fam-h">Teacher remarks</h1>{data.length === 0 ? <Empty>No remarks yet.</Empty> : data.map((r) => <div className="panel" key={r.id}><span className={'chip ' + (r.kind === 'praise' ? 'sage' : '')}>{r.kind}</span><p style={{ margin: '.5rem 0' }}>{r.text}</p><span className="muted" style={{ fontSize: '.82rem' }}>{r.teacher} · {fmtDate(r.created_at)}</span></div>)}</div>);
}
export function FamilyNotices() {
  const n = useApi<any[]>('/family/notices'); const e = useApi<any[]>('/family/events');
  return (<div className="stack"><h1 className="fam-h">Notices & events</h1>{!n.data ? <Loading /> : n.data.length === 0 ? <Empty>No notices.</Empty> : n.data.map((x) => <div className="panel" key={x.id}><div className="flex" style={{ justifyContent: 'space-between' }}><b style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>{x.title}</b><span className="muted" style={{ fontSize: '.82rem' }}>{fmtDate(x.published_at)}</span></div><p style={{ margin: '.5rem 0 0', whiteSpace: 'pre-line' }}>{x.body}</p></div>)}
    {e.data && e.data.length > 0 && <div className="panel"><h2>School calendar</h2>{e.data.map((x) => <div key={x.id} className="fam-row"><b>{x.title}</b><span className="muted"> · {fmtDate(x.starts_at, { weekday: 'short', day: 'numeric', month: 'short' })}{x.location ? ` · ${x.location}` : ''}</span></div>)}</div>}</div>);
}
export function FamilyLeave() {
  const { child, role } = useChild(); const { data, err, reload } = useApi<any[]>(`/family/children/${child.id}/leave`, [child.id]);
  const t = new Date().toISOString().slice(0, 10); const [f, setF] = useState({ fromDate: t, toDate: t, reason: '' }); const [ferr, setFerr] = useState<ApiError | null>(null); const [ok, setOk] = useState(false);
  if (err) return <ErrorBox message={err} />;
  return (<div className="stack"><h1 className="fam-h">Leave for {child.full_name.split(' ')[0]}</h1>
    {role === 'parent' ? <form className="panel" onSubmit={async (e) => { e.preventDefault(); setFerr(null); setOk(false); try { await api(`/family/children/${child.id}/leave`, { method: 'POST', body: f }); setOk(true); setF({ ...f, reason: '' }); reload(); } catch (x) { setFerr(x as ApiError); } }}>
      <h2>Apply for leave</h2>{ferr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{ferr.message}</div>}{ok && <div className="notice ok" role="status" style={{ marginBottom: '1rem' }}>Sent to the class teacher.</div>}
      <div className="two-col"><div className="field"><label htmlFor="fl1">From</label><input id="fl1" type="date" min={t} value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} /></div><div className="field"><label htmlFor="fl2">To</label><input id="fl2" type="date" min={f.fromDate} value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></div></div>
      <div className="field"><label htmlFor="fl3">Reason</label><textarea id="fl3" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div><button className="btn">Send request</button></form> : <div className="notice">Leave is requested by a parent.</div>}
    <div className="panel"><h2>Requests</h2>{!data ? <Loading /> : data.length === 0 ? <p className="muted">No requests yet.</p> : data.map((l) => <div className="fam-row" key={l.id}><div className="flex" style={{ justifyContent: 'space-between' }}><b>{dayName(String(l.from_date).slice(0, 10))}{String(l.from_date).slice(0, 10) !== String(l.to_date).slice(0, 10) && <> – {dayName(String(l.to_date).slice(0, 10))}</>}</b><span className={'badge ' + (l.status === 'approved' ? 'on' : l.status === 'pending' ? 'new' : 'off')}>{l.status}</span></div><span className="muted">{l.reason}</span>{l.decision_note && <div className="muted" style={{ fontSize: '.82rem' }}>Teacher: {l.decision_note}</div>}{l.status === 'pending' && role === 'parent' && <button className="btn ghost sm" style={{ marginTop: '.4rem' }} onClick={async () => { await api(`/family/children/${child.id}/leave/${l.id}/cancel`, { method: 'POST' }); reload(); }}>Cancel request</button>}</div>)}</div></div>);
}

export function FamilyFees() {
  const { child, role } = useChild(); const { data, err, reload } = useApi<any>(`/family/children/${child.id}/fees`, [child.id]);
  const [rc, setRc] = useState<number | null>(null); const [open, setOpen] = useState(false); const t = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<any>({ amount: '', mode: 'upi', reference: '', paidOn: t, note: '' }); const [ferr, setFerr] = useState<ApiError | null>(null); const [ok, setOk] = useState(false);
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  const tot = data.totals; const need = ['cheque', 'upi', 'bank_transfer', 'card', 'online'].includes(f.mode);
  return (<div className="stack"><h1 className="fam-h">Fees</h1>
    <div className="fam-hero"><div className="eyebrow" style={{ color: 'var(--sand)' }}>{child.full_name}</div><h1 style={{ fontSize: '2.6rem' }}>{inr(tot.balance)}</h1><p>{tot.balance > 0 ? 'to pay' : 'nothing to pay'}{tot.overdue > 0 && <> · <b>{inr(tot.overdue)} overdue</b></>}</p></div>
    {ok && <div className="notice ok" role="status">Thank you. The school will confirm your payment and issue a receipt.</div>}
    {role === 'parent' && tot.balance > 0 && <button className="btn" onClick={() => { setFerr(null); setOk(false); setF({ amount: String(tot.balance), mode: 'upi', reference: '', paidOn: t, note: '' }); setOpen(true); }}>I have paid</button>}
    <div className="panel soft"><h2>How to pay</h2><p style={{ margin: 0, whiteSpace: 'pre-line' }}>{data.instructions || 'Please contact the school office for payment options.'}</p><p className="muted" style={{ fontSize: '.82rem', margin: '.6rem 0 0' }}>You can pay in any way the school accepts. After paying, tap “I have paid” so we can match it and send your receipt.</p></div>
    <div className="panel"><h2>Fees</h2>{data.dues.length === 0 ? <p className="muted">No fees have been raised yet.</p> : data.dues.map((d: any) => <div className="fam-row" key={d.id}><div className="flex" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><span><b>{d.description}</b><br /><span className={d.overdue ? 'err' : 'muted'} style={{ fontSize: '.82rem' }}>due {fmtDate(d.dueOn)}{d.overdue ? ' · overdue' : ''}</span></span><span style={{ textAlign: 'right' }}>{d.balance > 0 ? <b>{inr(d.balance)}</b> : <span className="badge on">paid</span>}{d.adjustments < 0 && <div className="muted" style={{ fontSize: '.75rem' }}>discount {inr(-d.adjustments)}</div>}</span></div></div>)}</div>
    {data.claims.some((c: any) => c.status !== 'accepted') && <div className="panel"><h2>Payments you told us about</h2>{data.claims.filter((c: any) => c.status !== 'accepted').map((c: any) => <div className="fam-row" key={c.id}><div className="flex" style={{ justifyContent: 'space-between' }}><span><b>{inr(c.amount)}</b> <span className="muted">{MODE[c.mode]} · {fmtDate(c.paid_on)}</span></span><span className={'badge ' + (c.status === 'pending' ? 'new' : 'off')}>{c.status === 'pending' ? 'being checked' : 'not matched'}</span></div>{c.decision_note && <span className="muted" style={{ fontSize: '.82rem' }}>{c.decision_note}</span>}</div>)}</div>}
    <div className="panel"><h2>Receipts</h2>{data.payments.length === 0 ? <p className="muted">No payments yet.</p> : data.payments.map((p: any) => <button key={p.id} className="fam-row" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' }} onClick={() => setRc(p.id)}><span><b>{inr(p.amount)}</b> <span className="muted">{MODE[p.mode]} · {fmtDate(p.paid_on)}</span></span><code>{p.receipt_no}</code></button>)}</div>
    <Modal open={rc !== null} onClose={() => setRc(null)} label="Receipt">{rc !== null && <Receipt path={`/family/children/${child.id}/receipts/${rc}`} />}</Modal>
    <Modal open={open} onClose={() => setOpen(false)} label="I have paid"><h3>Tell us about your payment</h3><p className="muted" style={{ fontSize: '.88rem' }}>Paid online, at the office, by cheque or transfer? Enter the details and the school will confirm.</p>{ferr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{ferr.message}</div>}
      <div className="two-col"><div className="field"><label htmlFor="cl1">Amount (₹)</label><input id="cl1" type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div><div className="field"><label htmlFor="cl2">Paid by</label><select id="cl2" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{Object.entries(MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="cl3">{need ? 'Transaction / cheque number *' : 'Reference (optional)'}</label><input id="cl3" type="text" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div><div className="field"><label htmlFor="cl4">Date paid</label><input id="cl4" type="date" max={t} value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></div></div>
      <div className="flex"><button className="btn" onClick={async () => { setFerr(null); try { await api(`/family/children/${child.id}/claims`, { method: 'POST', body: { amount: Number(f.amount), mode: f.mode, reference: f.reference || undefined, paidOn: f.paidOn } }); setOpen(false); setOk(true); reload(); } catch (e) { setFerr(e as ApiError); } }}>Send</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div></Modal></div>);
}
