import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { dt, Field, Select, useAction, useApi } from './ui';

const tomorrowLocal = () => { const d = new Date(Date.now() + 86400000); d.setHours(10, 0, 0, 0); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T10:00`; };
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// ============================================ Parent-teacher meetings ============================================
export function MeetingsPage() {
  const { data, err, reload } = useApi<any[]>('/admin/school/meetings/slots'); const a = useAction(); const [open, setOpen] = useState(false);
  const [f, setF] = useState({ startsAt: tomorrowLocal(), minutes: '15', count: '4', mode: 'in_person', location: '' });
  const create = () => a.run(() => api('/admin/school/meetings/slots', { method: 'POST', body: { startsAt: new Date(f.startsAt).toISOString(), minutes: Number(f.minutes), count: Number(f.count), mode: f.mode, location: f.location || undefined } }), () => { setOpen(false); reload(); });
  return (
    <>
      <div className="ph1"><h1>Parent meetings</h1><button className="btn" onClick={() => { a.clear(); setOpen(true); }}>Offer meeting times</button></div>
      <p className="muted" style={{ maxWidth: '62ch' }}>Offer times and parents of your students book them from their phone. You see who booked and what they want to talk about.</p>
      {a.err && !open && <ErrorBox message={a.err} />}
      {err ? <ErrorBox message={err} /> : !data ? <Loading /> : data.length === 0 ? <Empty>You have not offered any times yet.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>How</th><th>Booked by</th><th /></tr></thead><tbody>
          {data.map((m) => <tr key={m.id} style={m.status === 'cancelled' ? { opacity: .5 } : undefined}><td><b>{when(m.starts_at)}</b><br /><span className="muted">{m.minutes} min</span></td><td><span style={{ textTransform: 'capitalize' }}>{m.mode.replace('_', ' ')}</span>{m.location ? <><br /><span className="muted">{m.location}</span></> : null}</td>
            <td>{m.status === 'cancelled' ? <span className="muted">cancelled</span> : m.student ? <><b>{m.student}</b> <span className="muted">({m.parent})</span>{m.agenda ? <><br /><span className="muted">“{m.agenda}”</span></> : null}{m.booking_status === 'completed' && <> <span className="badge on">done</span></>}</> : <span className="muted">open</span>}</td>
            <td className="act">{m.status === 'open' && m.booking_id && m.booking_status === 'booked' && <button className="btn ghost sm" onClick={() => a.run(() => api(`/admin/school/meetings/bookings/${m.booking_id}`, { method: 'PATCH', body: { status: 'completed' } }), reload)}>Mark done</button>} {m.status === 'open' && new Date(m.starts_at) > new Date() && <button className="btn ghost sm" onClick={() => confirm(m.student ? 'Cancel this meeting? The parent will be told.' : 'Remove this time?') && a.run(() => api(`/admin/school/meetings/slots/${m.id}`, { method: 'DELETE' }), reload)}>Cancel</button>}</td></tr>)}</tbody></table></div>)}
      <Modal open={open} onClose={() => setOpen(false)} label="Offer meeting times">
        <h3>Offer meeting times</h3>{a.err && <ErrorBox message={a.err} />}
        <Field label="First meeting starts" type="datetime-local" value={f.startsAt} onChange={(v) => setF({ ...f, startsAt: v })} />
        <div className="two-col"><Field label="Minutes each" type="number" min={5} max={120} value={f.minutes} onChange={(v) => setF({ ...f, minutes: v })} /><Field label="How many back-to-back" type="number" min={1} max={24} value={f.count} onChange={(v) => setF({ ...f, count: v })} help="Times follow each other with no gap." />
          <Select label="How" id="mm" blank={null} value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={[{ value: 'in_person', label: 'In person' }, { value: 'phone', label: 'Phone call' }, { value: 'video', label: 'Video call' }]} /></div>
        <Field label="Where or link (optional)" value={f.location} onChange={(v) => setF({ ...f, location: v })} />
        <div className="flex"><button className="btn" disabled={a.busy} onClick={create}>Offer these times</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div>
      </Modal>
    </>
  );
}

// ============================================ Lesson plans and materials ============================================
export function PlansPage() {
  const [tab, setTab] = useState<'plans' | 'materials'>('plans'); const classes = useApi<any[]>('/admin/school/classwork/my-classes');
  return (
    <>
      <div className="ph1"><h1>Lessons & materials</h1></div>
      <Tabs tabs={[{ id: 'plans' as const, label: 'Lesson plans' }, { id: 'materials' as const, label: 'Learning materials' }]} value={tab} onChange={setTab} />
      {classes.err ? <ErrorBox message={classes.err} /> : !classes.data ? <Loading /> : classes.data.length === 0 ? <Empty>You are not assigned to any class and subject yet. Ask the school office to assign you.</Empty> : tab === 'plans' ? <Plans classes={classes.data} /> : <Materials classes={classes.data} />}
    </>
  );
}
const classOptions = (classes: any[]) => classes.map((c) => ({ value: `${c.section_id}:${c.subject_id}`, label: `${c.section} · ${c.subject}` }));

function Plans({ classes }: { classes: any[] }) {
  const { data, err, reload } = useApi<any[]>('/admin/school/classwork/lesson-plans'); const a = useAction(); const [open, setOpen] = useState(false);
  const [f, setF] = useState({ cls: '', plannedOn: new Date(Date.now() + 86400000).toISOString().slice(0, 10), topic: '', objectives: '', activities: '', resources: '' });
  const save = () => { const [sectionId, subjectId] = f.cls.split(':').map(Number); return a.run(() => api('/admin/school/classwork/lesson-plans', { method: 'POST', body: { sectionId, subjectId, plannedOn: f.plannedOn, topic: f.topic, objectives: f.objectives || undefined, activities: f.activities || undefined, resources: f.resources || undefined } }), () => { setOpen(false); setF({ ...f, topic: '', objectives: '', activities: '', resources: '' }); reload(); }); };
  return (<>
    <p><button className="btn" onClick={() => { a.clear(); setOpen(true); }}>Plan a lesson</button></p>
    {err ? <ErrorBox message={err} /> : !data ? <Loading /> : data.length === 0 ? <Empty>No lesson plans from last week onwards. Plan your next lesson to see it here and in the parents’ “This week” list.</Empty> : (
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Class</th><th>Topic</th><th>Status</th><th /></tr></thead><tbody>
        {data.map((l) => <tr key={l.id}><td>{dt(l.planned_on)}</td><td>{l.section}<br /><span className="muted">{l.subject}</span></td><td><b>{l.topic}</b>{l.objectives && <div className="muted" style={{ fontSize: '.82rem' }}>{l.objectives}</div>}</td><td><span className={'badge' + (l.status === 'done' ? ' on' : '')}>{l.status}</span></td>
          <td className="act">{l.status === 'planned' && <button className="btn ghost sm" onClick={() => a.run(() => api(`/admin/school/classwork/lesson-plans/${l.id}`, { method: 'PATCH', body: { status: 'done' } }), reload)}>Mark taught</button>} <button className="btn ghost sm" onClick={() => confirm('Delete this plan?') && a.run(() => api(`/admin/school/classwork/lesson-plans/${l.id}`, { method: 'DELETE' }), reload)}>Delete</button></td></tr>)}</tbody></table></div>)}
    <Modal open={open} onClose={() => setOpen(false)} label="Plan a lesson"><h3>Plan a lesson</h3>{a.err && <ErrorBox message={a.err} />}
      <div className="two-col"><Select label="Class and subject" id="pc" value={f.cls} onChange={(v) => setF({ ...f, cls: v })} blank="Choose" options={classOptions(classes)} /><Field label="Date" type="date" value={f.plannedOn} onChange={(v) => setF({ ...f, plannedOn: v })} /></div>
      <Field label="Topic" value={f.topic} required onChange={(v) => setF({ ...f, topic: v })} /><Field label="What students should learn" rows={2} value={f.objectives} onChange={(v) => setF({ ...f, objectives: v })} /><Field label="Activities" rows={2} value={f.activities} onChange={(v) => setF({ ...f, activities: v })} /><Field label="Resources" value={f.resources} onChange={(v) => setF({ ...f, resources: v })} />
      <div className="flex"><button className="btn" disabled={a.busy || !f.cls || !f.topic.trim()} onClick={save}>Save plan</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div></Modal>
  </>);
}

function Materials({ classes }: { classes: any[] }) {
  const { data, err, reload } = useApi<any[]>('/admin/school/classwork/materials'); const a = useAction(); const [open, setOpen] = useState(false); const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ cls: '', title: '', description: '', linkUrl: '' });
  const save = () => { const [sectionId, subjectId] = f.cls.split(':'); const fd = new FormData(); fd.set('sectionId', sectionId); fd.set('subjectId', subjectId); fd.set('title', f.title); if (f.description) fd.set('description', f.description); if (f.linkUrl) fd.set('linkUrl', f.linkUrl); if (file.current?.files?.[0]) fd.set('file', file.current.files[0]); return a.run(() => api('/admin/school/classwork/materials', { method: 'POST', form: fd }), () => { setOpen(false); setF({ ...f, title: '', description: '', linkUrl: '' }); reload(); }); };
  return (<>
    <p><button className="btn" onClick={() => { a.clear(); setOpen(true); }}>Share material</button></p>
    {err ? <ErrorBox message={err} /> : !data ? <Loading /> : data.length === 0 ? <Empty>Nothing shared yet. Notes, worksheets and links you add here appear for the students and parents of that class.</Empty> : (
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Title</th><th>Class</th><th>Added</th><th /></tr></thead><tbody>
        {data.map((m) => <tr key={m.id}><td><b>{m.title}</b>{m.description && <div className="muted" style={{ fontSize: '.82rem' }}>{m.description}</div>}{m.link_url && <div><a href={m.link_url} target="_blank" rel="noopener noreferrer">Link</a></div>}{m.has_file && <div className="muted" style={{ fontSize: '.82rem' }}>File: {m.file_name}</div>}</td><td>{m.section}<br /><span className="muted">{m.subject}</span></td><td>{dt(m.added)}</td><td className="act"><button className="btn ghost sm" onClick={() => confirm('Remove this material?') && a.run(() => api(`/admin/school/classwork/materials/${m.id}`, { method: 'DELETE' }), reload)}>Remove</button></td></tr>)}</tbody></table></div>)}
    <Modal open={open} onClose={() => setOpen(false)} label="Share material"><h3>Share learning material</h3>{a.err && <ErrorBox message={a.err} />}
      <Select label="Class and subject" id="mc" value={f.cls} onChange={(v) => setF({ ...f, cls: v })} blank="Choose" options={classOptions(classes)} /><Field label="Title" value={f.title} required onChange={(v) => setF({ ...f, title: v })} /><Field label="Short note (optional)" value={f.description} onChange={(v) => setF({ ...f, description: v })} />
      <Field label="Link (optional)" type="url" value={f.linkUrl} onChange={(v) => setF({ ...f, linkUrl: v })} placeholder="https://" /><div className="field"><label htmlFor="mf">File (PDF or image, up to 5 MB)</label><input id="mf" type="file" ref={file} accept="application/pdf,image/jpeg,image/png,image/webp" /></div>
      <div className="flex"><button className="btn" disabled={a.busy || !f.cls || !f.title.trim()} onClick={save}>Share</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div></Modal>
  </>);
}

// ============================================ Homework submissions and marking ============================================
export function SubmissionsPage() {
  const { id } = useParams(); const nav = useNavigate(); const { data, err, reload } = useApi<any>(`/admin/school/classwork/homework/${id}/submissions`, [id]); const a = useAction();
  const [g, setG] = useState<{ row: any; marks: string; feedback: string; status: 'graded' | 'returned' } | null>(null);
  if (err) return <><ErrorBox message={err} /><button className="btn ghost" onClick={() => nav('/portal/homework')}>← Back</button></>;
  if (!data) return <Loading />;
  const as = data.assignment;
  return (
    <>
      <div className="ph1"><div><div className="muted">{as.section} · {as.subject} · due {dt(as.dueOn)}</div><h1>{as.title}</h1></div><Link className="btn ghost" to="/portal/homework">← Homework</Link></div>
      <div className="kpis"><div className="kpi"><b style={{ fontSize: '1.6rem' }}>{data.counts.submitted} / {data.counts.total}</b><span>Handed in</span></div><div className="kpi"><b style={{ fontSize: '1.6rem' }}>{data.counts.graded}</b><span>Marked</span></div>{as.maxMarks !== null && <div className="kpi"><b style={{ fontSize: '1.6rem' }}>{as.maxMarks}</b><span>Out of</span></div>}</div>
      {a.err && <ErrorBox message={a.err} />}
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Student</th><th>Handed in</th><th>Work</th><th>Marks</th><th /></tr></thead><tbody>
        {data.rows.map((r: any) => <tr key={r.student_id}><td><b>{r.full_name}</b><br /><span className="muted">{r.student_code}</span></td>
          <td>{r.submission_id ? <>{r.submitted_at}{r.late && <> <span className="badge">late</span></>}</> : <span className="muted">not yet</span>}</td>
          <td style={{ maxWidth: 280 }}>{r.body && <div style={{ whiteSpace: 'pre-wrap' }}>{r.body.length > 160 ? r.body.slice(0, 160) + '…' : r.body}</div>}{r.has_file && <a href={`/api/admin/school/classwork/submissions/${r.submission_id}/file`} target="_blank" rel="noopener noreferrer">Open file ({r.file_name})</a>}</td>
          <td>{r.status === 'graded' ? <><b>{r.marks ?? '—'}</b>{r.feedback && <div className="muted" style={{ fontSize: '.82rem' }}>{r.feedback}</div>}</> : r.status === 'returned' ? <span className="badge">returned</span> : '—'}</td>
          <td className="act">{r.submission_id && <button className="btn ghost sm" onClick={() => { a.clear(); setG({ row: r, marks: r.marks?.toString() ?? '', feedback: r.feedback ?? '', status: 'graded' }); }}>{r.status === 'graded' ? 'Change' : 'Mark'}</button>}</td></tr>)}</tbody></table></div>
      <Modal open={!!g} onClose={() => setG(null)} label="Mark work">{g && <>
        <h3>Mark {g.row.full_name}’s work</h3>{a.err && <ErrorBox message={a.err} />}
        {as.maxMarks !== null && <Field label={`Marks (out of ${as.maxMarks})`} type="number" min={0} max={as.maxMarks} value={g.marks} onChange={(v) => setG({ ...g, marks: v })} />}
        <Field label="Feedback for the student and parent" rows={3} value={g.feedback} onChange={(v) => setG({ ...g, feedback: v })} />
        <div className="flex"><button className="btn" disabled={a.busy} onClick={() => a.run(() => api(`/admin/school/classwork/submissions/${g.row.submission_id}/grade`, { method: 'PUT', body: { status: 'graded', marks: g.marks === '' ? undefined : Number(g.marks), feedback: g.feedback || undefined } }), () => { setG(null); reload(); })}>Save marks</button>
          <button className="btn ghost" disabled={a.busy || !g.feedback.trim()} onClick={() => a.run(() => api(`/admin/school/classwork/submissions/${g.row.submission_id}/grade`, { method: 'PUT', body: { status: 'returned', feedback: g.feedback } }), () => { setG(null); reload(); })}>Return for changes</button></div></>}</Modal>
    </>
  );
}

// ============================================ Students who may need support ============================================
export function SupportPage() {
  const { data, err } = useApi<any[]>('/admin/school/growth/support-list');
  return (
    <>
      <div className="ph1"><h1>Students who may need support</h1></div>
      <p className="muted" style={{ maxWidth: '62ch' }}>Built from your own classes: students you flagged, attendance under 75% in the last 30 days, or a latest exam result under 40%. This is a prompt to look closer, not a judgement. Open a student to add an observation or record progress.</p>
      {err ? <ErrorBox message={err} /> : !data ? <Loading /> : data.length === 0 ? <Empty>No one needs attention right now.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Student</th><th>Class</th><th>Why</th><th /></tr></thead><tbody>
          {data.map((s) => <tr key={s.id}><td><b>{s.full_name}</b><br /><span className="muted">{s.student_code}</span></td><td>{s.section}</td><td>{s.reasons.map((r: string) => <div key={r}>{r}</div>)}</td><td className="act"><Link className="btn ghost sm" to={`/portal/students/${s.id}`}>Open</Link></td></tr>)}</tbody></table></div>)}
    </>
  );
}
