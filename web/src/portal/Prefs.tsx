import { useState } from 'react';
import { api } from '../api';
import { ErrorBox, Loading } from '../components/States';
import { useAction, useApi } from './ui';

const TOPICS: Record<string, string> = { fees: 'Fees and receipts', attendance: 'Attendance', academics: 'Homework, results and timetable', transport: 'Transport', messages: 'Messages and meetings', general: 'Other school updates' };

/** Which channels a person wants school messages on, and which topics to mute. Safety messages are always sent. */
export function NotificationPrefs() {
  const { data, err } = useApi<any>('/prefs'); const a = useAction(); const [saved, setSaved] = useState(false);
  const [f, setF] = useState<{ email: boolean; sms: boolean; whatsapp: boolean; muted: string[] } | null>(null);
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  const v = f ?? { email: data.email, sms: data.sms, whatsapp: data.whatsapp, muted: data.muted_categories as string[] };
  const set = (n: Partial<typeof v>) => { setSaved(false); setF({ ...v, ...n }); };
  return (
    <div className="panel">
      <h2>How we contact you</h2>
      <p className="muted">Everything also appears in the app. Choose where else you would like a copy.</p>
      <label className="flex"><input type="checkbox" checked={v.email} onChange={(e) => set({ email: e.target.checked })} /> Email</label>
      <label className="flex"><input type="checkbox" checked={v.sms} onChange={(e) => set({ sms: e.target.checked })} /> SMS to my mobile number</label>
      <label className="flex"><input type="checkbox" checked={v.whatsapp} onChange={(e) => set({ whatsapp: e.target.checked })} /> WhatsApp to my mobile number</label>
      {(v.sms || v.whatsapp) && <p className="muted" style={{ fontSize: '.8rem' }}>By switching on SMS or WhatsApp you agree that the school may send school updates to your mobile number on that channel. You can switch it off at any time.</p>}
      <h3 style={{ fontSize: '1rem', margin: '1rem 0 .3rem' }}>Topics I want copies of</h3>
      {(data.categories as string[]).map((c) => <label className="flex" key={c}><input type="checkbox" checked={!v.muted.includes(c)} onChange={(e) => set({ muted: e.target.checked ? v.muted.filter((x) => x !== c) : [...v.muted, c] })} /> {TOPICS[c] ?? c}</label>)}
      <p className="muted" style={{ fontSize: '.8rem' }}>Safety messages, such as a child leaving school early, are always sent.</p>
      {!data.providerConfigured && <p className="muted" style={{ fontSize: '.8rem' }}>Email, SMS and WhatsApp are not connected at your school yet. Your choices are saved and will apply once they are.</p>}
      {a.err && <ErrorBox message={a.err} />}{saved && <div className="notice ok" role="status">Saved.</div>}
      <button className="btn" disabled={a.busy || !f} onClick={() => a.run(() => api('/prefs', { method: 'PUT', body: { email: v.email, sms: v.sms, whatsapp: v.whatsapp, mutedCategories: v.muted } }), () => setSaved(true))}>Save choices</button>
    </div>
  );
}
