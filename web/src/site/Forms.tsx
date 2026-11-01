import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Reveal } from '../components/Reveal';
import { PageHead } from './Parts';
import { useSettings } from './SiteData';

type Fields = Record<string, string>;

function Field({ name, label, type = 'text', value, onChange, error, required, textarea, children, autoComplete }: any) {
  const id = 'f-' + name;
  return (
    <div className={'field' + (error ? ' invalid' : '')}>
      <label htmlFor={id}>{label}{required && <span aria-hidden> *</span>}</label>
      {children ?? (textarea
        ? <textarea id={id} name={name} value={value} onChange={(e) => onChange(name, e.target.value)} required={required} aria-invalid={!!error} />
        : <input id={id} name={name} type={type} value={value} onChange={(e) => onChange(name, e.target.value)} required={required} aria-invalid={!!error} autoComplete={autoComplete} />)}
      {error && <span className="err" role="alert">{error}</span>}
    </div>
  );
}

function usePublicForm(endpoint: string, initial: Fields) {
  const [v, setV] = useState<Fields>(initial);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api(endpoint, { method: 'POST', body: { ...v, consent } }); setDone(true); setV(initial); setConsent(false); }
    catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  }
  return { v, set, consent, setConsent, busy, err, done, submit };
}

function ConsentRow({ f, purpose }: { f: ReturnType<typeof usePublicForm>; purpose: string }) {
  const { s } = useSettings();
  return (
    <div className={'field' + (f.err?.fields?.consent ? ' invalid' : '')}>
      <label className="check"><input type="checkbox" checked={f.consent} onChange={(e) => f.setConsent(e.target.checked)} /><span>{purpose}</span></label>
      {f.err?.fields?.consent && <span className="err" role="alert">{f.err.fields.consent}</span>}
      <span className="help">{s.privacy_notice_text} <Link to="/policies" style={{ textDecoration: 'underline' }}>Read our policies</Link>.</span>
    </div>
  );
}

const Honeypot = ({ f }: { f: ReturnType<typeof usePublicForm> }) => (
  <div className="hp" aria-hidden><label>Leave this empty<input tabIndex={-1} autoComplete="off" value={f.v.website ?? ''} onChange={(e) => f.set('website', e.target.value)} /></label></div>
);

const GRADES = ['Nursery', 'LKG', 'UKG', ...Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`)];

export function EnquiryPage() {
  const f = usePublicForm('/public/enquiries', { studentName: '', gradeApplying: '', parentName: '', phone: '', email: '', message: '', website: '' });
  const fe = f.err?.fields ?? {};
  return (
    <>
      <PageHead eyebrow="Admissions" title="Admission enquiry" intro="Tell us a little about your child and how to reach you. The admissions team will contact you." crumbs={[['Admissions', '/admissions'], ['Enquiry']]} />
      <section className="section"><div className="wrap" style={{ maxWidth: 760 }}>
        <Reveal><div className="formbox">
          {f.done ? <div className="notice ok" role="status"><b>Thank you.</b> Your enquiry has been received. The school will contact you shortly.</div> : (
            <form onSubmit={f.submit} noValidate>
              {f.err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{f.err.message}</div>}
              <div className="two-col">
                <Field name="studentName" label="Child's name" required value={f.v.studentName} onChange={f.set} error={fe.studentName} />
                <Field name="gradeApplying" label="Class applying for" required error={fe.gradeApplying}>
                  <select id="f-gradeApplying" value={f.v.gradeApplying} onChange={(e) => f.set('gradeApplying', e.target.value)} required><option value="">Select</option>{GRADES.map((g) => <option key={g}>{g}</option>)}</select>
                </Field>
                <Field name="parentName" label="Parent / guardian name" required value={f.v.parentName} onChange={f.set} error={fe.parentName} />
                <Field name="phone" label="Phone" type="tel" required value={f.v.phone} onChange={f.set} error={fe.phone} autoComplete="tel" />
              </div>
              <Field name="email" label="Email (optional)" type="email" value={f.v.email} onChange={f.set} error={fe.email} autoComplete="email" />
              <Field name="message" label="Anything you would like us to know" textarea value={f.v.message} onChange={f.set} error={fe.message} />
              <Honeypot f={f} />
              <ConsentRow f={f} purpose="I agree that the school may use these details to contact me about this admission enquiry." />
              <button className="btn" disabled={f.busy}>{f.busy ? 'Sending…' : 'Send enquiry'}</button>
            </form>)}
        </div></Reveal>
      </div></section>
    </>
  );
}

export function ContactPage() {
  const { s } = useSettings();
  const [sp] = useSearchParams();
  const f = usePublicForm('/public/contact', { name: '', email: '', phone: '', subject: sp.get('subject') ?? '', message: '', website: '' });
  const fe = f.err?.fields ?? {};
  return (
    <>
      <PageHead eyebrow="Get in touch" title="Contact" crumbs={[['Contact']]} />
      <section className="section"><div className="wrap split rev" style={{ gridTemplateColumns: '5fr 6fr' }}>
        <Reveal><div className="stack">
          {s.address && <div><div className="eyebrow">Visit</div><p style={{ whiteSpace: 'pre-line', marginTop: '.6rem' }}>{s.address}</p></div>}
          {(s.phone || s.email) && <div><div className="eyebrow">Call or write</div><p style={{ marginTop: '.6rem' }}>{s.phone && <a href={`tel:${s.phone.replace(/\s/g, '')}`}>{s.phone}</a>}<br />{s.email && <a href={`mailto:${s.email}`}>{s.email}</a>}</p></div>}
          {s.office_hours && <div><div className="eyebrow">Office hours</div><p style={{ marginTop: '.6rem' }}>{s.office_hours}</p></div>}
          {s.map_url && s.map_url.startsWith('https://') && <a className="link-arrow" href={s.map_url} target="_blank" rel="noopener noreferrer" style={{ width: 'fit-content' }}>Open in maps →</a>}
          {!s.address && !s.phone && !s.email && <p className="muted">Contact details can be set in the admin panel.</p>}
        </div></Reveal>
        <Reveal delay={0.1}><div className="formbox">
          {f.done ? <div className="notice ok" role="status"><b>Message sent.</b> Thank you, we will reply as soon as we can.</div> : (
            <form onSubmit={f.submit} noValidate>
              {f.err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{f.err.message}</div>}
              <Field name="name" label="Your name" required value={f.v.name} onChange={f.set} error={fe.name} autoComplete="name" />
              <div className="two-col">
                <Field name="email" label="Email" type="email" value={f.v.email} onChange={f.set} error={fe.email} autoComplete="email" />
                <Field name="phone" label="Phone" type="tel" value={f.v.phone} onChange={f.set} error={fe.phone} autoComplete="tel" />
              </div>
              <Field name="subject" label="Subject" required value={f.v.subject} onChange={f.set} error={fe.subject} />
              <Field name="message" label="Message" textarea required value={f.v.message} onChange={f.set} error={fe.message} />
              <Honeypot f={f} />
              <ConsentRow f={f} purpose="I agree that the school may use these details to reply to my message." />
              <button className="btn" disabled={f.busy}>{f.busy ? 'Sending…' : 'Send message'}</button>
            </form>)}
        </div></Reveal>
      </div></section>
    </>
  );
}

export function NotFound() {
  return (<><PageHead title="Page not found" intro="The page you are looking for does not exist or has moved." /><section className="section"><div className="wrap"><Link className="btn" to="/">Back to home</Link></div></section></>);
}
