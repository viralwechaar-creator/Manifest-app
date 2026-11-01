import { useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { dt, Select, useApi } from './ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Slot = { id: number; day: number; period_id: number; period_number: number; section: string; section_id: number; subject: string; subject_id: number; teacher: string; staff_id: number };

function Grid({ periods, slots, cell, onCell }: { periods: any[]; slots: Slot[]; cell: (s: Slot) => React.ReactNode; onCell?: (day: number, p: any, s?: Slot) => void }) {
  return (
    <div className="tbl-wrap"><table className="tbl ttgrid"><thead><tr><th>Period</th>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr></thead>
      <tbody>{periods.map((p) => <tr key={p.id} className={p.is_break ? 'brk' : ''}>
        <td><b>{p.name}</b><div className="muted" style={{ fontSize: '.75rem' }}>{p.starts_at}–{p.ends_at}</div></td>
        {p.is_break ? <td colSpan={6} className="muted" style={{ textAlign: 'center' }}>Break</td> : DAYS.map((_, i) => {
          const s = slots.find((x) => x.day === i + 1 && x.period_id === p.id);
          const inner = s ? cell(s) : <span className="muted">{onCell ? '+' : '—'}</span>;
          return <td key={i}>{onCell ? <button className={'ttcell' + (s ? ' on' : '')} onClick={() => onCell(i + 1, p, s)} aria-label={`${DAYS[i]} ${p.name}`}>{inner}</button> : inner}</td>;
        })}</tr>)}</tbody></table></div>
  );
}

export function TimetablePage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'my' | 'class' | 'teacher' | 'periods'>('my');
  const tabs = [{ id: 'my' as const, label: 'My week' }, { id: 'class' as const, label: 'Class timetable' }, { id: 'teacher' as const, label: 'Teacher timetable' }, ...(can('timetable.manage') ? [{ id: 'periods' as const, label: 'Periods' }] : [])];
  return (<><div className="ph1"><h1>Timetable</h1></div><Tabs tabs={tabs} value={tab} onChange={setTab} />
    {tab === 'my' && <MyWeek />}{tab === 'class' && <ClassView />}{tab === 'teacher' && <TeacherView />}{tab === 'periods' && <Periods />}</>);
}

function MyWeek() {
  const periods = useApi<any[]>('/admin/school/periods'); const my = useApi<any>('/admin/school/timetable/my');
  if (!periods.data || !my.data) return <Loading />;
  if (!my.data.staffId) return <Empty>Your account is not linked to a teacher record, so there is no personal timetable.</Empty>;
  return (<>
    <Grid periods={periods.data} slots={my.data.slots} cell={(s) => <><b>{s.section}</b><div className="muted" style={{ fontSize: '.78rem' }}>{s.subject}</div></>} />
    {my.data.substitutions.length > 0 && <div className="panel" style={{ marginTop: '1.2rem' }}><h2>Substitutions assigned to you</h2><table className="tbl" style={{ minWidth: 0 }}><tbody>{my.data.substitutions.map((s: any) => <tr key={s.id}><td><b>{dt(s.date)}</b></td><td>{s.period}</td><td>{s.section}, {s.subject}</td><td className="muted">covering {s.covering_for}</td></tr>)}</tbody></table></div>}
  </>);
}

function ClassView() {
  const { can } = useAuth(); const edit = can('timetable.manage');
  const sections = useApi<any[]>('/admin/school/sections'); const periods = useApi<any[]>('/admin/school/periods');
  const [sec, setSec] = useState('');
  const tt = useApi<Slot[]>(sec ? `/admin/school/timetable?sectionId=${sec}` : null, [sec]);
  const [m, setM] = useState<null | { day: number; p: any; s?: Slot }>(null);
  const subjects = useApi<any[]>('/admin/school/classes'); const subs = useApi<any[]>('/admin/school/subjects'); const staff = useApi<any>('/admin/school/staff?kind=teacher&status=active');
  const [subj, setSubj] = useState(''); const [tch, setTch] = useState(''); const [err, setErr] = useState('');
  const section = sections.data?.find((s) => String(s.id) === sec);
  const classSubjectIds: number[] = subjects.data?.find((c) => c.id === section?.class_id)?.subject_ids ?? [];
  if (!sections.data || !periods.data) return <Loading />;
  const open = (day: number, p: any, s?: Slot) => { setErr(''); setSubj(s ? String(s.subject_id) : ''); setTch(s ? String(s.staff_id) : ''); setM({ day, p, s }); };
  const save = async () => { setErr(''); try { await api('/admin/school/timetable/slot', { method: 'PUT', body: { sectionId: Number(sec), day: m!.day, periodId: m!.p.id, subjectId: Number(subj), staffId: Number(tch) } }); setM(null); tt.reload(); } catch (e) { setErr((e as ApiError).message); } };
  return (<>
    <div className="toolbar"><Select value={sec} onChange={setSec} blank="Choose a class section" options={sections.data.map((s) => ({ value: s.id, label: `${s.class_name} ${s.name}` }))} /></div>
    {!sec ? <Empty>Choose a class to see its weekly timetable.</Empty> : !tt.data ? <Loading /> : <Grid periods={periods.data} slots={tt.data} cell={(s) => <><b>{s.subject}</b><div className="muted" style={{ fontSize: '.78rem' }}>{s.teacher}</div></>} onCell={edit ? open : undefined} />}
    <Modal open={!!m} onClose={() => setM(null)} label="Edit period">{m && <>
      <h3>{DAYS[m.day - 1]} · {m.p.name}</h3>{err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err}</div>}
      <Select label="Subject" id="tt1" value={subj} onChange={setSubj} blank="Choose" options={(subs.data ?? []).filter((s) => classSubjectIds.includes(s.id)).map((s) => ({ value: s.id, label: s.name }))} />
      <Select label="Teacher" id="tt2" value={tch} onChange={setTch} blank="Choose" options={(staff.data?.rows ?? []).map((s: any) => ({ value: s.id, label: s.full_name }))} />
      <p className="help muted" style={{ fontSize: '.8rem' }}>The teacher must be assigned to this class and subject, and cannot teach two classes in the same period.</p>
      <div className="flex"><button className="btn" disabled={!subj || !tch} onClick={save}>Save</button>{m.s && <button className="btn ghost" onClick={async () => { await api(`/admin/school/timetable/slot/${m.s!.id}`, { method: 'DELETE' }); setM(null); tt.reload(); }}>Clear</button>}<button className="btn ghost" onClick={() => setM(null)}>Cancel</button></div></>}</Modal>
  </>);
}

function TeacherView() {
  const staff = useApi<any>('/admin/school/staff?kind=teacher&status=active'); const periods = useApi<any[]>('/admin/school/periods');
  const [t, setT] = useState(''); const tt = useApi<Slot[]>(t ? `/admin/school/timetable?staffId=${t}` : null, [t]);
  if (!staff.data || !periods.data) return <Loading />;
  const load = tt.data ? new Set(tt.data.map((s) => `${s.day}-${s.period_id}`)).size : 0;
  return (<><div className="toolbar"><Select value={t} onChange={setT} blank="Choose a teacher" options={staff.data.rows.map((s: any) => ({ value: s.id, label: s.full_name }))} />{t && tt.data && <span className="muted">{load} periods a week</span>}</div>
    {!t ? <Empty>Choose a teacher to see their weekly schedule.</Empty> : !tt.data ? <Loading /> : <Grid periods={periods.data} slots={tt.data} cell={(s) => <><b>{s.section}</b><div className="muted" style={{ fontSize: '.78rem' }}>{s.subject}</div></>} />}</>);
}

function Periods() {
  const { data, reload } = useApi<any[]>('/admin/school/periods');
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [ok, setOk] = useState(false);
  const list = rows ?? data;
  if (!list) return <Loading />;
  const set = (i: number, k: string, v: any) => setRows(list.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (<div className="panel" style={{ maxWidth: 760 }}>
    <h2>School day</h2><p className="muted" style={{ fontSize: '.85rem' }}>Define the periods once. Timetables, attendance and substitutions all use them.</p>
    {err && <ErrorBox message={err} />}{ok && <div className="notice ok" role="status" style={{ marginBottom: '1rem' }}>Saved.</div>}
    <div className="stack" style={{ gap: '.5rem' }}>{list.map((p, i) => <div key={i} className="flex" style={{ flexWrap: 'nowrap' }}>
      <input className="input" style={{ maxWidth: 70 }} type="number" aria-label="Number" value={p.number} onChange={(e) => set(i, 'number', Number(e.target.value))} />
      <input className="input" aria-label="Name" value={p.name} onChange={(e) => set(i, 'name', e.target.value)} />
      <input className="input" style={{ maxWidth: 120 }} type="time" aria-label="Starts" value={p.starts_at} onChange={(e) => set(i, 'starts_at', e.target.value)} />
      <input className="input" style={{ maxWidth: 120 }} type="time" aria-label="Ends" value={p.ends_at} onChange={(e) => set(i, 'ends_at', e.target.value)} />
      <label className="check"><input type="checkbox" checked={p.is_break} onChange={(e) => set(i, 'is_break', e.target.checked)} />Break</label>
      <button className="btn ghost sm" onClick={() => setRows(list.filter((_, j) => j !== i))} aria-label="Remove period">✕</button></div>)}</div>
    <div className="flex" style={{ marginTop: '1rem' }}><button className="btn ghost" onClick={() => setRows([...list, { number: (list.at(-1)?.number ?? 0) + 1, name: `Period ${(list.at(-1)?.number ?? 0) + 1}`, starts_at: '09:00', ends_at: '09:45', is_break: false }])}>+ Add period</button>
      <button className="btn" onClick={async () => { setErr(''); setOk(false); try { await api('/admin/school/periods', { method: 'PUT', body: { periods: list.map((p) => ({ number: p.number, name: p.name, startsAt: p.starts_at, endsAt: p.ends_at, isBreak: p.is_break })) } }); setOk(true); setRows(null); reload(); } catch (e) { setErr((e as ApiError).message); } }}>Save periods</button></div>
  </div>);
}
void useMemo;
