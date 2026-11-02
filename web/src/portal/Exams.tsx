import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { dt, Select, useApi } from './ui';

const KINDS: Record<string, string> = { class_test: 'Class test', unit_test: 'Unit test', midterm: 'Mid-term', final: 'Final' };

export function ExamsList() {
  const { can } = useAuth(); const nav = useNavigate();
  const { data, err, reload } = useApi<any[]>('/admin/school/exams'); const years = useApi<any[]>('/admin/school/years');
  const [open, setOpen] = useState(false); const [f, setF] = useState<any>({ name: '', kind: 'class_test', academicYearId: '' }); const [ferr, setFerr] = useState<ApiError | null>(null);
  return (<>
    <div className="ph1"><h1>Exams & tests</h1>{can('exams.manage') && <button className="btn" onClick={() => { setFerr(null); setF({ name: '', kind: 'class_test', academicYearId: years.data?.find((y) => y.is_current)?.id ?? '' }); setOpen(true); }}>Create exam</button>}</div>
    {err && <ErrorBox message={err} />}
    {!data ? <Loading /> : data.length === 0 ? <Empty>No exams yet.{can('exams.manage') && ' Create one to start entering marks.'}</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Exam</th><th>Type</th><th>Year</th><th>Subjects</th><th>Marks entered</th><th>Results</th></tr></thead><tbody>{data.map((e) => <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/portal/exams/${e.id}`)}><td><b>{e.name}</b></td><td>{KINDS[e.kind]}</td><td>{e.year}</td><td>{e.subject_count}</td><td>{e.marks_entered}</td><td><span className={'badge ' + (e.results_published ? 'on' : 'new')}>{e.results_published ? 'published' : 'in progress'}</span></td></tr>)}</tbody></table></div>}
    <Modal open={open} onClose={() => setOpen(false)} label="Create exam"><h3>Create exam</h3>{ferr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{ferr.message}</div>}
      <div className="field"><label htmlFor="e1">Name *</label><input id="e1" type="text" placeholder="Class test: Fractions" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <Select label="Type" id="e2" blank={null} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={Object.entries(KINDS).map(([value, label]) => ({ value, label }))} />
      <Select label="Academic year" id="e3" blank={null} value={f.academicYearId} onChange={(v) => setF({ ...f, academicYearId: v })} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />
      <div className="flex"><button className="btn" onClick={async () => { setFerr(null); try { const r = await api('/admin/school/exams', { method: 'POST', body: { name: f.name, kind: f.kind, academicYearId: Number(f.academicYearId) } }); setOpen(false); reload(); nav(`/portal/exams/${r.id}`); } catch (e) { setFerr(e as ApiError); } }}>Create</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div></Modal>
  </>);
}

export function ExamDetail() {
  const { id } = useParams(); const { can } = useAuth(); const nav = useNavigate();
  const exams = useApi<any[]>('/admin/school/exams'); const exam = exams.data?.find((e) => String(e.id) === id);
  const [tab, setTab] = useState<'results' | 'marks' | 'subjects' | 'analytics'>(can('exams.manage') || can('results.view_all') ? 'results' : 'marks');
  const [perr, setPerr] = useState('');
  if (!exams.data) return <Loading />; if (!exam) return <ErrorBox message="Exam not found." />;
  const tabs = [{ id: 'results' as const, label: 'Results & ranking' }, { id: 'marks' as const, label: 'Enter marks' }, ...(can('exams.manage') ? [{ id: 'subjects' as const, label: 'Subjects' }] : []), ...(can('results.view_all') ? [{ id: 'analytics' as const, label: 'Analytics' }] : [])];
  return (<>
    <div className="ph1"><div><div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: '.8rem' }}>{KINDS[exam.kind]} · {exam.year}</div><h1>{exam.name}</h1></div>
      <div className="flex"><button className="btn ghost" onClick={() => nav('/portal/exams')}>← Exams</button>{can('exams.manage') && <button className="btn" onClick={async () => { setPerr(''); try { await api(`/admin/school/exams/${id}/publish`, { method: 'POST', body: { published: !exam.results_published } }); exams.reload(); } catch (e) { setPerr((e as ApiError).message); } }}>{exam.results_published ? 'Unpublish results' : 'Publish results'}</button>}</div></div>
    {perr && <ErrorBox message={perr} />}
    <Tabs tabs={tabs} value={tab} onChange={setTab} />
    {tab === 'results' && <Results id={id!} />}{tab === 'marks' && <Marks id={id!} />}{tab === 'subjects' && <ExamSubjects id={id!} reloadExam={exams.reload} />}{tab === 'analytics' && <Analytics id={id!} />}
  </>);
}

function Results({ id }: { id: string }) {
  const nav = useNavigate(); const sections = useApi<any[]>('/admin/school/sections'); const [sec, setSec] = useState('');
  const { data, err } = useApi<any>(`/admin/school/exams/${id}/results${sec ? `?sectionId=${sec}` : ''}`, [sec]);
  const single = data && data.subjects.length === 1;
  return (<>
    <div className="toolbar"><Select value={sec} onChange={setSec} blank="All classes I can see" options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.class_name} ${s.name}` }))} /></div>
    {err && <ErrorBox message={err} />}
    {!data ? (err ? null : <Loading />) : data.rows.length === 0 ? <Empty>No results yet. Add subjects, then enter marks.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Rank</th><th>Student</th><th>Class</th>{data.subjects.length <= 6 && [...new Map(data.subjects.map((s: any) => [s.subject_id, s.name])).entries()].map(([k, n]) => <th key={k as number}>{n as string}</th>)}<th>Total</th><th>%</th><th>Grade</th><th>Result</th><th /></tr></thead>
      <tbody>{data.rows.map((r: any) => <tr key={r.studentId}>
        <td>{r.classRank ? <span className={'rank' + (r.classRank <= 3 ? ' top' : '')}>{r.classRank}</span> : <span className="muted" title={`${r.pending} subject(s) not entered`}>—</span>}{r.sectionRank && <div className="muted" style={{ fontSize: '.72rem' }}>sec {r.sectionRank}</div>}</td>
        <td><b>{r.name}</b></td><td>{r.section}</td>
        {data.subjects.length <= 6 && [...new Map(data.subjects.map((s: any) => [s.subject_id, s.name])).keys()].map((k) => { const s = r.subjects.find((x: any) => x.subjectId === k); return <td key={k as number}>{!s ? '' : s.pending ? <span className="muted">…</span> : s.absent ? <span className="badge off">AB</span> : <>{s.marks}<span className="muted">/{s.max}</span></>}</td>; })}
        <td>{r.complete ? `${r.total}/${r.maxTotal}` : <span className="muted">{r.pending} pending</span>}</td><td>{r.complete ? r.percentage : '—'}</td><td>{r.grade ?? '—'}</td>
        <td>{r.passed == null ? '—' : <span className={'badge ' + (r.passed ? 'on' : 'off')}>{r.passed ? 'pass' : 'fail'}</span>}</td>
        <td className="act">{!single && <button className="btn ghost sm" onClick={() => nav(`/portal/report/${r.studentId}?examId=${id}`)}>Report card</button>}{single && <button className="btn ghost sm" onClick={() => nav(`/portal/report/${r.studentId}?examId=${id}`)}>Details</button>}</td></tr>)}</tbody></table></div>}
    <p className="muted" style={{ fontSize: '.8rem', marginTop: '.8rem' }}>Students are ranked only once every subject has marks. Equal totals share a rank. AB = absent.</p>
  </>);
}

function Marks({ id }: { id: string }) {
  const subs = useApi<any[]>(`/admin/school/exams/${id}/subjects`); const sections = useApi<any[]>('/admin/school/sections');
  const [xs, setXs] = useState(''); const [sec, setSec] = useState('');
  const [d, setD] = useState<any>(null); const [vals, setVals] = useState<Record<number, { marks: string; absent: boolean }>>({}); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const chosen = subs.data?.find((s) => String(s.id) === xs);
  const secs = (sections.data ?? []).filter((s) => !chosen || s.class_id === chosen.class_id);
  useEffect(() => { setD(null); setErr(''); setMsg(''); if (!xs || !sec) return; api(`/admin/school/marks?examSubjectId=${xs}&sectionId=${sec}`).then((r) => { setD(r); setVals(Object.fromEntries(r.rows.map((x: any) => [x.id, { marks: x.marks == null ? '' : String(x.marks), absent: x.absent }]))); }).catch((e) => setErr(e.message)); }, [xs, sec]);
  const bad = d ? d.rows.filter((r: any) => { const v = vals[r.id]; return v && !v.absent && v.marks !== '' && (isNaN(+v.marks) || +v.marks < 0 || +v.marks > d.maxMarks); }).length : 0;
  return (<>
    <div className="toolbar"><Select value={xs} onChange={(v) => { setXs(v); setSec(''); }} blank="Choose subject" options={(subs.data ?? []).map((s) => ({ value: s.id, label: `${s.class_name} · ${s.subject}` }))} /><Select value={sec} onChange={setSec} blank="Choose section" options={secs.map((s) => ({ value: s.id, label: `${s.class_name} ${s.name}` }))} /></div>
    {err && <ErrorBox message={err} />}{msg && <div className="notice ok" role="status" style={{ marginBottom: '1rem' }}>{msg}</div>}
    {!d ? (!err && <Empty>Choose a subject and section. You can enter marks only for classes and subjects you teach.</Empty>) : <>
      <p><b>{d.exam}</b> · {d.subject} · {d.section} <span className="muted">· out of {d.maxMarks}, pass {d.passMarks}</span></p>
      {d.locked && <div className="notice" style={{ marginBottom: '1rem' }}>Results are published, so marks are locked. Ask an administrator to make a correction.</div>}
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Student</th><th style={{ width: 150 }}>Marks</th><th style={{ width: 110 }}>Absent</th></tr></thead><tbody>{d.rows.map((r: any) => { const v = vals[r.id] ?? { marks: '', absent: false }; const invalid = !v.absent && v.marks !== '' && (isNaN(+v.marks) || +v.marks < 0 || +v.marks > d.maxMarks);
        return <tr key={r.id}><td><b>{r.full_name}</b> <span className="muted" style={{ fontSize: '.8rem' }}>{r.student_code}</span></td>
          <td><input className="input" style={{ maxWidth: 120, borderColor: invalid ? 'var(--danger)' : undefined }} inputMode="decimal" aria-label={`Marks for ${r.full_name}`} disabled={d.locked || v.absent} value={v.marks} onChange={(e) => setVals({ ...vals, [r.id]: { ...v, marks: e.target.value } })} />{invalid && <div className="err" style={{ fontSize: '.75rem' }}>0 to {d.maxMarks}</div>}</td>
          <td><label className="check"><input type="checkbox" disabled={d.locked} checked={v.absent} onChange={(e) => setVals({ ...vals, [r.id]: { marks: '', absent: e.target.checked } })} /><span>Absent</span></label></td></tr>; })}</tbody></table></div>
      {!d.locked && <p><button className="btn" disabled={bad > 0} onClick={async () => { setErr(''); setMsg(''); try { const r = await api('/admin/school/marks', { method: 'PUT', body: { examSubjectId: Number(xs), sectionId: Number(sec), records: d.rows.map((x: any) => { const v = vals[x.id]; return { studentId: x.id, absent: v.absent, marks: v.absent || v.marks === '' ? null : Number(v.marks) }; }) } }); setMsg(`Saved ${r.saved} entries. Blank rows are treated as not yet entered.`); } catch (e) { setErr((e as ApiError).message); } }}>Save marks</button></p>}</>}
  </>);
}

function ExamSubjects({ id, reloadExam }: { id: string; reloadExam: () => void }) {
  const subs = useApi<any[]>(`/admin/school/exams/${id}/subjects`); const classes = useApi<any[]>('/admin/school/classes'); const all = useApi<any[]>('/admin/school/subjects');
  const [f, setF] = useState({ classId: '', subjectId: '', maxMarks: '20', passMarks: '8' }); const [err, setErr] = useState('');
  const cls = classes.data?.find((c) => String(c.id) === f.classId);
  return (<div className="stack">
    {err && <ErrorBox message={err} />}
    <div className="panel"><h2>Add a subject paper</h2><div className="flex" style={{ alignItems: 'end' }}>
      <Select label="Class" id="x1" value={f.classId} onChange={(v) => setF({ ...f, classId: v, subjectId: '' })} blank="Choose" options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      <Select label="Subject" id="x2" value={f.subjectId} onChange={(v) => setF({ ...f, subjectId: v })} blank="Choose" options={(all.data ?? []).filter((s) => cls?.subject_ids.includes(s.id)).map((s) => ({ value: s.id, label: s.name }))} />
      <div className="field"><label htmlFor="x3">Max marks</label><input id="x3" type="number" style={{ maxWidth: 100 }} value={f.maxMarks} onChange={(e) => setF({ ...f, maxMarks: e.target.value })} /></div>
      <div className="field"><label htmlFor="x4">Pass marks</label><input id="x4" type="number" style={{ maxWidth: 100 }} value={f.passMarks} onChange={(e) => setF({ ...f, passMarks: e.target.value })} /></div>
      <div className="field"><button className="btn" disabled={!f.classId || !f.subjectId} onClick={async () => { setErr(''); try { await api(`/admin/school/exams/${id}/subjects`, { method: 'POST', body: { classId: +f.classId, subjectId: +f.subjectId, maxMarks: +f.maxMarks, passMarks: +f.passMarks } }); subs.reload(); reloadExam(); } catch (e) { setErr((e as ApiError).message); } }}>Add</button></div></div></div>
    {!subs.data ? <Loading /> : subs.data.length === 0 ? <Empty>No subjects yet.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Class</th><th>Subject</th><th>Max</th><th>Pass</th><th>Entered</th><th /></tr></thead><tbody>{subs.data.map((s) => <tr key={s.id}><td>{s.class_name}</td><td><b>{s.subject}</b></td><td>{s.max_marks}</td><td>{s.pass_marks}</td><td>{s.entered}</td><td className="act"><button className="btn ghost sm" onClick={async () => { setErr(''); try { await api(`/admin/school/exam-subjects/${s.id}`, { method: 'DELETE' }); subs.reload(); reloadExam(); } catch (e) { setErr((e as ApiError).message); } }}>Remove</button></td></tr>)}</tbody></table></div>}
  </div>);
}

function Analytics({ id }: { id: string }) {
  const { data, err } = useApi<any>(`/admin/school/analytics/exam/${id}`);
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  if (!data.subjects.length) return <Empty>Add subjects and enter marks to see analytics.</Empty>;
  return (<div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))' }}>
    <div className="panel"><h2>Average score by subject</h2><div className="hbars">{data.subjects.map((s: any, i: number) => <div key={i} className="hrow"><span className="hl">{s.class} · {s.subject}</span><span className="hb"><i style={{ width: `${s.averagePct ?? 0}%` }} /></span><b>{s.averagePct == null ? '—' : `${Math.round(s.averagePct)}%`}</b></div>)}</div></div>
    <div className="panel"><h2>Pass rate by subject</h2><div className="hbars">{data.subjects.map((s: any, i: number) => <div key={i} className="hrow"><span className="hl">{s.class} · {s.subject}</span><span className="hb"><i style={{ width: `${s.passRate ?? 0}%` }} /></span><b>{s.passRate == null ? '—' : `${Math.round(s.passRate)}%`}</b></div>)}</div></div>
    {data.toppers.length > 0 && <div className="panel"><h2>Class toppers</h2><table className="tbl" style={{ minWidth: 0 }}><tbody>{data.toppers.map((t: any, i: number) => <tr key={i}><td><b>{t.name}</b></td><td>{t.section}</td><td>{t.percentage}%</td></tr>)}</tbody></table></div>}
  </div>);
}

export function ReportCard() {
  const { studentId } = useParams(); const [sp] = useSearchParams(); const nav = useNavigate(); const { can } = useAuth();
  const { data: r, err, reload } = useApi<any>(`/admin/school/report/${studentId}?examId=${sp.get('examId')}`);
  const [remark, setRemark] = useState(''); const [rerr, setRerr] = useState('');
  useEffect(() => { if (r) setRemark(r.remark ?? ''); }, [r]);
  const sub = useMemo(() => r?.result.subjects ?? [], [r]);
  if (err) return <><ErrorBox message={err} /><button className="btn ghost" onClick={() => nav(-1)}>← Back</button></>;
  if (!r) return <Loading />;
  const x = r.result;
  return (<>
    <div className="ph1 noprint"><h1>Report card</h1><div className="flex"><button className="btn ghost" onClick={() => nav(-1)}>← Back</button><button className="btn" onClick={() => window.print()}>Print / save as PDF</button></div></div>
    {!r.exam.published && <div className="notice noprint" style={{ marginBottom: '1rem' }}>Results are not published yet. Parents and students cannot see this.</div>}
    <div className="panel rc">
      <div className="rc-head"><div><div className="eyebrow">{r.school}</div><h2 style={{ fontSize: '2rem', margin: '.4rem 0' }}>{r.exam.name}</h2><span className="muted">{r.exam.year}</span></div>
        <dl className="kv" style={{ gridTemplateColumns: '90px 1fr' }}><dt>Student</dt><dd><b>{r.student.name}</b></dd><dt>Student ID</dt><dd>{r.student.code}</dd><dt>Class</dt><dd>{r.student.section}</dd><dt>Attendance</dt><dd>{r.attendance.percentage == null ? 'Not recorded' : `${r.attendance.percentage}% (${r.attendance.present}/${r.attendance.marked} days)`}</dd></dl></div>
      <table className="tbl" style={{ minWidth: 0 }}><thead><tr><th>Subject</th><th>Marks</th><th>Out of</th><th>Grade</th><th>Class rank</th></tr></thead><tbody>{sub.map((s: any) => <tr key={s.examSubjectId}><td><b>{s.subject}</b></td><td>{s.pending ? '—' : s.absent ? 'Absent' : s.marks}</td><td>{s.max}</td><td>{s.grade ?? '—'}</td><td>{s.rank ?? '—'}</td></tr>)}</tbody></table>
      <div className="rc-total"><div><span>Total</span><b>{x.complete ? `${x.total}/${x.maxTotal}` : 'Incomplete'}</b></div><div><span>Percentage</span><b>{x.complete ? `${x.percentage}%` : '—'}</b></div><div><span>Grade</span><b>{x.grade ?? '—'}</b></div><div><span>Rank in class {x.classSize ? `(of ${x.classSize})` : ''}</span><b>{x.classRank ?? '—'}</b></div><div><span>Rank in section</span><b>{x.sectionRank ?? '—'}</b></div><div><span>Result</span><b>{x.passed == null ? '—' : x.passed ? 'Pass' : 'Fail'}</b></div></div>
      <div style={{ marginTop: '1.2rem' }}><b>Class teacher's remark</b><p style={{ margin: '.4rem 0 0' }}>{r.remark ?? <span className="muted">No remark yet.</span>}</p></div>
      <p className="muted" style={{ fontSize: '.75rem', marginTop: '1.2rem' }}>Grades: {r.gradeScale.map(([m, g]: [number, string]) => `${g} ≥ ${m}%`).join(' · ')}</p>
    </div>
    <div className="panel noprint" style={{ marginTop: '1rem', maxWidth: 600 }}><h2>Remark</h2>{rerr && <div className="notice error" role="alert">{rerr}</div>}
      <div className="field"><textarea aria-label="Remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Write the class teacher's remark" /></div>
      <button className="btn" disabled={!remark.trim()} onClick={async () => { setRerr(''); try { await api(`/admin/school/report/${studentId}/remark`, { method: 'PUT', body: { examId: Number(sp.get('examId')), remark } }); reload(); } catch (e) { setRerr((e as ApiError).message); } }}>Save remark</button>
      <p className="muted" style={{ fontSize: '.78rem', margin: '.6rem 0 0' }}>Only the class teacher or an administrator can save a remark.{!can('exams.manage') ? '' : ''}</p></div>
  </>);
}

export function HomeworkPage() {
  const { data, err, reload } = useApi<any[]>('/admin/school/homework'); const sections = useApi<any[]>('/admin/school/sections'); const subjects = useApi<any[]>('/admin/school/subjects');
  const [open, setOpen] = useState(false); const [f, setF] = useState<any>({ sectionId: '', subjectId: '', kind: 'homework', title: '', description: '', dueOn: '' }); const [ferr, setFerr] = useState<ApiError | null>(null);
  return (<>
    <div className="ph1"><h1>Homework & assignments</h1><button className="btn" onClick={() => { setFerr(null); setF({ sectionId: '', subjectId: '', kind: 'homework', title: '', description: '', dueOn: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }); setOpen(true); }}>Set new work</button></div>
    {err && <ErrorBox message={err} />}
    {!data ? <Loading /> : data.length === 0 ? <Empty>No homework set yet.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Due</th><th>Class</th><th>Subject</th><th>Title</th><th>Type</th><th>Set by</th><th /></tr></thead><tbody>{data.map((h) => <tr key={h.id}><td>{dt(h.due_on)}</td><td>{h.section}</td><td>{h.subject}</td><td><b>{h.title}</b>{h.description && <div className="muted" style={{ fontSize: '.8rem' }}>{h.description.slice(0, 90)}</div>}</td><td><span className="chip sage">{h.kind}</span></td><td>{h.teacher}</td><td className="act"><Link className="btn ghost sm" to={`/portal/homework/${h.id}`}>Submissions</Link> <button className="btn ghost sm" onClick={async () => { if (confirm('Delete this?')) { try { await api(`/admin/school/homework/${h.id}`, { method: 'DELETE' }); reload(); } catch { /* shown by reload */ } } }}>Delete</button></td></tr>)}</tbody></table></div>}
    <Modal open={open} onClose={() => setOpen(false)} label="Set homework"><h3>Set homework or assignment</h3>{ferr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{ferr.message}</div>}
      <div className="two-col"><Select label="Class" id="h1" value={f.sectionId} onChange={(v) => setF({ ...f, sectionId: v })} blank="Choose" options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.class_name} ${s.name}` }))} />
        <Select label="Subject" id="h2" value={f.subjectId} onChange={(v) => setF({ ...f, subjectId: v })} blank="Choose" options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <Select label="Type" id="h3" blank={null} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'homework', label: 'Homework' }, { value: 'assignment', label: 'Assignment' }]} />
        <div className="field"><label htmlFor="h4">Due date</label><input id="h4" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></div></div>
      <div className="field"><label htmlFor="h5">Title *</label><input id="h5" type="text" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
      <div className="field"><label htmlFor="h6">Instructions</label><textarea id="h6" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="flex"><button className="btn" onClick={async () => { setFerr(null); try { await api('/admin/school/homework', { method: 'POST', body: { sectionId: +f.sectionId, subjectId: +f.subjectId, kind: f.kind, title: f.title, description: f.description, dueOn: f.dueOn } }); setOpen(false); reload(); } catch (e) { setFerr(e as ApiError); } }}>Save</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div></Modal>
  </>);
}
