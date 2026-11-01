import { useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { dt, Select, useApi } from './ui';

const AUD: Record<string, string> = { everyone: 'Everyone', parents: 'Parents', students: 'Students', staff: 'Staff only', section: 'One class' };

export function NoticesPage() {
  const { data, err, reload } = useApi<any[]>('/admin/school/notices'); const sections = useApi<any[]>('/admin/school/sections');
  const [open, setOpen] = useState(false); const [f, setF] = useState<any>({ title: '', body: '', audience: 'everyone', sectionId: '', expiresOn: '' }); const [ferr, setFerr] = useState<ApiError | null>(null);
  return (<>
    <div className="ph1"><h1>Notices</h1><button className="btn" onClick={() => { setFerr(null); setF({ title: '', body: '', audience: 'everyone', sectionId: '', expiresOn: '' }); setOpen(true); }}>Publish notice</button></div>
    <p className="muted">Notices appear in the parent and student portal, and each recipient is notified.</p>
    {err && <ErrorBox message={err} />}
    {!data ? <Loading /> : data.length === 0 ? <Empty>No notices yet.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Published</th><th>Title</th><th>For</th><th>By</th><th /></tr></thead><tbody>{data.map((n) => <tr key={n.id}><td>{dt(n.published_at)}</td><td><b>{n.title}</b><div className="muted" style={{ fontSize: '.8rem' }}>{n.body.slice(0, 90)}</div></td><td><span className="chip sage">{n.audience === 'section' ? n.section : AUD[n.audience]}</span></td><td>{n.author ?? '—'}</td><td className="act"><button className="btn ghost sm" onClick={async () => { if (confirm('Remove this notice?')) { await api(`/admin/school/notices/${n.id}`, { method: 'DELETE' }); reload(); } }}>Remove</button></td></tr>)}</tbody></table></div>}
    <Modal open={open} onClose={() => setOpen(false)} label="Publish notice"><h3>Publish a notice</h3>{ferr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{ferr.message}</div>}
      <div className="field"><label htmlFor="n1">Title *</label><input id="n1" type="text" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
      <div className="field"><label htmlFor="n2">Message *</label><textarea id="n2" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
      <div className="two-col"><Select label="Send to" id="n3" blank={null} value={f.audience} onChange={(v) => setF({ ...f, audience: v })} options={Object.entries(AUD).map(([value, label]) => ({ value, label }))} />
        {f.audience === 'section' ? <Select label="Class" id="n4" value={f.sectionId} onChange={(v) => setF({ ...f, sectionId: v })} blank="Choose" options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.class_name} ${s.name}` }))} /> : <div className="field"><label htmlFor="n5">Hide after (optional)</label><input id="n5" type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></div>}</div>
      <div className="flex"><button className="btn" onClick={async () => { setFerr(null); try { await api('/admin/school/notices', { method: 'POST', body: { title: f.title, body: f.body, audience: f.audience, sectionId: f.audience === 'section' && f.sectionId ? Number(f.sectionId) : null, expiresOn: f.expiresOn || null } }); setOpen(false); reload(); } catch (e) { setFerr(e as ApiError); } }}>Publish</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div></Modal>
  </>);
}

export function StudentLeavePage() {
  const { data, err, reload } = useApi<any[]>('/admin/school/student-leave'); const [dec, setDec] = useState<any | null>(null); const [note, setNote] = useState(''); const [derr, setDerr] = useState('');
  return (<>
    <div className="ph1"><h1>Student leave</h1></div>
    <p className="muted">Requests sent by parents. Class teachers decide for their own class.</p>
    {err && <ErrorBox message={err} />}
    {!data ? <Loading /> : data.length === 0 ? <Empty>No leave requests.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Student</th><th>Class</th><th>Dates</th><th>Reason</th><th>Status</th><th /></tr></thead><tbody>{data.map((l) => <tr key={l.id}><td><b>{l.full_name}</b></td><td>{l.section}</td><td>{dt(l.from_date)}{String(l.from_date).slice(0, 10) !== String(l.to_date).slice(0, 10) && <> – {dt(l.to_date)}</>}</td><td>{l.reason}</td><td><span className={'badge ' + (l.status === 'approved' ? 'on' : l.status === 'pending' ? 'new' : 'off')}>{l.status}</span></td><td className="act">{l.status === 'pending' && <button className="btn ghost sm" onClick={() => { setDec(l); setNote(''); setDerr(''); }}>Review</button>}</td></tr>)}</tbody></table></div>}
    <Modal open={!!dec} onClose={() => setDec(null)} label="Review leave">{dec && <><h3>{dec.full_name}</h3><p>{dt(dec.from_date)} – {dt(dec.to_date)}</p><p className="muted">{dec.reason}</p>{derr && <div className="notice error" role="alert">{derr}</div>}
      <div className="field"><label htmlFor="sl1">Note to the parent (optional)</label><input id="sl1" type="text" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="flex">{(['approved', 'rejected'] as const).map((d) => <button key={d} className={d === 'approved' ? 'btn' : 'btn ghost'} onClick={async () => { try { await api(`/admin/school/student-leave/${dec.id}/decision`, { method: 'POST', body: { decision: d, note } }); setDec(null); reload(); } catch (e) { setDerr((e as ApiError).message); } }}>{d === 'approved' ? 'Approve' : 'Reject'}</button>)}</div></>}</Modal>
  </>);
}

/** Remarks tab and portal-access tab shown on a student's profile. */
export function RemarksPanel({ studentId }: { studentId: number }) {
  const { can } = useAuth(); const { data, err, reload } = useApi<any[]>(`/admin/school/students/${studentId}/remarks`, [studentId]);
  const [f, setF] = useState({ kind: 'note', text: '', visibleToParent: true }); const [ferr, setFerr] = useState('');
  return (<div className="stack">
    {can('remarks.write') && <div className="panel"><h2>Add a remark</h2>{ferr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{ferr}</div>}
      <div className="two-col"><Select label="Type" id="r1" blank={null} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'praise', label: 'Praise' }, { value: 'concern', label: 'Concern' }, { value: 'note', label: 'Note' }]} /><label className="check" style={{ alignSelf: 'end', marginBottom: '1rem' }}><input type="checkbox" checked={f.visibleToParent} onChange={(e) => setF({ ...f, visibleToParent: e.target.checked })} /><span>Show to parents</span></label></div>
      <div className="field"><label htmlFor="r2">Remark</label><textarea id="r2" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></div>
      <button className="btn" onClick={async () => { setFerr(''); try { await api(`/admin/school/students/${studentId}/remarks`, { method: 'POST', body: f }); setF({ ...f, text: '' }); reload(); } catch (e) { setFerr((e as ApiError).message); } }}>Save remark</button></div>}
    {err && <ErrorBox message={err} />}{!data ? <Loading /> : data.length === 0 ? <Empty>No remarks yet.</Empty> : data.map((r) => <div className="panel" key={r.id}><div className="flex" style={{ justifyContent: 'space-between' }}><span><span className="chip sage">{r.kind}</span> {!r.visible_to_parent && <span className="chip">staff only</span>}</span><span className="muted" style={{ fontSize: '.82rem' }}>{r.teacher} · {dt(r.created_at)}</span></div><p style={{ margin: '.5rem 0 0' }}>{r.text}</p></div>)}</div>);
}

export function AccessPanel({ studentId }: { studentId: number }) {
  const { data, reload } = useApi<any>(`/admin/school/students/${studentId}/accounts`, [studentId]); const [out, setOut] = useState<any>(null); const [err, setErr] = useState('');
  const run = async (path: string, body?: any) => { setErr(''); try { setOut(await api(`/admin/school/students/${studentId}/${path}`, { method: 'POST', body })); reload(); } catch (e) { setErr((e as ApiError).message); } };
  if (!data) return <Loading />;
  return (<div className="stack">{err && <ErrorBox message={err} />}
    <div className="panel"><h2>Parent logins</h2><p className="muted" style={{ fontSize: '.85rem' }}>The parent signs in with the student ID. A parent with several children signs in with any child's ID and sees them all.</p>
      {data.guardians.map((g: any) => <div className="fam-row" key={g.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}><span><b>{g.full_name}</b> <span className="chip sage">{g.relation}</span><br /><span className="muted" style={{ fontSize: '.82rem' }}>{g.login_id ? `Login: ${g.login_id}${g.last_login_at ? ` · last sign-in ${dt(g.last_login_at)}` : ' · never signed in'}` : 'No login yet'}</span></span>{!g.login_id && <button className="btn sm" onClick={() => run('parent-login', { guardianId: g.id })}>Create login</button>}</div>)}</div>
    <div className="panel"><h2>Student login</h2>{data.student ? <p>Login: <code>{data.student.login_id}</code> {data.student.last_login_at ? `· last sign-in ${dt(data.student.last_login_at)}` : '· never signed in'}</p> : <><p className="muted" style={{ fontSize: '.85rem' }}>Optional. Lets the student see their own attendance, results and homework.</p><button className="btn ghost sm" onClick={() => run('student-login')}>Create student login</button></>}</div>
    <Modal open={!!out} onClose={() => setOut(null)} label="Login details">{out && <><h3>Login ready</h3>
      <p>Sign in with: <code style={{ fontSize: '1.2rem' }}>{out.loginId}</code>{out.signInWithIds && out.signInWithIds.length > 1 && <span className="muted"> (or any of {out.signInWithIds.join(', ')})</span>}</p>
      {out.temporaryPassword ? <><p>Temporary password (shown once, they must change it at first sign-in):</p><p><code style={{ fontSize: '1.4rem', background: 'var(--olive-soft)', padding: '.5rem .8rem', borderRadius: 12, userSelect: 'all' }}>{out.temporaryPassword}</code></p></> : <p className="muted">This parent already has an account. Their password is unchanged.</p>}<button className="btn" onClick={() => setOut(null)}>Done</button></>}</Modal></div>);
}
