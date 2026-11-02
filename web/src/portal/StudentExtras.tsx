import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorBox, Loading } from '../components/States';
import { dt, Field, Select, useAction, useApi } from './ui';

/** Emergency contacts (visible only to staff who may see sensitive details). */
export function EmergencyPanel({ studentId }: { studentId: number }) {
  const { can } = useAuth(); const { data, err, reload } = useApi<any[]>(`/admin/school/safety/students/${studentId}/emergency-contacts`, [studentId]); const a = useAction();
  const [f, setF] = useState({ fullName: '', relation: '', phone: '' });
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  return (
    <div className="stack">
      <p className="muted" style={{ maxWidth: '62ch' }}>People to call in an emergency if a parent cannot be reached. Parents can also add these from their own portal.</p>
      {data.length === 0 ? <Empty>No emergency contacts yet.</Empty> : <div className="tbl-wrap"><table className="tbl"><tbody>{data.map((c) => <tr key={c.id}><td><b>{c.full_name}</b> <span className="chip sage">{c.relation}</span></td><td>{c.phone}</td><td className="act">{can('students.manage') && <button className="btn ghost sm" onClick={() => confirm('Remove this contact?') && a.run(() => api(`/admin/school/safety/students/${studentId}/emergency-contacts/${c.id}`, { method: 'DELETE' }), reload)}>Remove</button>}</td></tr>)}</tbody></table></div>}
      {a.err && <ErrorBox message={a.err} />}
      {can('students.manage') && <div className="panel"><h2>Add a contact</h2><div className="two-col"><Field label="Name" value={f.fullName} onChange={(v) => setF({ ...f, fullName: v })} /><Field label="Relation" value={f.relation} onChange={(v) => setF({ ...f, relation: v })} /><Field label="Mobile number" type="tel" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} /></div>
        <button className="btn" disabled={a.busy || !f.fullName.trim() || !f.relation.trim() || !f.phone.trim()} onClick={() => a.run(() => api(`/admin/school/safety/students/${studentId}/emergency-contacts`, { method: 'POST', body: { fullName: f.fullName, relation: f.relation, phone: f.phone } }), () => { setF({ fullName: '', relation: '', phone: '' }); reload(); })}>Add contact</button></div>}
    </div>
  );
}

const KINDS = ['sport', 'arts', 'club', 'academic', 'community', 'competition', 'leadership', 'other'];
const LEVELS = ['class', 'school', 'inter_school', 'district', 'state', 'national', 'international'];
const CATS = ['learning', 'social', 'skills', 'interests', 'wellbeing', 'support'];

/** Activities, achievements and teacher observations: development beyond marks. */
export function GrowthPanel({ studentId }: { studentId: number }) {
  const { data, err, reload } = useApi<any>(`/admin/school/growth/students/${studentId}/growth`, [studentId]); const a = useAction();
  const [act, setAct] = useState({ kind: 'sport', title: '', level: 'school', occurredOn: new Date().toISOString().slice(0, 10), result: '', visibleToFamily: true });
  const [obs, setObs] = useState({ category: 'learning', note: '', sharedWithFamily: false, needsSupport: false });
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="panel"><h2>Activities and achievements</h2>
        {data.activities.length === 0 ? <p className="muted">Nothing recorded yet. Record sports, arts, clubs, competitions, leadership and community work.</p> : <table className="tbl" style={{ minWidth: 0 }}><tbody>{data.activities.map((x: any) => <tr key={x.id}><td>{dt(x.occurred_on)}</td><td><b>{x.title}</b>{x.result && <> · {x.result}</>}<br /><span className="muted" style={{ textTransform: 'capitalize' }}>{x.kind} · {x.level.replace('_', ' ')}{x.visible_to_family ? '' : ' · hidden from family'}</span></td><td className="act"><button className="btn ghost sm" onClick={() => confirm('Remove this?') && a.run(() => api(`/admin/school/growth/activities/${x.id}`, { method: 'DELETE' }), reload)}>Remove</button></td></tr>)}</tbody></table>}
        <h3 style={{ margin: '1rem 0 .4rem', fontSize: '1rem' }}>Add</h3>
        <div className="two-col"><Select label="Type" id="ak" blank={null} value={act.kind} onChange={(v) => setAct({ ...act, kind: v })} options={KINDS.map((k) => ({ value: k, label: k }))} /><Select label="Level" id="al" blank={null} value={act.level} onChange={(v) => setAct({ ...act, level: v })} options={LEVELS.map((k) => ({ value: k, label: k.replace('_', ' ') }))} /><Field label="What" value={act.title} onChange={(v) => setAct({ ...act, title: v })} /><Field label="Result or role (optional)" value={act.result} onChange={(v) => setAct({ ...act, result: v })} /><Field label="Date" type="date" value={act.occurredOn} max={new Date().toISOString().slice(0, 10)} onChange={(v) => setAct({ ...act, occurredOn: v })} /></div>
        <label className="flex" style={{ marginBottom: '.8rem' }}><input type="checkbox" checked={act.visibleToFamily} onChange={(e) => setAct({ ...act, visibleToFamily: e.target.checked })} /> Show this to the family</label>
        <button className="btn" disabled={a.busy || !act.title.trim()} onClick={() => a.run(() => api(`/admin/school/growth/students/${studentId}/activities`, { method: 'POST', body: { ...act, result: act.result || undefined } }), () => { setAct({ ...act, title: '', result: '' }); reload(); })}>Record</button></div>
      <div className="panel"><h2>Teacher observations</h2>
        {data.observations.length === 0 ? <p className="muted">No observations yet. Note strengths, interests, social growth and anything that needs support.</p> : data.observations.map((o: any) => <p key={o.id} style={{ margin: '.4rem 0' }}><span className="chip sage" style={{ textTransform: 'capitalize' }}>{o.category}</span> {o.needs_support && <span className="badge">needs support</span>} {o.shared_with_family ? <span className="badge on">shared with family</span> : <span className="muted" style={{ fontSize: '.78rem' }}>private to staff</span>}<br />{o.note}<br /><span className="muted" style={{ fontSize: '.78rem' }}>{o.date} · {o.author}</span> {o.mine && <button className="btn ghost sm" onClick={() => confirm('Remove this note?') && a.run(() => api(`/admin/school/growth/observations/${o.id}`, { method: 'DELETE' }), reload)}>Remove</button>}</p>)}
        <h3 style={{ margin: '1rem 0 .4rem', fontSize: '1rem' }}>Add</h3>
        <Select label="About" id="oc" blank={null} value={obs.category} onChange={(v) => setObs({ ...obs, category: v })} options={CATS.map((k) => ({ value: k, label: k }))} />
        <Field label="Observation" rows={3} value={obs.note} onChange={(v) => setObs({ ...obs, note: v })} help="Describe what you saw, kindly and specifically." />
        <label className="flex"><input type="checkbox" checked={obs.sharedWithFamily} onChange={(e) => setObs({ ...obs, sharedWithFamily: e.target.checked })} /> Share with the family (off by default)</label>
        <label className="flex" style={{ marginBottom: '.8rem' }}><input type="checkbox" checked={obs.needsSupport} onChange={(e) => setObs({ ...obs, needsSupport: e.target.checked })} /> This student may need extra support</label>
        {a.err && <ErrorBox message={a.err} />}<button className="btn" disabled={a.busy || !obs.note.trim()} onClick={() => a.run(() => api(`/admin/school/growth/students/${studentId}/observations`, { method: 'POST', body: obs }), () => { setObs({ ...obs, note: '', sharedWithFamily: false, needsSupport: false }); reload(); })}>Save observation</button></div>
    </div>
  );
}

/** Downloads everything held about a student (the DPDP access request), for authorised people. */
export function ExportButton({ studentId }: { studentId: number }) {
  return <a className="btn ghost" href={`/api/admin/school/privacy/students/${studentId}/export`} download>Download all data</a>;
}
