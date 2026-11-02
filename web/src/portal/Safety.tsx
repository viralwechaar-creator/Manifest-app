import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { dt, Field, Select, useAction, useApi } from './ui';

const today = () => new Date().toISOString().slice(0, 10);
const KIND_LABEL: Record<string, string> = { late_arrival: 'Late arrival', early_departure: 'Early departure', pickup: 'Collected' };

/** Student search used by the gate desk and the incident form (name or ID, two letters or more). */
function StudentPicker({ path, onPick }: { path: string; onPick: (s: any) => void }) {
  const [q, setQ] = useState(''); const found = useApi<any[]>(q.trim().length >= 2 ? `${path}?q=${encodeURIComponent(q.trim())}` : null, [q], true);
  return (
    <div>
      <input className="input" type="search" placeholder="Find a student by name or ID" aria-label="Find a student" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && found.data && <ul className="pick" style={{ listStyle: 'none', padding: 0, margin: '.4rem 0 0' }}>
        {found.data.length === 0 && <li className="muted">No student found.</li>}
        {found.data.map((s) => <li key={s.id}><button type="button" className="btn ghost sm" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => { onPick(s); setQ(''); }}><span>{s.full_name}</span><span className="muted">{s.student_code} · {s.section ?? '—'}</span></button></li>)}
      </ul>}
    </div>
  );
}

// ============================================ Gate desk ============================================
export function GatePage() {
  const [date, setDate] = useState(today()); const log = useApi<any[]>(`/admin/school/safety/gate?date=${date}`, [date], true);
  const [stu, setStu] = useState<any>(null); const [reason, setReason] = useState(''); const [who, setWho] = useState(''); const [msg, setMsg] = useState('');
  const col = useApi<any>(stu ? `/admin/school/safety/gate/students/${stu.id}/collectors` : null, [stu?.id]); const a = useAction();
  const record = async (kind: string) => {
    setMsg('');
    const body: any = { studentId: stu.id, kind, reason: reason || undefined };
    if (kind !== 'late_arrival') { if (!who) return a.run(async () => { throw Object.assign(new Error('Choose who is collecting the student.'), { message: 'Choose who is collecting the student.' }); }); const [t, id] = who.split(':'); body[t === 'g' ? 'guardianId' : 'pickupId'] = Number(id); }
    await a.run(() => api('/admin/school/safety/gate', { method: 'POST', body }), () => { setMsg(`${stu.full_name}: ${KIND_LABEL[kind].toLowerCase()} recorded. The family has been told.`); setStu(null); setReason(''); setWho(''); log.reload(); });
  };
  return (
    <>
      <div className="ph1"><h1>Gate desk</h1></div>
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <div className="panel">
          <h2>Record an arrival or departure</h2>
          {msg && <div className="notice ok" role="status" style={{ marginBottom: '.8rem' }}>{msg}</div>}
          {!stu ? <StudentPicker path="/admin/school/safety/gate/students" onPick={(s) => { setStu(s); a.clear(); setMsg(''); }} /> : (
            <div className="stack">
              <div className="flex" style={{ justifyContent: 'space-between' }}><b>{stu.full_name} <span className="muted">{stu.student_code}</span></b><button className="btn ghost sm" onClick={() => setStu(null)}>Change</button></div>
              {a.err && <ErrorBox message={a.err} />}
              <Field label="Reason (optional)" value={reason} onChange={setReason} />
              {!col.data ? <Loading /> : (
                <div className="field"><label htmlFor="who">Collected by (for early departure or pickup)</label>
                  <select id="who" className="input" value={who} onChange={(e) => setWho(e.target.value)}>
                    <option value="">Choose a person…</option>
                    <optgroup label="Parents and guardians">{col.data.guardians.map((g: any) => <option key={'g' + g.id} value={`g:${g.id}`}>{g.full_name} ({g.relation})</option>)}</optgroup>
                    <optgroup label="Approved pickup persons">{col.data.pickups.map((p: any) => <option key={'p' + p.id} value={`p:${p.id}`}>{p.full_name} ({p.relation}){p.id_hint ? ` · ${p.id_hint}` : ''}</option>)}</optgroup>
                  </select>
                  {col.data.pickups.length === 0 && <span className="help">No approved pickup persons for this student. Only a parent or guardian may collect them.</span>}
                </div>)}
              <div className="flex"><button className="btn" disabled={a.busy} onClick={() => record('late_arrival')}>Late arrival</button><button className="btn ghost" disabled={a.busy} onClick={() => record('early_departure')}>Early departure</button><button className="btn ghost" disabled={a.busy} onClick={() => record('pickup')}>Collected</button></div>
            </div>)}
        </div>
        <div className="panel">
          <div className="flex" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Today’s log</h2><input type="date" className="input" style={{ maxWidth: 170 }} aria-label="Date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} /></div>
          {log.err ? <ErrorBox message={log.err} /> : !log.data ? <Loading /> : log.data.length === 0 ? <Empty>Nothing recorded for this day.</Empty> : (
            <div className="tbl-wrap" style={{ marginTop: '.8rem' }}><table className="tbl"><thead><tr><th>Time</th><th>Student</th><th>What</th><th>With</th></tr></thead><tbody>
              {log.data.map((e) => <tr key={e.id}><td>{e.time}</td><td><b>{e.student}</b><br /><span className="muted">{e.section ?? ''}</span></td><td>{KIND_LABEL[e.kind]}{e.reason ? <><br /><span className="muted">{e.reason}</span></> : null}</td><td>{e.picked_up_by ?? '—'}</td></tr>)}</tbody></table></div>)}
        </div>
      </div>
    </>
  );
}

// ============================================ Pickup approvals ============================================
export function PickupsPage() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'all'>('pending'); const { data, err, reload } = useApi<any[]>(`/admin/school/safety/pickups?status=${status}`, [status]); const a = useAction();
  const decide = (id: number, decision: string) => a.run(() => api(`/admin/school/safety/pickups/${id}/decision`, { method: 'POST', body: { decision } }), reload);
  return (
    <>
      <div className="ph1"><h1>Pickup approvals</h1></div>
      <p className="muted" style={{ maxWidth: '62ch' }}>Families name the people who may collect their child. Check who they are before approving. Only approved people can be chosen at the gate.</p>
      <Tabs tabs={[{ id: 'pending' as const, label: 'To review' }, { id: 'approved' as const, label: 'Approved' }, { id: 'all' as const, label: 'All' }]} value={status} onChange={setStatus} />
      {a.err && <ErrorBox message={a.err} />}
      {err ? <ErrorBox message={err} /> : !data ? <Loading /> : data.length === 0 ? <Empty>{status === 'pending' ? 'Nothing waiting for review.' : 'Nothing here.'}</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Person</th><th>For student</th><th>Details</th><th>Status</th><th /></tr></thead><tbody>
          {data.map((p) => <tr key={p.id}><td><b>{p.full_name}</b><br /><span className="muted">{p.relation} · {p.phone}</span></td><td>{p.student}<br /><span className="muted">{p.student_code}</span></td><td>{p.id_hint ?? '—'}{p.valid_until ? <><br /><span className="muted">until {dt(p.valid_until)}</span></> : null}</td><td><span className={'badge' + (p.status === 'approved' ? ' on' : '')}>{p.status}</span></td>
            <td className="act">{p.status === 'pending' && <><button className="btn sm" disabled={a.busy} onClick={() => decide(p.id, 'approved')}>Approve</button> <button className="btn ghost sm" disabled={a.busy} onClick={() => decide(p.id, 'rejected')}>Decline</button></>}{p.status === 'approved' && <button className="btn ghost sm" disabled={a.busy} onClick={() => decide(p.id, 'revoked')}>Remove</button>}</td></tr>)}</tbody></table></div>)}
    </>
  );
}

// ============================================ Incidents ============================================
const KINDS = ['bullying', 'harassment', 'injury', 'safety', 'behaviour', 'health', 'other'];
export function IncidentsPage() {
  const { can } = useAuth(); const manage = can('incidents.manage'); const [status, setStatus] = useState(''); const list = useApi<any[]>(`/admin/school/safety/incidents?status=${status}`, [status], true);
  const [open, setOpen] = useState<number | null>(null); const [nw, setNw] = useState(false);
  return (
    <>
      <div className="ph1"><h1>Incidents</h1><button className="btn" onClick={() => setNw(true)}>Report an incident</button></div>
      <p className="muted" style={{ maxWidth: '62ch' }}>{manage ? 'All reports, including confidential ones. Opening a confidential report is recorded in the audit log.' : 'You can report an incident and follow your own reports. Reports about bullying or harassment are always confidential.'}</p>
      <div className="toolbar"><Select label="" value={status} onChange={setStatus} blank="All statuses" options={['open', 'investigating', 'resolved', 'closed'].map((s) => ({ value: s, label: s }))} /></div>
      {list.err ? <ErrorBox message={list.err} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty>No incidents here.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Reference</th><th>What</th><th>When</th><th>Status</th><th /></tr></thead><tbody>
          {list.data.map((i) => <tr key={i.id}><td><b>{i.code}</b>{i.confidential && <><br /><span className="chip sage">confidential</span></>}</td><td><b style={{ textTransform: 'capitalize' }}>{i.kind}</b> · <span className="muted">{i.severity}</span><br /><span className="muted">{i.summary}</span></td><td>{i.occurred_at}</td><td><span className={'badge' + (i.status === 'open' ? ' on' : '')}>{i.status}</span></td><td className="act"><button className="btn ghost sm" onClick={() => setOpen(i.id)}>Open</button></td></tr>)}</tbody></table></div>)}
      <ReportIncident open={nw} onClose={() => setNw(false)} done={() => { setNw(false); list.reload(); }} />
      {open !== null && <IncidentDetail id={open} manage={manage} onClose={() => { setOpen(null); list.reload(); }} />}
    </>
  );
}

function ReportIncident({ open, onClose, done }: { open: boolean; onClose: () => void; done: () => void }) {
  const [f, setF] = useState({ kind: 'behaviour', severity: 'medium', location: '', description: '' }); const [students, setStudents] = useState<{ id: number; full_name: string; role: string }[]>([]); const a = useAction();
  const submit = () => a.run(() => api('/admin/school/safety/incidents', { method: 'POST', body: { ...f, location: f.location || undefined, students: students.map((s) => ({ id: s.id, role: s.role })) } }), () => { setF({ kind: 'behaviour', severity: 'medium', location: '', description: '' }); setStudents([]); done(); });
  return (
    <Modal open={open} onClose={onClose} label="Report an incident">
      <h3>Report an incident</h3>
      {a.err && <ErrorBox message={a.err} />}
      <div className="two-col">
        <Select label="What happened" id="ik" value={f.kind} blank={null} onChange={(v) => setF({ ...f, kind: v })} options={KINDS.map((k) => ({ value: k, label: k }))} />
        <Select label="How serious" id="is" value={f.severity} blank={null} onChange={(v) => setF({ ...f, severity: v })} options={['low', 'medium', 'high'].map((k) => ({ value: k, label: k }))} />
      </div>
      <Field label="Where (optional)" value={f.location} onChange={(v) => setF({ ...f, location: v })} />
      <Field label="Describe what happened" value={f.description} rows={4} required onChange={(v) => setF({ ...f, description: v })} help="Stick to facts: who, what, when. Do not guess motives." />
      <div className="field"><label>Students involved (optional)</label>
        {students.map((s) => <div key={s.id} className="flex" style={{ justifyContent: 'space-between', marginBottom: '.3rem' }}><span>{s.full_name}</span>
          <span className="flex"><select className="input" style={{ width: 'auto' }} aria-label={`Role of ${s.full_name}`} value={s.role} onChange={(e) => setStudents(students.map((x) => x.id === s.id ? { ...x, role: e.target.value } : x))}><option value="affected">affected</option><option value="involved">involved</option><option value="witness">witness</option></select><button className="btn ghost sm" onClick={() => setStudents(students.filter((x) => x.id !== s.id))}>Remove</button></span></div>)}
        {students.length < 20 && <StudentPicker path="/admin/school/safety/incidents/student-search" onPick={(s) => !students.some((x) => x.id === s.id) && setStudents([...students, { id: s.id, full_name: s.full_name, role: 'involved' }])} />}
      </div>
      <div className="flex"><button className="btn" disabled={a.busy || f.description.trim().length < 5} onClick={submit}>{a.busy ? 'Sending…' : 'Submit report'}</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

function IncidentDetail({ id, manage, onClose }: { id: number; manage: boolean; onClose: () => void }) {
  const { data, err, reload } = useApi<any>(`/admin/school/safety/incidents/${id}`, [id]); const a = useAction();
  const [note, setNote] = useState(''); const [res, setRes] = useState<string | null>(null); const [resText, setResText] = useState(''); const [tell, setTell] = useState<{ studentId: number; message: string } | null>(null); const [sent, setSent] = useState('');
  const patch = (b: any) => a.run(() => api(`/admin/school/safety/incidents/${id}`, { method: 'PATCH', body: b }), reload);
  return (
    <Modal open onClose={onClose} label="Incident">
      {err ? <ErrorBox message={err} /> : !data ? <Loading /> : (
        <div className="stack">
          <div><span className="muted" style={{ fontFamily: 'var(--font-mono)' }}>{data.code}</span><h3 style={{ margin: '.2rem 0', textTransform: 'capitalize' }}>{data.kind} · {data.severity}</h3><span className="muted">{data.occurred_str}{data.location ? ` · ${data.location}` : ''} · reported by {data.reported_by_name ?? 'unknown'}</span></div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{data.description}</p>
          {data.students.length > 0 && <p><b>Students:</b> {data.students.map((s: any) => `${s.full_name} (${s.role})`).join(', ')}</p>}
          {a.err && <ErrorBox message={a.err} />}
          {manage && <>
            <div className="two-col"><Select label="Status" id="st" value={data.status} blank={null} onChange={(v) => v === 'resolved' || v === 'closed' ? setRes(v) : patch({ status: v })} options={['open', 'investigating', 'resolved', 'closed'].map((s) => ({ value: s, label: s }))} />
              <Select label="Seriousness" id="sv" value={data.severity} blank={null} onChange={(v) => patch({ severity: v })} options={['low', 'medium', 'high'].map((s) => ({ value: s, label: s }))} /></div>
            {res && <div className="stack"><Field label={`How was it resolved? (needed to mark it ${res})`} value={resText} rows={3} onChange={setResText} /><div className="flex"><button className="btn sm" disabled={!resText.trim()} onClick={async () => { await patch({ status: res, resolution: resText.trim() }); setRes(null); setResText(''); }}>Mark {res}</button><button className="btn ghost sm" onClick={() => setRes(null)}>Cancel</button></div></div>}
            {data.resolution && <p><b>Resolution:</b> {data.resolution}</p>}
            <h4>Notes</h4>
            {data.notes.length === 0 ? <p className="muted">No notes yet.</p> : data.notes.map((n: any) => <p key={n.id} style={{ margin: '.2rem 0' }}><span className="muted">{n.at} · {n.author}</span><br />{n.note}</p>)}
            <div className="flex"><input className="input" aria-label="Add a note" placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn sm" disabled={!note.trim()} onClick={() => a.run(() => api(`/admin/school/safety/incidents/${id}/notes`, { method: 'POST', body: { note } }), () => { setNote(''); reload(); })}>Add</button></div>
            {data.students.length > 0 && <>
              <h4>Tell a family</h4><p className="muted" style={{ fontSize: '.85rem' }}>You decide what to say. Never include other children’s names.</p>
              {sent && <div className="notice ok">{sent}</div>}
              {!tell ? <div className="flex">{data.students.map((s: any) => <button key={s.id} className="btn ghost sm" onClick={() => { setTell({ studentId: s.id, message: '' }); setSent(''); }}>Message {s.full_name.split(' ')[0]}’s family</button>)}</div>
                : <div className="stack"><Field label="Message" value={tell.message} rows={3} onChange={(v) => setTell({ ...tell, message: v })} /><div className="flex"><button className="btn sm" disabled={!tell.message.trim()} onClick={() => a.run(() => api(`/admin/school/safety/incidents/${id}/notify-family`, { method: 'POST', body: tell }), () => { setSent('The family has been notified.'); setTell(null); })}>Send</button><button className="btn ghost sm" onClick={() => setTell(null)}>Cancel</button></div></div>}
            </>}
          </>}
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>)}
    </Modal>
  );
}
