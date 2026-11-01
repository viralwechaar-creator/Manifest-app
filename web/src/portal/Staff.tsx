import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { dt, Pager, Select, useApi, usePaged } from './ui';

export function StaffList() {
  const { can } = useAuth(); const nav = useNavigate();
  const [sp] = useState(() => new URLSearchParams(location.search));
  const [q, setQ] = useState(''); const [kind, setKind] = useState(sp.get('kind') ?? ''); const [dept, setDept] = useState(sp.get('department_id') ?? ''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const depts = useApi<any[]>('/admin/school/departments');
  const { rows, total, loading, err } = usePaged('/admin/school/staff', { q, kind, department_id: dept, status, page });
  return (
    <>
      <div className="ph1"><h1>Teachers & staff</h1>{can('staff.manage') && <button className="btn" onClick={() => nav('/portal/staff/new')}>Add staff member</button>}</div>
      <div className="toolbar">
        <input className="input" type="search" placeholder="Search name, code or designation" aria-label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Select value={kind} onChange={(v) => { setKind(v); setPage(1); }} blank="Teaching & non-teaching" options={[{ value: 'teacher', label: 'Teachers' }, { value: 'non_teaching', label: 'Non-teaching staff' }]} />
        <Select value={dept} onChange={(v) => { setDept(v); setPage(1); }} blank="All departments" options={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} blank="All statuses" options={['active', 'on_leave', 'left'].map((s) => ({ value: s, label: s.replace('_', ' ') }))} />
      </div>
      {err && <ErrorBox message={err} />}
      {loading ? <Loading /> : rows.length === 0 ? <Empty>No staff match.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Code</th><th>Name</th><th>Designation</th><th>Department</th><th>Login</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r: any) => <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/portal/staff/${r.id}`)}><td><code>{r.staff_code}</code></td><td><b>{r.full_name}</b></td><td>{r.designation}</td><td>{r.department ?? '—'}</td><td>{r.has_login ? 'Yes' : '—'}</td><td><span className={'badge ' + (r.status === 'active' ? 'on' : r.status === 'on_leave' ? 'contacted' : 'off')}>{r.status.replace('_', ' ')}</span></td></tr>)}</tbody></table></div>)}
      <Pager page={page} total={total} size={25} onPage={setPage} />
    </>
  );
}

export function StaffForm() {
  const nav = useNavigate();
  const depts = useApi<any[]>('/admin/school/departments');
  const roles = useApi<any[]>('/admin/users/roles');
  const [f, setF] = useState<any>({ fullName: '', kind: 'teacher', designation: '', departmentId: '', email: '', phone: '', joinedOn: '', login: false, loginId: '', role: 'teacher' });
  const [err, setErr] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState<any>(null);
  const set = (k: string, v: any) => setF({ ...f, [k]: v }); const fe = err?.fields ?? {};
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const body: any = { fullName: f.fullName, kind: f.kind, designation: f.designation, departmentId: f.departmentId ? Number(f.departmentId) : null, email: f.email, phone: f.phone, joinedOn: f.joinedOn };
      if (f.login) body.login = { loginId: f.loginId, role: f.role };
      setDone(await api('/admin/school/staff', { method: 'POST', body }));
    } catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  }
  if (done) return (<><div className="ph1"><h1>Staff member added</h1></div><div className="panel" style={{ maxWidth: 560 }}><p>Staff code: <code>{done.staffCode}</code></p>
    {done.temporaryPassword && <><p>Give this temporary password to them securely. <b>It will not be shown again.</b></p><p><code style={{ fontSize: '1.3rem', background: 'var(--olive-soft)', padding: '.5rem .8rem', borderRadius: 10, userSelect: 'all' }}>{done.temporaryPassword}</code></p></>}
    <div className="flex"><button className="btn" onClick={() => nav(`/portal/staff/${done.id}`)}>Open profile</button><button className="btn ghost" onClick={() => nav('/portal/staff')}>Back to list</button></div></div></>);
  return (
    <>
      <div className="ph1"><h1>Add staff member</h1><button className="btn ghost" onClick={() => nav('/portal/staff')}>← Back</button></div>
      <form onSubmit={save} noValidate className="panel" style={{ maxWidth: 780 }}>
        {err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err.message}</div>}
        <div className="two-col">
          <div className={'field' + (fe.fullName ? ' invalid' : '')}><label htmlFor="f1">Full name *</label><input id="f1" type="text" value={f.fullName} onChange={(e) => set('fullName', e.target.value)} />{fe.fullName && <span className="err">{fe.fullName}</span>}</div>
          <Select label="Type *" id="f2" blank={null} value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'teacher', label: 'Teacher' }, { value: 'non_teaching', label: 'Non-teaching staff' }]} />
          <div className={'field' + (fe.designation ? ' invalid' : '')}><label htmlFor="f3">Designation *</label><input id="f3" type="text" value={f.designation} onChange={(e) => set('designation', e.target.value)} />{fe.designation && <span className="err">{fe.designation}</span>}</div>
          <Select label="Department" id="f4" value={f.departmentId} onChange={(v) => set('departmentId', v)} blank="None" options={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
          <div className="field"><label htmlFor="f5">Phone</label><input id="f5" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div className={'field' + (fe.email ? ' invalid' : '')}><label htmlFor="f6">Email</label><input id="f6" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />{fe.email && <span className="err">{fe.email}</span>}</div>
          <div className="field"><label htmlFor="f7">Date of joining</label><input id="f7" type="date" value={f.joinedOn} onChange={(e) => set('joinedOn', e.target.value)} /></div>
        </div>
        <label className="check" style={{ margin: '.6rem 0 1rem' }}><input type="checkbox" checked={f.login} onChange={(e) => set('login', e.target.checked)} /><span>Create a portal login for this person</span></label>
        {f.login && <div className="two-col">
          <div className={'field' + (fe['login.loginId'] ? ' invalid' : '')}><label htmlFor="f8">Login ID *</label><input id="f8" type="text" value={f.loginId} onChange={(e) => set('loginId', e.target.value)} />{fe['login.loginId'] && <span className="err">{fe['login.loginId']}</span>}</div>
          <Select label="Role *" id="f9" blank={null} value={f.role} onChange={(v) => set('role', v)} options={(roles.data ?? []).filter((r) => !['student', 'parent'].includes(r.code)).map((r) => ({ value: r.code, label: r.name }))} />
        </div>}
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Add staff member'}</button>
      </form>
    </>
  );
}

export function StaffDetail() {
  const { id } = useParams(); const nav = useNavigate(); const { can } = useAuth();
  const { data: s, err, reload } = useApi<any>(`/admin/school/staff/${id}`);
  const sections = useApi<any[]>('/admin/school/sections'); const subjects = useApi<any[]>('/admin/school/subjects');
  const [add, setAdd] = useState(false); const [sec, setSec] = useState(''); const [sub, setSub] = useState(''); const [aerr, setAerr] = useState('');
  const [stat, setStat] = useState(''); const [serr, setSerr] = useState('');
  useEffect(() => { if (s) setStat(s.status); }, [s]);
  if (err) return <ErrorBox message={err} />;
  if (!s) return <Loading />;
  const save = async (assignments: { sectionId: number; subjectId: number }[]) => { setAerr(''); try { await api(`/admin/school/staff/${id}/assignments`, { method: 'PUT', body: { assignments } }); setAdd(false); setSec(''); setSub(''); reload(); } catch (e) { setAerr((e as ApiError).message); } };
  const cur = s.assignments.map((a: any) => ({ sectionId: a.section_id, subjectId: a.subject_id }));
  return (
    <>
      <div className="ph1"><div><div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: '.8rem' }}>{s.staff_code}</div><h1>{s.full_name}</h1></div><button className="btn ghost" onClick={() => nav('/portal/staff')}>← Staff</button></div>
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
        <div className="panel"><h2>Details</h2>
          <dl className="kv"><dt>Designation</dt><dd>{s.designation}</dd><dt>Type</dt><dd>{s.kind === 'teacher' ? 'Teacher' : 'Non-teaching staff'}</dd><dt>Department</dt><dd>{s.department ?? '—'}</dd><dt>Joined</dt><dd>{dt(s.joined_on)}</dd><dt>Portal login</dt><dd>{s.login_id ?? 'None'}</dd>
            {'phone' in s && <><dt>Phone</dt><dd>{s.phone ?? '—'}</dd><dt>Email</dt><dd>{s.email ?? '—'}</dd></>}</dl>
          {can('staff.manage') && <div className="field" style={{ marginTop: '1rem' }}><label htmlFor="st">Status</label>
            <div className="flex"><select id="st" className="input" style={{ maxWidth: 200 }} value={stat} onChange={(e) => setStat(e.target.value)}>{['active', 'on_leave', 'left'].map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</select>
              <button className="btn ghost sm" disabled={stat === s.status} onClick={async () => { if (stat === 'left' && !confirm('Mark as left? Their login will be disabled immediately and they will be removed as class teacher or department head.')) return; setSerr(''); try { await api(`/admin/school/staff/${id}`, { method: 'PATCH', body: { status: stat } }); reload(); } catch (e) { setSerr((e as ApiError).message); } }}>Update</button></div>
            {serr && <span className="err">{serr}</span>}<span className="help">Marking someone “on leave” is how their periods become vacant for substitution (coming in the timetable phase).</span></div>}
        </div>
        <div className="panel"><h2>Teaching</h2>
          {s.classTeacherOf.length > 0 && <p>Class teacher of: {s.classTeacherOf.map((c: any) => <span className="chip sage" key={c.id} style={{ marginRight: 6 }}>{c.section}</span>)}</p>}
          {s.kind !== 'teacher' ? <p className="muted">Not a teaching role.</p> : <>
            {s.assignments.length === 0 ? <p className="muted">No classes assigned yet.</p> : <table className="tbl" style={{ minWidth: 0 }}><tbody>{s.assignments.map((a: any) => <tr key={`${a.section_id}-${a.subject_id}`}><td><b>{a.section}</b></td><td>{a.subject}</td>{can('staff.manage') && <td className="act"><button className="btn ghost sm" onClick={() => save(cur.filter((x: any) => !(x.sectionId === a.section_id && x.subjectId === a.subject_id)))}>Remove</button></td>}</tr>)}</tbody></table>}
            {can('staff.manage') && <button className="btn ghost sm" style={{ marginTop: '1rem' }} onClick={() => setAdd(true)}>+ Assign class and subject</button>}</>}
        </div>
      </div>
      <Modal open={add} onClose={() => setAdd(false)} label="Assign class">
        <h3>Assign class and subject</h3>{aerr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{aerr}</div>}
        <Select label="Class and section" id="as1" value={sec} onChange={setSec} blank="Choose" options={(sections.data ?? []).map((x) => ({ value: x.id, label: `${x.class_name} ${x.name}` }))} />
        <Select label="Subject" id="as2" value={sub} onChange={setSub} blank="Choose" options={(subjects.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <div className="flex"><button className="btn" disabled={!sec || !sub} onClick={() => save([...cur, { sectionId: Number(sec), subjectId: Number(sub) }])}>Assign</button><button className="btn ghost" onClick={() => setAdd(false)}>Cancel</button></div>
      </Modal>
    </>
  );
}
