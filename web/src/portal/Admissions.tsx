import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { dt, Pager, Select, useApi, usePaged } from './ui';

const STATUSES = ['submitted', 'under_review', 'documents_pending', 'verified', 'approved', 'enrolled', 'rejected', 'withdrawn'];
const pretty = (s: string) => s.replace(/_/g, ' ');
const badge = (s: string) => (['approved', 'enrolled', 'verified'].includes(s) ? 'on' : ['rejected', 'withdrawn'].includes(s) ? 'off' : 'new');
const KIND: Record<string, string> = { birth_certificate: 'Birth certificate', photo: 'Photo', address_proof: 'Address proof', transfer_certificate: 'Transfer certificate', previous_marksheet: 'Previous marksheet', other: 'Other' };

export function AdmissionsList() {
  const nav = useNavigate(); const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const { rows, total, loading, err } = usePaged('/admin/school/admissions', { q, status, page });
  return (<>
    <div className="ph1"><h1>Admission applications</h1></div>
    <div className="toolbar"><input className="input" type="search" placeholder="Search name, reference or phone" aria-label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /><Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} blank="All statuses" options={STATUSES.map((s) => ({ value: s, label: pretty(s) }))} /></div>
    {err && <ErrorBox message={err} />}
    {loading ? <Loading /> : rows.length === 0 ? <Empty>No applications. They appear here as families apply from the website.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Reference</th><th>Student</th><th>Class</th><th>Parent</th><th>Documents</th><th>Applied</th><th>Status</th></tr></thead>
      <tbody>{rows.map((r: any) => <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/portal/admissions/${r.id}`)}><td><code>{r.reference}</code></td><td><b>{r.student_name}</b></td><td>{r.class_name}</td><td>{r.guardian_name}</td><td>{r.docs_verified}/{r.docs} verified</td><td>{dt(r.submitted_at)}</td><td><span className={'badge ' + badge(r.status)}>{pretty(r.status)}</span></td></tr>)}</tbody></table></div>}
    <Pager page={page} total={total} size={25} onPage={setPage} />
  </>);
}

export function AdmissionDetail() {
  const { id } = useParams(); const nav = useNavigate(); const { can } = useAuth(); const edit = can('admissions.review');
  const { data: a, err, reload } = useApi<any>(`/admin/school/admissions/${id}`);
  const [modal, setModal] = useState<null | { type: 'note'; action: string; title: string; need: boolean } | { type: 'reject-doc'; doc: any } | { type: 'enrol' } | { type: 'done'; out: any }>(null);
  const [note, setNote] = useState(''); const [sec, setSec] = useState(''); const [merr, setMerr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<any>, ok?: (r: any) => void) => { setMerr(''); setBusy(true); try { const r = await fn(); ok ? ok(r) : setModal(null); setNote(''); reload(); } catch (e) { setMerr((e as ApiError).message); } finally { setBusy(false); } };
  if (err) return <ErrorBox message={err} />; if (!a) return <Loading />;
  const closed = ['rejected', 'withdrawn', 'enrolled'].includes(a.status); const post = (p: string, body?: any) => api(`/admin/school/admissions/${id}/${p}`, { method: 'POST', body: body ?? {} });
  return (<>
    <div className="ph1"><div><div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: '.8rem' }}>{a.reference} · applied {dt(a.submitted_at)}</div><h1>{a.student_name}</h1></div>
      <div className="flex"><button className="btn ghost" onClick={() => nav('/portal/admissions')}>← Applications</button><span className={'badge ' + badge(a.status)} style={{ fontSize: '.85rem' }}>{pretty(a.status)}</span></div></div>
    {edit && !closed && <div className="panel" style={{ marginBottom: '1rem' }}><div className="flex">
      {a.status === 'submitted' && <button className="btn" onClick={() => run(() => post('action', { action: 'start_review' }))}>Start review</button>}
      <button className="btn ghost" onClick={() => { setNote(''); setMerr(''); setModal({ type: 'note', action: 'request_documents', title: 'Ask for documents or changes', need: true }); }}>Request documents</button>
      {['submitted', 'under_review', 'documents_pending', 'verified'].includes(a.status) && <button className="btn" onClick={() => run(() => post('approve'))}>Approve</button>}
      {a.status === 'approved' && <button className="btn" onClick={() => { setMerr(''); setSec(''); setModal({ type: 'enrol' }); }}>Confirm admission and enrol</button>}
      <button className="btn ghost" onClick={() => { setNote(''); setMerr(''); setModal({ type: 'note', action: 'reject', title: 'Reject application', need: true }); }}>Reject</button>
      <button className="btn ghost" onClick={() => { setNote(''); setMerr(''); setModal({ type: 'note', action: 'withdraw', title: 'Mark as withdrawn', need: false }); }}>Withdrawn by family</button></div>
      {merr && !modal && <div className="notice error" role="alert" style={{ marginTop: '.8rem' }}>{merr}</div>}</div>}
    {a.missingVerified.length > 0 && !closed && <div className="notice" style={{ marginBottom: '1rem' }}>Needed before approval: {a.missingVerified.map((k: string) => KIND[k]).join(', ')}</div>}
    <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
      <div className="panel"><h2>Application</h2><dl className="kv"><dt>Applying for</dt><dd>{a.class_name} · {a.year}</dd><dt>Date of birth</dt><dd>{dt(a.date_of_birth)}</dd><dt>Gender</dt><dd>{a.gender}</dd><dt>Previous school</dt><dd>{a.previous_school || '—'}</dd><dt>Address</dt><dd>{a.address}</dd><dt>Health notes</dt><dd>{a.health_notes || '—'}</dd>
        <dt>Parent</dt><dd>{a.guardian_name} ({a.guardian_relation})</dd><dt>Phone</dt><dd><a href={`tel:${a.guardian_phone}`}>{a.guardian_phone}</a></dd><dt>Email</dt><dd>{a.guardian_email || '—'}</dd><dt>Consent</dt><dd>{a.consent_purpose} (notice v{a.consent_notice_version})</dd>{a.student_id && <><dt>Student</dt><dd><a href={`/portal/students/${a.student_id}`}>Open student record →</a></dd></>}</dl></div>
      <div className="panel"><h2>Documents</h2>{a.documents.length === 0 ? <p className="muted">Nothing uploaded yet.</p> : a.documents.map((d: any) => <div className="fam-row" key={d.id}><div className="flex" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><span><b>{KIND[d.kind]}</b><br /><span className="muted" style={{ fontSize: '.8rem' }}>{d.original_name} · {Math.round(d.size_bytes / 1024)} KB</span>{d.review_note && <span className="err" style={{ display: 'block', fontSize: '.8rem' }}>{d.review_note}</span>}</span><span className={'badge ' + (d.status === 'verified' ? 'on' : d.status === 'rejected' ? 'off' : 'new')}>{d.status}</span></div>
        {edit && <div className="flex" style={{ marginTop: '.4rem' }}><a className="btn ghost sm" href={`/api/admin/school/admissions/${id}/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer">Open</a>{!closed && <><button className="btn sm" disabled={d.status === 'verified'} onClick={() => run(() => api(`/admin/school/admissions/${id}/documents/${d.id}/verify`, { method: 'POST', body: { status: 'verified' } }))}>Verify</button><button className="btn ghost sm" onClick={() => { setNote(''); setMerr(''); setModal({ type: 'reject-doc', doc: d }); }}>Reject</button></>}</div>}</div>)}</div>
      <div className="panel"><h2>Timeline</h2><table className="tbl" style={{ minWidth: 0 }}><tbody>{a.events.map((e: any, i: number) => <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{dt(e.at)}</td><td><b>{pretty(e.action)}</b>{e.note && <div className="muted" style={{ fontSize: '.82rem' }}>{e.note}</div>}</td><td className="muted">{e.actor === 'internal' ? 'system' : e.actor}</td></tr>)}</tbody></table></div></div>
    <Modal open={modal?.type === 'note'} onClose={() => setModal(null)} label="Add a note">{modal?.type === 'note' && <><h3>{modal.title}</h3>{merr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{merr}</div>}<p className="muted" style={{ fontSize: '.88rem' }}>This note is shown to the family on the tracking page.</p><div className="field"><label htmlFor="am1">Note{modal.need && ' *'}</label><textarea id="am1" value={note} onChange={(e) => setNote(e.target.value)} /></div><div className="flex"><button className="btn" disabled={busy} onClick={() => run(() => post('action', { action: modal.action, note: note || undefined }))}>Confirm</button><button className="btn ghost" onClick={() => setModal(null)}>Cancel</button></div></>}</Modal>
    <Modal open={modal?.type === 'reject-doc'} onClose={() => setModal(null)} label="Reject document">{modal?.type === 'reject-doc' && <><h3>Reject {KIND[modal.doc.kind]}</h3>{merr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{merr}</div>}<div className="field"><label htmlFor="am2">What is wrong? *</label><input id="am2" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Image is blurred, please upload a clearer copy" /></div><div className="flex"><button className="btn" disabled={busy} onClick={() => run(() => api(`/admin/school/admissions/${id}/documents/${modal.doc.id}/verify`, { method: 'POST', body: { status: 'rejected', note } }))}>Reject document</button><button className="btn ghost" onClick={() => setModal(null)}>Cancel</button></div></>}</Modal>
    <Modal open={modal?.type === 'enrol'} onClose={() => setModal(null)} label="Enrol">{modal?.type === 'enrol' && <><h3>Confirm admission</h3>{merr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{merr}</div>}<p className="muted">This creates the student record, issues the student ID, creates the parent's login and raises the first fees.</p>
      <Select label="Section" id="am3" value={sec} onChange={setSec} blank="Choose a section" options={a.sections.map((s: any) => ({ value: s.id, label: `${a.class_name} ${s.name} (${s.used}/${s.capacity})` }))} />{a.sections.length === 0 && <div className="notice">No sections exist for this class and year. Create one under Academic setup first.</div>}
      <div className="flex"><button className="btn" disabled={!sec || busy} onClick={() => run(() => post('enrol', { sectionId: Number(sec) }), (r) => setModal({ type: 'done', out: r }))}>Enrol student</button><button className="btn ghost" onClick={() => setModal(null)}>Cancel</button></div></>}</Modal>
    <Modal open={modal?.type === 'done'} onClose={() => setModal(null)} label="Enrolled">{modal?.type === 'done' && <><h3>Admission confirmed</h3><p>Student ID: <code style={{ fontSize: '1.5rem', background: 'var(--olive-soft)', padding: '.3rem .8rem', borderRadius: 12 }}>{modal.out.studentCode}</code></p>
      <div className="notice" style={{ margin: '1rem 0' }}><b>Parent login</b><p style={{ margin: '.3rem 0' }}>Username: <code>{modal.out.parentLogin.loginId}</code></p>{modal.out.parentLogin.temporaryPassword ? <p style={{ margin: 0 }}>Temporary password (shown once): <code style={{ fontSize: '1.2rem', userSelect: 'all' }}>{modal.out.parentLogin.temporaryPassword}</code></p> : <p className="muted" style={{ margin: 0 }}>This parent already has an account and can also sign in with this ID.</p>}</div>
      <p className="muted">{modal.out.feesRaised} fee{modal.out.feesRaised === 1 ? '' : 's'} raised from the class fee structure.</p><div className="flex"><button className="btn" onClick={() => nav(`/portal/students/${modal.out.studentId}`)}>Open student</button><button className="btn ghost" onClick={() => setModal(null)}>Close</button></div></>}</Modal>
  </>);
}
