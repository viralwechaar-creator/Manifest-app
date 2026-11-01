import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Reveal } from '../components/Reveal';
import { Loading } from '../components/States';
import { fmtDate } from '../lib';
import { PageHead } from './Parts';
import { useSettings } from './SiteData';

const KIND: Record<string, string> = { birth_certificate: 'Birth certificate', photo: 'Passport-size photo', address_proof: 'Address proof', transfer_certificate: 'Transfer certificate', previous_marksheet: 'Previous marksheet', other: 'Other document' };
const STATUS: Record<string, [string, string]> = { submitted: ['Received', 'We have your application and will begin reviewing it soon.'], under_review: ['Under review', 'The admissions team is reviewing your application.'], documents_pending: ['Documents needed', 'Please see the note below and upload the documents requested.'], verified: ['Documents verified', 'Your documents are verified. A decision will follow shortly.'], approved: ['Approved', 'Congratulations! Your application is approved.'], rejected: ['Not successful', 'We are sorry we could not offer a place.'], withdrawn: ['Withdrawn', 'This application was withdrawn.'], enrolled: ['Admission confirmed', 'Your child is enrolled. Welcome to the school!'] };

function Docs({ reference, code, status, onChange }: { reference: string; code: string; status: any; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null); const [kind, setKind] = useState(status.missingDocuments[0] ?? 'birth_certificate'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function send(file?: File) {
    if (!file) return; setBusy(true); setErr('');
    try { const fd = new FormData(); fd.append('reference', reference); fd.append('code', code); fd.append('kind', kind); fd.append('file', file); await api('/apply/documents', { method: 'POST', form: fd }); onChange(); }
    catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return (<div className="formbox" style={{ marginTop: '1.2rem' }}>
    <h3 style={{ fontSize: '1.5rem' }}>Documents</h3>
    {status.requiredDocuments.length > 0 && <p className="muted" style={{ fontSize: '.9rem' }}>Required: {status.requiredDocuments.map((k: string) => KIND[k]).join(', ')}. Photos or scans as JPG, PNG or PDF, up to 5 MB each.</p>}
    <div className="stack" style={{ gap: '.4rem', margin: '1rem 0' }}>{status.documents.length === 0 && <span className="muted">Nothing uploaded yet.</span>}{status.documents.map((d: any) => <div key={d.id} className="flex" style={{ justifyContent: 'space-between', border: '1px solid var(--line)', borderRadius: 14, padding: '.5rem .8rem' }}><span><b>{KIND[d.kind]}</b> <span className="muted" style={{ fontSize: '.8rem' }}>{d.original_name}</span>{d.review_note && <span className="err" style={{ display: 'block', fontSize: '.8rem' }}>{d.review_note}</span>}</span><span className={'badge ' + (d.status === 'verified' ? 'on' : d.status === 'rejected' ? 'off' : 'new')}>{d.status === 'pending' ? 'received' : d.status}</span></div>)}</div>
    {status.missingDocuments.length > 0 && <div className="notice" style={{ marginBottom: '1rem' }}>Still needed: {status.missingDocuments.map((k: string) => KIND[k]).join(', ')}</div>}
    {err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err}</div>}
    {status.canUpload && <div className="flex"><select className="input" style={{ maxWidth: 240 }} aria-label="Document type" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => send(e.target.files?.[0])} /><button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Choose file and upload'}</button></div>}
  </div>);
}

export function ApplyPage() {
  const { s } = useSettings(); const opts = useState<any>(null); const [o, setO] = opts; const [step, setStep] = useState(0);
  const [f, setF] = useState<any>({ academicYearId: '', classId: '', studentName: '', dateOfBirth: '', gender: 'female', previousSchool: '', address: '', healthNotes: '', guardianName: '', guardianRelation: 'Father', guardianPhone: '', guardianEmail: '', website: '' });
  const [consent, setConsent] = useState(false); const [err, setErr] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState<any>(null); const [status, setStatus] = useState<any>(null);
  useEffect(() => { api('/apply/options').then((r) => { setO(r); setF((x: any) => ({ ...x, academicYearId: r.years.find((y: any) => y.is_current)?.id ?? r.years[0]?.id ?? '' })); }); }, [setO]);
  const set = (k: string, v: any) => setF({ ...f, [k]: v }); const fe = err?.fields ?? {};
  const refresh = () => done && api('/apply/status', { method: 'POST', body: { reference: done.reference, code: done.trackingCode } }).then(setStatus);
  useEffect(() => { if (done) refresh(); }, [done]); // eslint-disable-line
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setDone(await api('/apply/submit', { method: 'POST', body: { ...f, academicYearId: Number(f.academicYearId), classId: Number(f.classId), consent } })); window.scrollTo({ top: 0 }); }
    catch (x) { setErr(x as ApiError); const fields = (x as ApiError).fields ?? {}; if (['studentName', 'dateOfBirth', 'classId', 'address'].some((k) => fields[k])) setStep(0); } finally { setBusy(false); }
  }
  const next = () => { setErr(null); if (!f.classId || !f.studentName.trim() || !f.dateOfBirth || !f.address.trim()) { setErr(new ApiError(400, 'Please fill in the child’s name, date of birth, class and address.')); return; } setStep(1); };
  if (!o) return <><PageHead title="Online admission" /><Loading /></>;
  if (done) return (<><PageHead eyebrow="Admissions" title="Application received" crumbs={[['Admissions', '/admissions'], ['Online admission']]} /><section className="section"><div className="wrap" style={{ maxWidth: 760 }}>
    <Reveal><div className="formbox"><div className="notice ok" role="status"><b>Thank you.</b> Please keep these two details safe. You need both to check progress or add documents.</div>
      <dl className="kv" style={{ margin: '1.2rem 0', gridTemplateColumns: '160px 1fr', fontSize: '1.05rem' }}><dt>Reference</dt><dd><b>{done.reference}</b></dd><dt>Tracking code</dt><dd><b style={{ letterSpacing: '.08em' }}>{done.trackingCode}</b></dd></dl>
      <p className="muted" style={{ fontSize: '.88rem' }}>We cannot show the tracking code again. Take a screenshot or write it down. <Link to="/admissions/track" style={{ textDecoration: 'underline' }}>Track your application</Link> at any time.</p></div></Reveal>
    {status && <Docs reference={done.reference} code={done.trackingCode} status={status} onChange={refresh} />}</div></section></>);
  return (<><PageHead eyebrow="Admissions" title="Online admission" intro="Apply in two short steps. You can upload documents straight after." crumbs={[['Admissions', '/admissions'], ['Online admission']]} />
    <section className="section"><div className="wrap" style={{ maxWidth: 760 }}>
      {!o.accepting && <div className="notice error" role="alert">Online applications are closed at the moment. Please <Link to="/contact" style={{ textDecoration: 'underline' }}>contact the school</Link>.</div>}
      {o.accepting && <Reveal><form className="formbox" onSubmit={submit} noValidate>
        <div className="flex" style={{ marginBottom: '1.2rem' }}>{['The child', 'Parent or guardian'].map((t, i) => <span key={t} className={'chip' + (i === step ? '' : ' sage')} style={{ opacity: i === step ? 1 : .6 }}>{i + 1}. {t}</span>)}</div>
        {err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err.message}</div>}
        {step === 0 && <>
          <div className="two-col"><div className="field"><label htmlFor="a1">Academic year</label><select id="a1" value={f.academicYearId} onChange={(e) => set('academicYearId', e.target.value)}>{o.years.map((y: any) => <option key={y.id} value={y.id}>{y.label}</option>)}</select></div>
            <div className={'field' + (fe.classId ? ' invalid' : '')}><label htmlFor="a2">Class applying for *</label><select id="a2" value={f.classId} onChange={(e) => set('classId', e.target.value)}><option value="">Select</option>{o.classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div></div>
          <div className="two-col"><div className={'field' + (fe.studentName ? ' invalid' : '')}><label htmlFor="a3">Child’s full name *</label><input id="a3" type="text" value={f.studentName} onChange={(e) => set('studentName', e.target.value)} /></div>
            <div className={'field' + (fe.dateOfBirth ? ' invalid' : '')}><label htmlFor="a4">Date of birth *</label><input id="a4" type="date" max={new Date().toISOString().slice(0, 10)} value={f.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />{fe.dateOfBirth && <span className="err">{fe.dateOfBirth}</span>}</div>
            <div className="field"><label htmlFor="a5">Gender</label><select id="a5" value={f.gender} onChange={(e) => set('gender', e.target.value)}><option value="female">Girl</option><option value="male">Boy</option><option value="other">Other</option></select></div>
            <div className="field"><label htmlFor="a6">Previous school (if any)</label><input id="a6" type="text" value={f.previousSchool} onChange={(e) => set('previousSchool', e.target.value)} /></div></div>
          <div className={'field' + (fe.address ? ' invalid' : '')}><label htmlFor="a7">Home address *</label><textarea id="a7" value={f.address} onChange={(e) => set('address', e.target.value)} /></div>
          <div className="field"><label htmlFor="a8">Health conditions the school should know about</label><textarea id="a8" value={f.healthNotes} onChange={(e) => set('healthNotes', e.target.value)} /><span className="help">Optional. Shared only with staff who need it.</span></div>
          <button type="button" className="btn" onClick={next}>Continue</button></>}
        {step === 1 && <>
          <div className="two-col"><div className={'field' + (fe.guardianName ? ' invalid' : '')}><label htmlFor="b1">Parent / guardian name *</label><input id="b1" type="text" value={f.guardianName} onChange={(e) => set('guardianName', e.target.value)} /></div>
            <div className="field"><label htmlFor="b2">Relationship</label><select id="b2" value={f.guardianRelation} onChange={(e) => set('guardianRelation', e.target.value)}>{['Father', 'Mother', 'Guardian', 'Other'].map((r) => <option key={r}>{r}</option>)}</select></div>
            <div className={'field' + (fe.guardianPhone ? ' invalid' : '')}><label htmlFor="b3">Phone *</label><input id="b3" type="tel" value={f.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} />{fe.guardianPhone && <span className="err">{fe.guardianPhone}</span>}</div>
            <div className={'field' + (fe.guardianEmail ? ' invalid' : '')}><label htmlFor="b4">Email</label><input id="b4" type="email" value={f.guardianEmail} onChange={(e) => set('guardianEmail', e.target.value)} />{fe.guardianEmail && <span className="err">{fe.guardianEmail}</span>}</div></div>
          <div className="hp" aria-hidden><label>Leave this empty<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} /></label></div>
          <div className={'field' + (fe.consent ? ' invalid' : '')}><label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I agree that the school may use these details, including my child’s, to process this admission application.</span></label>{fe.consent && <span className="err" role="alert">{fe.consent}</span>}<span className="help">{s.privacy_notice_text}</span></div>
          <div className="flex"><button type="button" className="btn ghost" onClick={() => setStep(0)}>← Back</button><button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Submit application'}</button></div></>}
      </form></Reveal>}
    </div></section></>);
}

export function TrackPage() {
  const [sp] = useSearchParams(); const [ref, setRef] = useState(sp.get('ref') ?? ''); const [code, setCode] = useState(''); const [st, setSt] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = async () => { setErr(''); setBusy(true); try { setSt(await api('/apply/status', { method: 'POST', body: { reference: ref.trim(), code: code.trim() } })); } catch (e) { setSt(null); setErr((e as ApiError).message); } finally { setBusy(false); } };
  const [title, blurb] = st ? STATUS[st.status] ?? [st.status, ''] : ['', ''];
  return (<><PageHead eyebrow="Admissions" title="Track your application" intro="Enter the reference and tracking code you received when you applied." crumbs={[['Admissions', '/admissions'], ['Track application']]} />
    <section className="section"><div className="wrap" style={{ maxWidth: 760 }}>
      <Reveal><form className="formbox" onSubmit={(e) => { e.preventDefault(); load(); }}>{err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err}</div>}
        <div className="two-col"><div className="field"><label htmlFor="t1">Reference</label><input id="t1" type="text" placeholder="APP-2026-0001" value={ref} onChange={(e) => setRef(e.target.value)} autoCapitalize="characters" /></div><div className="field"><label htmlFor="t2">Tracking code</label><input id="t2" type="text" placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="off" /></div></div>
        <button className="btn" disabled={busy || !ref || !code}>{busy ? 'Checking…' : 'Check status'}</button></form></Reveal>
      {st && <Reveal><div className="formbox" style={{ marginTop: '1.2rem' }}><span className="chip">{st.reference}</span><h2 style={{ fontSize: '2rem', margin: '.6rem 0' }}>{title}</h2><p>{blurb}</p>
        <p className="muted" style={{ fontSize: '.9rem' }}>{st.studentName} · {st.className} · applied {fmtDate(st.submittedAt)}</p>{st.decisionNote && <div className="notice" style={{ margin: '1rem 0' }}>{st.decisionNote}</div>}
        <h3 style={{ fontSize: '1.2rem', margin: '1.2rem 0 .5rem' }}>Progress</h3><ol className="steps" style={{ gap: '.5rem' }}>{st.events.map((e: any, i: number) => <li key={i} style={{ gridTemplateColumns: '1fr' }}><span><b style={{ textTransform: 'capitalize' }}>{e.action.replace(/_/g, ' ')}</b> <span className="muted" style={{ fontSize: '.82rem' }}>{fmtDate(e.at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>{e.note && <span className="muted" style={{ display: 'block', fontSize: '.88rem' }}>{e.note}</span>}</span></li>)}</ol></div>
        <Docs reference={st.reference} code={code.trim()} status={st} onChange={load} /></Reveal>}
    </div></section></>);
}

export function JobApplyButton({ job }: { job: { id: number; title: string } }) {
  const { s } = useSettings(); const [open, setOpen] = useState(false); const input = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ fullName: '', email: '', phone: '', note: '', website: '' }); const [consent, setConsent] = useState(false); const [file, setFile] = useState<File | null>(null); const [err, setErr] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const fd = new FormData(); fd.append('openingId', String(job.id)); for (const [k, v] of Object.entries(f)) if (v) fd.append(k, v); fd.append('consent', String(consent)); if (file) fd.append('resume', file); await api('/apply/jobs', { method: 'POST', form: fd }); setDone(true); }
    catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  }
  const fe = err?.fields ?? {};
  return (<><button className="btn" onClick={() => { setOpen(true); setDone(false); setErr(null); }}>Apply for this position</button>
    {open && <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-label={`Apply: ${job.title}`}>
      <h3>Apply: {job.title}</h3>
      {done ? <><div className="notice ok" role="status">Thank you. Your application has been received. We will contact you if you are shortlisted.</div><p><button className="btn ghost" onClick={() => setOpen(false)}>Close</button></p></> : <form onSubmit={submit} noValidate>
        {err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err.message}</div>}
        <div className={'field' + (fe.fullName ? ' invalid' : '')}><label htmlFor="j1">Full name *</label><input id="j1" type="text" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
        <div className="two-col"><div className={'field' + (fe.email ? ' invalid' : '')}><label htmlFor="j2">Email *</label><input id="j2" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />{fe.email && <span className="err">{fe.email}</span>}</div><div className={'field' + (fe.phone ? ' invalid' : '')}><label htmlFor="j3">Phone *</label><input id="j3" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />{fe.phone && <span className="err">{fe.phone}</span>}</div></div>
        <div className="field"><label htmlFor="j4">A few words about you</label><textarea id="j4" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <div className="field"><span className="lbl">CV (PDF, up to 5 MB)</span><input ref={input} type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
        <div className="hp" aria-hidden><label>Leave this empty<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label></div>
        <div className={'field' + (fe.consent ? ' invalid' : '')}><label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I agree that the school may use these details to consider my application.</span></label>{fe.consent && <span className="err" role="alert">{fe.consent}</span>}<span className="help">{s.privacy_notice_text}</span></div>
        <div className="flex"><button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send application'}</button><button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div></form>}
    </div></div>}</>);
}
