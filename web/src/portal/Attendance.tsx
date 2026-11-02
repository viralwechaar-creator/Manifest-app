import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { Select, useApi } from './ui';

const today = () => new Date().toISOString().slice(0, 10);
/** Sunday is not a school day, so default to the previous Saturday. */
const lastSchoolDay = () => { const d = new Date(); if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const SSTAT = ['present', 'absent', 'late', 'excused']; const TSTAT = ['present', 'absent', 'late', 'half_day', 'on_leave'];

function Roster({ rows, statuses, value, onChange, disabled }: { rows: any[]; statuses: string[]; value: Record<number, string>; onChange: (id: number, s: string) => void; disabled: boolean }) {
  return (
    <div className="roster">{rows.map((r) => (
      <div className="rrow" key={r.id}>
        <div className="rname"><b>{r.full_name}</b><span>{r.student_code ?? r.staff_code}</span></div>
        <div className="seg" role="radiogroup" aria-label={`Status for ${r.full_name}`}>{statuses.map((s) => <button key={s} role="radio" aria-checked={value[r.id] === s} disabled={disabled} className={'segb ' + s + (value[r.id] === s ? ' on' : '')} onClick={() => onChange(r.id, s)}>{s.replace('_', ' ')}</button>)}</div>
      </div>
    ))}</div>
  );
}

export function AttendancePage() {
  const { can } = useAuth();
  const tabs = [...(can('attendance.students.mark') || can('attendance.students.view_all') ? [{ id: 'students' as const, label: 'Students' }] : []), ...(can('attendance.staff.view') ? [{ id: 'staff' as const, label: 'Staff' }] : []), ...(can('attendance.students.view_all') ? [{ id: 'summary' as const, label: 'Summary' }] : [])];
  const [tab, setTab] = useState<'students' | 'staff' | 'summary'>(tabs[0]?.id ?? 'students');
  if (!tabs.length) return <Empty>You do not have access to attendance.</Empty>;
  return (<><div className="ph1"><h1>Attendance</h1></div><Tabs tabs={tabs} value={tab} onChange={setTab} />{tab === 'students' && <StudentAtt />}{tab === 'staff' && <StaffAtt />}{tab === 'summary' && <Summary />}</>);
}

function StudentAtt() {
  const { can } = useAuth(); const sections = useApi<any[]>('/admin/school/sections'); const my = useApi<any>('/admin/school/timetable/my');
  const [sec, setSec] = useState(''); const [date, setDate] = useState(lastSchoolDay());
  const [d, setD] = useState<any>(null); const [vals, setVals] = useState<Record<number, string>>({}); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const options = (sections.data ?? []).filter((s) => can('attendance.students.view_all') || s.class_teacher_id === my.data?.staffId);
  useEffect(() => { if (!sec) { setD(null); return; } setErr(''); setMsg(''); api(`/admin/school/attendance/students?sectionId=${sec}&date=${date}`).then((r) => { setD(r); setVals(Object.fromEntries(r.rows.filter((x: any) => x.status).map((x: any) => [x.id, x.status]))); }).catch((e) => { setD(null); setErr(e.message); }); }, [sec, date]);
  const unmarked = d ? d.rows.filter((r: any) => !vals[r.id]).length : 0;
  return (<>
    <div className="toolbar"><Select value={sec} onChange={setSec} blank="Choose a class" options={options.map((s) => ({ value: s.id, label: `${s.class_name} ${s.name}` }))} /><input className="input" style={{ maxWidth: 170 }} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" /></div>
    {err && <ErrorBox message={err} />}{msg && <div className="notice ok" role="status" style={{ marginBottom: '1rem' }}>{msg}</div>}
    {!sec ? <Empty>{options.length ? 'Choose a class to mark attendance.' : 'You are not the class teacher of any section. Only class teachers mark attendance.'}</Empty> : !d ? (err ? null : <Loading />) : d.rows.length === 0 ? <Empty>No active students in this class.</Empty> : <>
      <div className="flex" style={{ marginBottom: '.8rem' }}><b>{d.section}</b><span className="muted">{d.rows.length - unmarked} of {d.rows.length} marked</span>{d.canMark && <button className="btn ghost sm" onClick={() => setVals(Object.fromEntries(d.rows.map((r: any) => [r.id, vals[r.id] ?? 'present'])))}>Mark the rest present</button>}</div>
      <Roster rows={d.rows} statuses={SSTAT} value={vals} onChange={(id, s) => setVals({ ...vals, [id]: s })} disabled={!d.canMark} />
      {d.canMark && <p className="save-row"><button className="btn" disabled={busy || unmarked > 0} onClick={async () => { setBusy(true); setErr(''); setMsg(''); try { const r = await api('/admin/school/attendance/students', { method: 'PUT', body: { sectionId: Number(sec), date, records: d.rows.map((x: any) => ({ studentId: x.id, status: vals[x.id] })) } }); setMsg(`Attendance saved for ${r.saved} students.`); } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); } }}>{unmarked ? `${unmarked} still to mark` : 'Save attendance'}</button></p>}</>}
  </>);
}

function StaffAtt() {
  const [date, setDate] = useState(today()); const [d, setD] = useState<any>(null); const [vals, setVals] = useState<Record<number, string>>({}); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  useEffect(() => { setD(null); setMsg(''); api(`/admin/school/attendance/staff?date=${date}`).then((r) => { setD(r); setVals(Object.fromEntries(r.rows.filter((x: any) => x.status).map((x: any) => [x.id, x.status]))); }).catch((e) => setErr(e.message)); }, [date]);
  if (err) return <ErrorBox message={err} />;
  const todo = d ? d.rows.filter((r: any) => !vals[r.id]).length : 0;
  return (<>
    <div className="toolbar"><input className="input" style={{ maxWidth: 170 }} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" /></div>
    {msg && <div className="notice ok" role="status" style={{ marginBottom: '1rem' }}>{msg}</div>}
    {!d ? <Loading /> : <>
      <div className="flex" style={{ marginBottom: '.8rem' }}><span className="muted">{d.rows.length - todo} of {d.rows.length} marked</span>{d.canMark && <button className="btn ghost sm" onClick={() => setVals(Object.fromEntries(d.rows.map((r: any) => [r.id, vals[r.id] ?? 'present'])))}>Mark the rest present</button>}</div>
      <Roster rows={d.rows} statuses={TSTAT} value={vals} onChange={(id, s) => setVals({ ...vals, [id]: s })} disabled={!d.canMark} />
      {d.canMark && <p className="save-row"><button className="btn" disabled={todo > 0} onClick={async () => { setMsg(''); try { const r = await api('/admin/school/attendance/staff', { method: 'PUT', body: { date, records: d.rows.map((x: any) => ({ staffId: x.id, status: vals[x.id] })) } }); setMsg(`Saved for ${r.saved} staff. Teachers marked absent will appear under Substitutions if they have classes today.`); } catch (e) { setErr((e as ApiError).message); } }}>{todo ? `${todo} still to mark` : 'Save staff attendance'}</button></p>}</>}
  </>);
}

function Summary() {
  const first = today().slice(0, 8) + '01'; const [from, setFrom] = useState(first); const [to, setTo] = useState(today());
  const { data } = useApi<any[]>(`/admin/school/attendance/summary?from=${from}&to=${to}`, [from, to]);
  return (<><div className="toolbar"><label className="muted">From <input className="input" style={{ maxWidth: 160 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="muted">To <input className="input" style={{ maxWidth: 160 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
    {!data ? <Loading /> : <div className="panel"><div className="hbars">{data.map((s) => <div key={s.section_id} className="hrow"><span className="hl">{s.section}</span><span className="hb"><i style={{ width: `${s.pct ?? 0}%` }} /></span><b>{s.pct ? `${Math.round(s.pct)}%` : '—'}</b></div>)}</div>
      <p className="muted" style={{ fontSize: '.8rem', marginTop: '.8rem' }}>Share of marked student-days present or late. Sections with no marked days show a dash.</p></div>}</>);
}
