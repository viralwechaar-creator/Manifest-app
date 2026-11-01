import { useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { ErrorBox, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { dt, Select, useApi } from './ui';

type Tab = 'years' | 'classes' | 'subjects' | 'departments';

function useAction() {
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<unknown>, after?: () => void) => { setErr(''); try { await fn(); after?.(); return true; } catch (e) { setErr((e as ApiError).message); return false; } };
  return { err, run, clear: () => setErr('') };
}

export function AcademicsPage() {
  const { can } = useAuth(); const edit = can('academics.manage');
  const [tab, setTab] = useState<Tab>('years');
  return (
    <>
      <div className="ph1"><h1>Academic setup</h1></div>
      <Tabs tabs={[{ id: 'years', label: 'Academic years' }, { id: 'classes', label: 'Classes & sections' }, { id: 'subjects', label: 'Subjects' }, { id: 'departments', label: 'Departments' }]} value={tab} onChange={setTab} />
      {tab === 'years' && <Years edit={edit} />}{tab === 'classes' && <Classes edit={edit} />}{tab === 'subjects' && <Subjects edit={edit} />}{tab === 'departments' && <Departments edit={edit} />}
    </>
  );
}

function Years({ edit }: { edit: boolean }) {
  const { data, reload, err: lerr } = useApi<any[]>('/admin/school/years'); const a = useAction();
  const [open, setOpen] = useState(false); const [f, setF] = useState({ label: '', startsOn: '', endsOn: '' });
  if (lerr) return <ErrorBox message={lerr} />; if (!data) return <Loading />;
  return (<>
    {a.err && <ErrorBox message={a.err} />}
    {edit && <p><button className="btn" onClick={() => { a.clear(); setOpen(true); }}>Add academic year</button></p>}
    <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Year</th><th>Starts</th><th>Ends</th><th>Status</th><th /></tr></thead><tbody>
      {data.map((y) => <tr key={y.id}><td><b>{y.label}</b></td><td>{dt(y.starts_on)}</td><td>{dt(y.ends_on)}</td><td>{y.is_current ? <span className="badge on">current</span> : '—'}</td><td className="act">{edit && !y.is_current && <button className="btn ghost sm" onClick={() => a.run(() => api(`/admin/school/years/${y.id}/current`, { method: 'POST' }), reload)}>Make current</button>}</td></tr>)}
      {data.length === 0 && <tr><td colSpan={5} className="muted">No academic years yet.</td></tr>}</tbody></table></div>
    <Modal open={open} onClose={() => setOpen(false)} label="Add academic year"><h3>Add academic year</h3>{a.err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{a.err}</div>}
      <div className="field"><label htmlFor="y1">Label *</label><input id="y1" type="text" placeholder="2027-28" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
      <div className="two-col"><div className="field"><label htmlFor="y2">Starts *</label><input id="y2" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></div><div className="field"><label htmlFor="y3">Ends *</label><input id="y3" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></div></div>
      <div className="flex"><button className="btn" onClick={() => a.run(() => api('/admin/school/years', { method: 'POST', body: f }), () => { setOpen(false); reload(); })}>Add</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div></Modal>
  </>);
}

function Classes({ edit }: { edit: boolean }) {
  const classes = useApi<any[]>('/admin/school/classes'); const years = useApi<any[]>('/admin/school/years');
  const [year, setYear] = useState(''); const sections = useApi<any[]>(`/admin/school/sections${year ? `?year=${year}` : ''}`, [year]);
  const subjects = useApi<any[]>('/admin/school/subjects'); const staff = useApi<any[]>('/admin/school/staff/options');
  const a = useAction(); const [modal, setModal] = useState<null | { type: 'class' | 'section' | 'subjects' | 'teacher'; item?: any }>(null);
  const [f, setF] = useState<any>({});
  if (!classes.data || !sections.data) return <Loading />;
  const curYear = year || String(years.data?.find((y) => y.is_current)?.id ?? '');
  const reload = () => { classes.reload(); sections.reload(); };
  const open = (type: any, item?: any, init: any = {}) => { a.clear(); setF(init); setModal({ type, item }); };
  return (<>
    {a.err && !modal && <ErrorBox message={a.err} />}
    <div className="toolbar"><Select value={year} onChange={setYear} blank="Current year" options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />{edit && <button className="btn" onClick={() => open('class', undefined, { name: '', level: (classes.data!.at(-1)?.level ?? 0) + 1 })}>Add class</button>}</div>
    <div className="stack">{classes.data.map((c) => {
      const secs = sections.data!.filter((s) => s.class_id === c.id);
      return <div className="panel" key={c.id}>
        <div className="flex" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>{c.name}</h2>
          <div className="flex">{edit && <><button className="btn ghost sm" onClick={() => open('subjects', c, { ids: c.subject_ids })}>Subjects ({c.subject_ids.length})</button><button className="btn ghost sm" onClick={() => open('section', c, { name: '', capacity: 35 })}>Add section</button><button className="btn ghost sm" onClick={() => { if (confirm(`Delete ${c.name}? This only works if it has no sections.`)) a.run(() => api(`/admin/school/classes/${c.id}`, { method: 'DELETE' }), reload); }}>Delete</button></>}</div></div>
        <div className="flex" style={{ marginTop: '.8rem', alignItems: 'stretch' }}>{secs.length === 0 && <span className="muted">No sections in this year.</span>}
          {secs.map((s) => <div key={s.id} style={{ border: '1px solid var(--line)', borderRadius: 16, padding: '.7rem 1rem', minWidth: 170 }}>
            <b>Section {s.name}</b><div className="muted" style={{ fontSize: '.82rem' }}>{s.students}/{s.capacity} students</div>
            <div style={{ fontSize: '.82rem' }}>Class teacher: {s.class_teacher ?? <span className="muted">none</span>}</div>
            {edit && <div className="flex" style={{ marginTop: '.4rem', gap: '.3rem' }}><button className="btn ghost sm" onClick={() => open('teacher', s, { staffId: s.class_teacher_id ?? '', capacity: s.capacity })}>Edit</button><button className="btn ghost sm" onClick={() => { if (confirm(`Delete section ${s.name}?`)) a.run(() => api(`/admin/school/sections/${s.id}`, { method: 'DELETE' }), reload); }}>Delete</button></div>}</div>)}</div>
      </div>; })}</div>
    <Modal open={!!modal} onClose={() => setModal(null)} label="Edit">
      {modal && <>{a.err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{a.err}</div>}
        {modal.type === 'class' && <><h3>Add class</h3><div className="field"><label htmlFor="c1">Name *</label><input id="c1" type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div><div className="field"><label htmlFor="c2">Order (level) *</label><input id="c2" type="number" value={f.level} onChange={(e) => setF({ ...f, level: Number(e.target.value) })} /><span className="help">Classes are listed, and students promoted, in this order.</span></div>
          <button className="btn" onClick={() => a.run(() => api('/admin/school/classes', { method: 'POST', body: { name: f.name, level: f.level } }), () => { setModal(null); reload(); })}>Add</button></>}
        {modal.type === 'section' && <><h3>Add section to {modal.item.name}</h3><div className="two-col"><div className="field"><label htmlFor="s1">Section name *</label><input id="s1" type="text" placeholder="A" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div><div className="field"><label htmlFor="s2">Capacity</label><input id="s2" type="number" value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} /></div></div>
          <button className="btn" onClick={() => a.run(() => api('/admin/school/sections', { method: 'POST', body: { classId: modal.item.id, academicYearId: Number(curYear), name: f.name, capacity: f.capacity } }), () => { setModal(null); reload(); })}>Add</button></>}
        {modal.type === 'teacher' && <><h3>Section {modal.item.name}</h3><Select label="Class teacher" id="t1" value={f.staffId} onChange={(v) => setF({ ...f, staffId: v })} blank="None" options={(staff.data ?? []).filter((x) => x.kind === 'teacher').map((x) => ({ value: x.id, label: x.label }))} />
          <div className="field"><label htmlFor="t2">Capacity</label><input id="t2" type="number" value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} /></div>
          <button className="btn" onClick={() => a.run(() => api(`/admin/school/sections/${modal.item.id}`, { method: 'PATCH', body: { classTeacherId: f.staffId ? Number(f.staffId) : null, capacity: f.capacity } }), () => { setModal(null); reload(); })}>Save</button></>}
        {modal.type === 'subjects' && <><h3>Subjects taught in {modal.item.name}</h3><div className="stack" style={{ gap: '.4rem', maxHeight: 320, overflow: 'auto' }}>{(subjects.data ?? []).map((s) => <label className="check" key={s.id}><input type="checkbox" checked={f.ids.includes(s.id)} onChange={() => setF({ ...f, ids: f.ids.includes(s.id) ? f.ids.filter((x: number) => x !== s.id) : [...f.ids, s.id] })} /><span>{s.name} <span className="muted">({s.code})</span></span></label>)}</div>
          <button className="btn" style={{ marginTop: '1rem' }} onClick={() => a.run(() => api(`/admin/school/classes/${modal.item.id}/subjects`, { method: 'PUT', body: { subjectIds: f.ids } }), () => { setModal(null); reload(); })}>Save</button></>}
      </>}
    </Modal>
  </>);
}

function Subjects({ edit }: { edit: boolean }) {
  const { data, reload } = useApi<any[]>('/admin/school/subjects'); const depts = useApi<any[]>('/admin/school/departments'); const a = useAction();
  const [m, setM] = useState<any | null>(null);
  if (!data) return <Loading />;
  return (<>
    {a.err && !m && <ErrorBox message={a.err} />}
    {edit && <p><button className="btn" onClick={() => { a.clear(); setM({ name: '', code: '', departmentId: '' }); }}>Add subject</button></p>}
    <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Code</th><th>Subject</th><th>Department</th><th /></tr></thead><tbody>{data.map((s) => <tr key={s.id}><td><code>{s.code}</code></td><td><b>{s.name}</b></td><td>{s.department ?? '—'}</td><td className="act">{edit && <><button className="btn ghost sm" onClick={() => { a.clear(); setM({ id: s.id, name: s.name, code: s.code, departmentId: s.department_id ?? '' }); }}>Edit</button> <button className="btn ghost sm" onClick={() => { if (confirm(`Delete ${s.name}?`)) a.run(() => api(`/admin/school/subjects/${s.id}`, { method: 'DELETE' }), reload); }}>Delete</button></>}</td></tr>)}</tbody></table></div>
    <Modal open={!!m} onClose={() => setM(null)} label="Subject">{m && <><h3>{m.id ? 'Edit subject' : 'Add subject'}</h3>{a.err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{a.err}</div>}
      <div className="field"><label htmlFor="b1">Name *</label><input id="b1" type="text" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="b2">Short code *</label><input id="b2" type="text" value={m.code} onChange={(e) => setM({ ...m, code: e.target.value })} /></div>
      <Select label="Department" id="b3" value={m.departmentId} onChange={(v) => setM({ ...m, departmentId: v })} blank="None" options={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
      <button className="btn" onClick={() => a.run(() => api(m.id ? `/admin/school/subjects/${m.id}` : '/admin/school/subjects', { method: m.id ? 'PATCH' : 'POST', body: { name: m.name, code: m.code, departmentId: m.departmentId ? Number(m.departmentId) : null } }), () => { setM(null); reload(); })}>Save</button></>}</Modal>
  </>);
}

function Departments({ edit }: { edit: boolean }) {
  const { data, reload } = useApi<any[]>('/admin/school/departments'); const staff = useApi<any[]>('/admin/school/staff/options'); const a = useAction();
  if (!data) return <Loading />;
  return (<>{a.err && <ErrorBox message={a.err} />}
    <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Department</th><th>Staff</th><th>Head of department</th></tr></thead><tbody>{data.map((d) => <tr key={d.id}><td><b>{d.name}</b></td><td>{d.staff_count}</td><td>{edit ? <select className="input" style={{ maxWidth: 240 }} aria-label={`Head of ${d.name}`} value={d.head_staff_id ?? ''} onChange={(e) => a.run(() => api(`/admin/school/departments/${d.id}/head`, { method: 'PUT', body: { staffId: e.target.value ? Number(e.target.value) : null } }), reload)}><option value="">None</option>{(staff.data ?? []).filter((x) => x.kind === 'teacher').map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select> : d.head ?? '—'}</td></tr>)}
      {data.length === 0 && <tr><td colSpan={3} className="muted">No departments yet. Create them under Website → Departments.</td></tr>}</tbody></table></div>
    <p className="muted" style={{ fontSize: '.85rem', marginTop: '1rem' }}>Departments are created and described under Website → Departments, which also controls how they appear on the public site.</p></>);
}
