import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { dt, Pager, Select, useApi, usePaged } from './ui';

const STATUS = ['active', 'transferred', 'withdrawn', 'alumni', 'suspended'];

export function StudentsList() {
  const { can } = useAuth(); const nav = useNavigate();
  const [sp] = useState(() => new URLSearchParams(location.search));
  const [q, setQ] = useState(''); const [cls, setCls] = useState(sp.get('class_id') ?? ''); const [sec, setSec] = useState(sp.get('section_id') ?? '');
  const [status, setStatus] = useState(sp.get('status') ?? ''); const [page, setPage] = useState(1);
  const classes = useApi<any[]>('/admin/school/classes'); const sections = useApi<any[]>('/admin/school/sections');
  const { rows, total, loading, err, reload } = usePaged('/admin/school/students', { q, class_id: cls, section_id: sec, status, page });
  const [sel, setSel] = useState<number[]>([]); const [promo, setPromo] = useState(false);
  const secOpts = (sections.data ?? []).filter((s) => !cls || String(s.class_id) === cls).map((s) => ({ value: s.id, label: `${s.class_name} ${s.name}` }));
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <>
      <div className="ph1"><h1>Students</h1><div className="flex">{can('students.manage') && sel.length > 0 && <button className="btn ghost" onClick={() => setPromo(true)}>Promote {sel.length} selected…</button>}{can('students.manage') && <button className="btn" onClick={() => nav('/portal/students/new')}>Register student</button>}</div></div>
      <div className="toolbar">
        <input className="input" type="search" placeholder="Search name or student ID" aria-label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        {can('students.view_all') && <Select value={cls} onChange={(v) => { setCls(v); setSec(''); setPage(1); }} blank="All classes" options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />}
        <Select value={sec} onChange={(v) => { setSec(v); setPage(1); }} blank="All sections" options={secOpts} />
        <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} blank="All statuses" options={STATUS.map((s) => ({ value: s, label: s }))} />
      </div>
      {err && <ErrorBox message={err} />}
      {loading ? <Loading /> : rows.length === 0 ? <Empty>No students match. {can('students.manage') ? 'Use “Register student” to add the first one.' : 'You see only the classes you teach.'}</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr>{can('students.manage') && <th style={{ width: 36 }} />}<th>Student ID</th><th>Name</th><th>Class</th><th>Gender</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r: any) => <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/portal/students/${r.id}`)}>
            {can('students.manage') && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.full_name}`} checked={sel.includes(r.id)} onChange={() => toggle(r.id)} /></td>}
            <td><code>{r.student_code}</code></td><td><b>{r.full_name}</b></td><td>{r.class_name ? `${r.class_name} ${r.section_name}` : '—'}</td><td>{r.gender}</td><td><span className={'badge ' + (r.status === 'active' ? 'on' : 'off')}>{r.status}</span></td></tr>)}</tbody></table></div>)}
      <Pager page={page} total={total} size={25} onPage={setPage} />
      <PromoteModal open={promo} ids={sel} sections={sections.data ?? []} onClose={() => setPromo(false)} onDone={() => { setSel([]); setPromo(false); reload(); }} />
    </>
  );
}

function PromoteModal({ open, ids, sections, onClose, onDone }: any) {
  const [target, setTarget] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [all, setAll] = useState<any[]>([]);
  useEffect(() => { if (open) api('/admin/school/years').then(async (ys: any[]) => { const out: any[] = []; for (const y of ys) out.push(...(await api(`/admin/school/sections?year=${y.id}`)).map((s: any) => ({ ...s, year: y.label }))); setAll(out); }); }, [open]);
  void sections;
  return (
    <Modal open={open} onClose={onClose} label="Promote students">
      <h3>Promote {ids.length} student{ids.length === 1 ? '' : 's'}</h3>
      <p className="muted">Choose the section they move into. It must belong to a later academic year. Their history is kept.</p>
      {err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err}</div>}
      <Select label="Move into" id="pt" value={target} onChange={setTarget} blank="Choose a section" options={all.map((s) => ({ value: s.id, label: `${s.year} · ${s.class_name} ${s.name}` }))} />
      <div className="flex"><button className="btn" disabled={!target || busy} onClick={async () => { setBusy(true); setErr(''); try { await api('/admin/school/students/promote', { method: 'POST', body: { studentIds: ids, targetSectionId: Number(target) } }); onDone(); } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); } }}>{busy ? 'Promoting…' : 'Promote'}</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

const blankG = { fullName: '', relation: 'Father', phone: '', email: '', isPrimary: false };

export function StudentForm() {
  const { id } = useParams(); const nav = useNavigate(); const isNew = !id || id === 'new';
  const sections = useApi<any[]>('/admin/school/sections');
  const existing = useApi<any>(isNew ? null : `/admin/school/students/${id}`);
  const [f, setF] = useState<any>(null); const [gs, setGs] = useState<any[]>([{ ...blankG, isPrimary: true }]);
  const [err, setErr] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState<{ code: string; id: number } | null>(null);
  useEffect(() => {
    if (isNew) setF({ fullName: '', dateOfBirth: '', gender: 'female', sectionId: '', admissionDate: new Date().toISOString().slice(0, 10), address: '', healthNotes: '' });
    else if (existing.data) { const d = existing.data; setF({ fullName: d.full_name, dateOfBirth: String(d.date_of_birth).slice(0, 10), gender: d.gender, sectionId: d.section_id ?? '', address: d.address ?? '', healthNotes: d.health_notes ?? '' }); setGs((d.guardians ?? []).map((g: any) => ({ fullName: g.full_name, relation: g.relation, phone: g.phone ?? '', email: g.email ?? '', isPrimary: g.is_primary }))); }
  }, [isNew, existing.data]);
  if (!f) return existing.err ? <ErrorBox message={existing.err} /> : <Loading />;
  const fe = err?.fields ?? {}; const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const setG = (i: number, k: string, v: any) => setGs(gs.map((g, j) => (j === i ? { ...g, [k]: v } : g)));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const body: any = { fullName: f.fullName, dateOfBirth: f.dateOfBirth, gender: f.gender, sectionId: f.sectionId ? Number(f.sectionId) : null, address: f.address, healthNotes: f.healthNotes };
    const guardians = gs.filter((g) => g.fullName || g.phone).map((g) => ({ ...g, email: g.email || '' }));
    try {
      if (isNew) { const r = await api('/admin/school/students', { method: 'POST', body: { ...body, admissionDate: f.admissionDate, guardians } }); setDone({ code: r.studentCode, id: r.id }); }
      else { await api(`/admin/school/students/${id}`, { method: 'PATCH', body }); await api(`/admin/school/students/${id}/guardians`, { method: 'PUT', body: { guardians } }); nav(`/portal/students/${id}`); }
    } catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  }
  if (done) return (<><div className="ph1"><h1>Student registered</h1></div><div className="panel" style={{ maxWidth: 560 }}>
    <p>The student ID has been issued:</p><p><code style={{ fontSize: '2rem', background: 'var(--olive-soft)', padding: '.4rem 1rem', borderRadius: 14 }}>{done.code}</code></p>
    <p className="muted">The parent portal login is created in a later phase; this ID will be the parent's username.</p>
    <div className="flex"><button className="btn" onClick={() => nav(`/portal/students/${done.id}`)}>Open profile</button><button className="btn ghost" onClick={() => window.location.assign('/portal/students/new')}>Register another</button></div></div></>);
  return (
    <>
      <div className="ph1"><h1>{isNew ? 'Register student' : 'Edit student'}</h1><button className="btn ghost" onClick={() => nav(isNew ? '/portal/students' : `/portal/students/${id}`)}>← Back</button></div>
      <form onSubmit={save} noValidate className="stack" style={{ maxWidth: 820 }}>
        {err && <div className="notice error" role="alert">{err.message}</div>}
        <div className="panel"><h2>Student</h2>
          <div className="two-col">
            <div className={'field' + (fe.fullName ? ' invalid' : '')}><label htmlFor="s1">Full name *</label><input id="s1" type="text" value={f.fullName} onChange={(e) => set('fullName', e.target.value)} />{fe.fullName && <span className="err">{fe.fullName}</span>}</div>
            <div className={'field' + (fe.dateOfBirth ? ' invalid' : '')}><label htmlFor="s2">Date of birth *</label><input id="s2" type="date" value={f.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />{fe.dateOfBirth && <span className="err">{fe.dateOfBirth}</span>}</div>
            <Select label="Gender *" id="s3" value={f.gender} blank={null} onChange={(v) => set('gender', v)} options={['female', 'male', 'other'].map((x) => ({ value: x, label: x }))} />
            <Select label="Class and section" id="s4" value={f.sectionId} onChange={(v) => set('sectionId', v)} blank="Not assigned yet" options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.class_name} ${s.name} (${s.students}/${s.capacity})` }))} />
          </div>
          {isNew && <div className="field"><label htmlFor="s5">Admission date</label><input id="s5" type="date" value={f.admissionDate} onChange={(e) => set('admissionDate', e.target.value)} /><span className="help">The student ID is issued automatically when you register.</span></div>}
        </div>
        <div className="panel"><h2>Sensitive details</h2><p className="muted" style={{ fontSize: '.85rem' }}>Visible only to authorised staff. Add only what the school needs.</p>
          <div className="field"><label htmlFor="s6">Address</label><textarea id="s6" value={f.address} onChange={(e) => set('address', e.target.value)} /></div>
          <div className="field"><label htmlFor="s7">Health notes</label><textarea id="s7" value={f.healthNotes} onChange={(e) => set('healthNotes', e.target.value)} /><span className="help">For example allergies the school must know about.</span></div>
        </div>
        <div className="panel"><h2>Parents / guardians</h2>
          {fe.guardians && <div className="notice error">{fe.guardians}</div>}
          {gs.map((g, i) => (
            <div key={i} style={{ borderTop: i ? '1px solid var(--line)' : 0, paddingTop: i ? '1rem' : 0, marginTop: i ? '1rem' : 0 }}>
              <div className="two-col">
                <div className={'field' + (fe[`guardians.${i}.fullName`] ? ' invalid' : '')}><label htmlFor={`g${i}a`}>Name *</label><input id={`g${i}a`} type="text" value={g.fullName} onChange={(e) => setG(i, 'fullName', e.target.value)} /></div>
                <Select label="Relation" id={`g${i}b`} blank={null} value={g.relation} onChange={(v) => setG(i, 'relation', v)} options={['Father', 'Mother', 'Guardian', 'Other'].map((x) => ({ value: x, label: x }))} />
                <div className={'field' + (fe[`guardians.${i}.phone`] ? ' invalid' : '')}><label htmlFor={`g${i}c`}>Phone *</label><input id={`g${i}c`} type="tel" value={g.phone} onChange={(e) => setG(i, 'phone', e.target.value)} />{fe[`guardians.${i}.phone`] && <span className="err">{fe[`guardians.${i}.phone`]}</span>}<span className="help">A parent with several children is recognised by phone number, so one login can show all of them.</span></div>
                <div className="field"><label htmlFor={`g${i}d`}>Email</label><input id={`g${i}d`} type="email" value={g.email} onChange={(e) => setG(i, 'email', e.target.value)} /></div>
              </div>
              {gs.length > 1 && <button type="button" className="btn ghost sm" onClick={() => setGs(gs.filter((_, j) => j !== i))}>Remove</button>}
            </div>))}
          {gs.length < 4 && <button type="button" className="btn ghost sm" style={{ marginTop: '1rem' }} onClick={() => setGs([...gs, { ...blankG, relation: 'Mother' }])}>+ Add another guardian</button>}
        </div>
        <div className="flex"><button className="btn" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Register and issue ID' : 'Save changes'}</button></div>
      </form>
    </>
  );
}

export function StudentDetail() {
  const { id } = useParams(); const nav = useNavigate(); const { can } = useAuth();
  const { data: s, err, reload } = useApi<any>(`/admin/school/students/${id}`);
  const [tab, setTab] = useState<'profile' | 'guardians' | 'history'>('profile');
  const [stat, setStat] = useState(false); const [ns, setNs] = useState('withdrawn'); const [reason, setReason] = useState(''); const [serr, setSerr] = useState(''); const [busy, setBusy] = useState(false);
  const age = useMemo(() => (s ? Math.floor((Date.now() - new Date(s.date_of_birth).getTime()) / 31557600000) : 0), [s]);
  if (err) return <><ErrorBox message={err} /><button className="btn ghost" onClick={() => nav('/portal/students')}>← Back</button></>;
  if (!s) return <Loading />;
  return (
    <>
      <div className="ph1"><div><div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: '.8rem' }}>{s.student_code}</div><h1>{s.full_name}</h1></div>
        <div className="flex"><button className="btn ghost" onClick={() => nav('/portal/students')}>← Students</button>{can('students.manage') && <><button className="btn ghost" onClick={() => nav(`/portal/students/${id}/edit`)}>Edit</button><button className="btn ghost" onClick={() => { setNs(s.status === 'active' ? 'withdrawn' : 'active'); setStat(true); }}>Change status</button></>}</div></div>
      <div className="kpis"><div className="kpi"><b style={{ fontSize: '1.6rem' }}>{s.class_name ? `${s.class_name} ${s.section_name}` : '—'}</b><span>Class</span></div><div className="kpi"><b style={{ fontSize: '1.6rem' }}>{age}</b><span>Age</span></div><div className="kpi"><b style={{ fontSize: '1.6rem' }}><span className={'badge ' + (s.status === 'active' ? 'on' : 'off')}>{s.status}</span></b><span>Status</span></div><div className="kpi"><b style={{ fontSize: '1.6rem' }}>{dt(s.admission_date)}</b><span>Admitted</span></div></div>
      <Tabs tabs={[{ id: 'profile', label: 'Profile' }, { id: 'guardians', label: 'Parents & guardians' }, { id: 'history', label: 'History' }]} value={tab} onChange={setTab} />
      {tab === 'profile' && <div className="panel"><dl className="kv"><dt>Date of birth</dt><dd>{dt(s.date_of_birth)}</dd><dt>Gender</dt><dd>{s.gender}</dd>
        {'address' in s ? <><dt>Address</dt><dd>{s.address || '—'}</dd><dt>Health notes</dt><dd>{s.health_notes || '—'}</dd></> : <><dt>Address, health</dt><dd className="muted">Hidden: you do not have access to sensitive details.</dd></>}</dl></div>}
      {tab === 'guardians' && <div className="stack">{s.guardians.length === 0 && <Empty>No guardians recorded.</Empty>}{s.guardians.map((g: any) => <div className="panel" key={g.id}><b>{g.full_name}</b> <span className="chip sage">{g.relation}{g.is_primary ? ' · primary' : ''}</span>{g.phone ? <dl className="kv" style={{ marginTop: '.6rem' }}><dt>Phone</dt><dd><a href={`tel:${g.phone}`}>{g.phone}</a></dd>{g.email && <><dt>Email</dt><dd>{g.email}</dd></>}</dl> : <p className="muted" style={{ margin: '.5rem 0 0' }}>Contact details hidden.</p>}</div>)}</div>}
      {tab === 'history' && <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <div className="panel"><h2>Classes by year</h2>{s.history.length === 0 ? <p className="muted">No class history yet.</p> : <table className="tbl" style={{ minWidth: 0 }}><tbody>{s.history.map((h: any) => <tr key={h.academic_year_id}><td><b>{h.year}</b></td><td>{h.section}</td><td>{h.outcome ?? 'current'}</td></tr>)}</tbody></table>}</div>
        <div className="panel"><h2>Status log</h2><table className="tbl" style={{ minWidth: 0 }}><tbody>{s.statusLog.map((l: any, i: number) => <tr key={i}><td>{dt(l.changed_at)}</td><td><b>{l.new_status}</b></td><td>{l.reason}{l.by ? ` · ${l.by}` : ''}</td></tr>)}</tbody></table></div></div>}
      <Modal open={stat} onClose={() => setStat(false)} label="Change status">
        <h3>Change status</h3>
        {serr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{serr}</div>}
        <Select label="New status" id="ns" blank={null} value={ns} onChange={setNs} options={STATUS.filter((x) => x !== s.status).map((x) => ({ value: x, label: x }))} />
        <div className="field"><label htmlFor="rs">Reason *</label><input id="rs" type="text" value={reason} onChange={(e) => setReason(e.target.value)} /><span className="help">Recorded in the status log. Transfer, withdrawal and alumni end the student's current class record.</span></div>
        <div className="flex"><button className="btn" disabled={busy} onClick={async () => { setBusy(true); setSerr(''); try { await api(`/admin/school/students/${id}/status`, { method: 'POST', body: { status: ns, reason } }); setStat(false); setReason(''); reload(); } catch (e) { setSerr((e as ApiError).message); } finally { setBusy(false); } }}>Save</button><button className="btn ghost" onClick={() => setStat(false)}>Cancel</button></div>
      </Modal>
    </>
  );
}
