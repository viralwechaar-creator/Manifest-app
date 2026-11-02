import { useRef, useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { dt, Field, useAction, useApi } from '../portal/ui';
import { t } from '../i18n';
import { useChild } from './Family';

const dayName = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// ============================================ Safety ============================================
const GATE: Record<string, string> = { late_arrival: 'Arrived late', early_departure: 'Left early', pickup: 'Collected' };
export function FamilySafety() {
  const { child, role } = useChild(); const parent = role === 'parent'; const { data, err, reload } = useApi<any>(`/family/children/${child.id}/safety`, [child.id]); const a = useAction();
  const [ec, setEc] = useState({ fullName: '', relation: '', phone: '' }); const [pk, setPk] = useState({ fullName: '', relation: '', phone: '', idHint: '' });
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  return (
    <div className="stack">
      <h1 className="fam-h">{t('Safety')}</h1>
      {a.err && <ErrorBox message={a.err} />}
      <div className="panel"><h2>Who may collect {child.full_name.split(' ')[0]}</h2>
        <p className="muted" style={{ fontSize: '.88rem' }}>A parent or guardian can always collect. Anyone else must be listed here and approved by the school. Write only a hint of an ID, such as “Driving licence ending 4821”, never the full number.</p>
        {data.pickups.length === 0 ? <p className="muted">No one added yet.</p> : data.pickups.map((p: any) => <div className="fam-row" key={p.id}><div className="flex" style={{ justifyContent: 'space-between' }}><b>{p.full_name} <span className="muted">({p.relation})</span></b><span className={'badge' + (p.status === 'approved' ? ' on' : '')}>{p.status === 'pending' ? 'waiting for the school' : p.status}</span></div><span className="muted" style={{ fontSize: '.85rem' }}>{p.phone}{p.id_hint ? ` · ${p.id_hint}` : ''}{p.valid_until ? ` · until ${dt(p.valid_until)}` : ''}</span>{parent && <div><button className="btn ghost sm" onClick={() => confirm(`Remove ${p.full_name}?`) && a.run(() => api(`/family/children/${child.id}/pickups/${p.id}`, { method: 'DELETE' }), reload)}>Remove</button></div>}</div>)}
        {parent && <details style={{ marginTop: '.8rem' }}><summary className="btn ghost sm" style={{ display: 'inline-flex' }}>{t('Add a person')}</summary><div className="two-col" style={{ marginTop: '.8rem' }}><Field label={t('Full name')} value={pk.fullName} onChange={(v) => setPk({ ...pk, fullName: v })} /><Field label={t('Relation')} value={pk.relation} onChange={(v) => setPk({ ...pk, relation: v })} /><Field label={t('Mobile number')} type="tel" value={pk.phone} onChange={(v) => setPk({ ...pk, phone: v })} /><Field label="ID hint (optional)" value={pk.idHint} onChange={(v) => setPk({ ...pk, idHint: v })} /></div>
          <button className="btn" disabled={a.busy || !pk.fullName.trim() || !pk.relation.trim() || !pk.phone.trim()} onClick={() => a.run(() => api(`/family/children/${child.id}/pickups`, { method: 'POST', body: { fullName: pk.fullName, relation: pk.relation, phone: pk.phone, idHint: pk.idHint || undefined } }), () => { setPk({ fullName: '', relation: '', phone: '', idHint: '' }); reload(); })}>{t('Send for approval')}</button></details>}
      </div>
      <div className="panel"><h2>{t('Emergency contacts')}</h2>
        <p className="muted" style={{ fontSize: '.88rem' }}>People the school should call if it cannot reach you.</p>
        {data.emergencyContacts.length === 0 ? <p className="muted">None added yet.</p> : data.emergencyContacts.map((c: any) => <div className="fam-row" key={c.id}><div className="flex" style={{ justifyContent: 'space-between' }}><b>{c.full_name} <span className="muted">({c.relation})</span></b>{parent && <button className="btn ghost sm" onClick={() => confirm(`Remove ${c.full_name}?`) && a.run(() => api(`/family/children/${child.id}/emergency-contacts/${c.id}`, { method: 'DELETE' }), reload)}>Remove</button>}</div><span className="muted">{c.phone}</span></div>)}
        {parent && <details style={{ marginTop: '.8rem' }}><summary className="btn ghost sm" style={{ display: 'inline-flex' }}>{t('Add a contact')}</summary><div className="two-col" style={{ marginTop: '.8rem' }}><Field label={t('Full name')} value={ec.fullName} onChange={(v) => setEc({ ...ec, fullName: v })} /><Field label={t('Relation')} value={ec.relation} onChange={(v) => setEc({ ...ec, relation: v })} /><Field label={t('Mobile number')} type="tel" value={ec.phone} onChange={(v) => setEc({ ...ec, phone: v })} /></div>
          <button className="btn" disabled={a.busy || !ec.fullName.trim() || !ec.relation.trim() || !ec.phone.trim()} onClick={() => a.run(() => api(`/family/children/${child.id}/emergency-contacts`, { method: 'POST', body: { fullName: ec.fullName, relation: ec.relation, phone: ec.phone } }), () => { setEc({ fullName: '', relation: '', phone: '' }); reload(); })}>{t('Save contact')}</button></details>}
      </div>
      <div className="panel soft"><h2>{t('Arrivals and departures')}</h2>{data.gate.length === 0 ? <p className="muted">No late arrivals or early departures recorded.</p> : data.gate.map((g: any, i: number) => <div className="fam-row" key={i}><b>{GATE[g.kind]}</b> <span className="muted">{dayName(g.date)}, {g.time}{g.picked_up_by ? ` · with ${g.picked_up_by}` : ''}</span></div>)}</div>
    </div>
  );
}

// ============================================ Parent-teacher meetings ============================================
export function FamilyMeetings() {
  const { child, role } = useChild(); const parent = role === 'parent'; const { data, err, reload } = useApi<any>(`/family/children/${child.id}/meetings`, [child.id]); const a = useAction(); const [pick, setPick] = useState<any>(null); const [agenda, setAgenda] = useState('');
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  const byTeacher = data.open.reduce((m: Record<string, any[]>, s: any) => { (m[s.teacher] ||= []).push(s); return m; }, {});
  const upcoming = data.mine.filter((b: any) => b.status === 'booked' && new Date(b.starts_at) > new Date()), past = data.mine.filter((b: any) => !upcoming.includes(b));
  return (
    <div className="stack">
      <h1 className="fam-h">{t('Meet a teacher')}</h1>
      {a.err && <ErrorBox message={a.err} />}
      {upcoming.length > 0 && <div className="panel"><h2>{t('Your meetings')}</h2>{upcoming.map((b: any) => <div className="fam-row" key={b.id}><b>{b.teacher}</b> <span className="muted">{when(b.starts_at)} · {b.minutes} min · {b.mode.replace('_', ' ')}{b.location ? ` · ${b.location}` : ''}</span>{b.agenda && <div className="muted">“{b.agenda}”</div>}{parent && <button className="btn ghost sm" onClick={() => confirm('Cancel this meeting?') && a.run(() => api(`/family/children/${child.id}/meetings/${b.id}`, { method: 'DELETE' }), reload)}>Cancel</button>}</div>)}</div>}
      <div className="panel"><h2>Times offered by {child.full_name.split(' ')[0]}’s teachers</h2>
        {Object.keys(byTeacher).length === 0 ? <p className="muted">No times are open right now. Teachers offer times before parent meetings. You can also send a message.</p> : Object.entries(byTeacher).map(([teacher, slots]) => <div key={teacher} style={{ marginBottom: '1rem' }}><b>{teacher}</b><div className="flex" style={{ flexWrap: 'wrap', marginTop: '.4rem' }}>{(slots as any[]).map((s) => <button key={s.id} className="btn ghost sm" disabled={!parent} onClick={() => { setPick(s); setAgenda(''); a.clear(); }}>{when(s.starts_at)}</button>)}</div></div>)}
        {!parent && <p className="muted" style={{ fontSize: '.85rem' }}>Ask a parent to book a time.</p>}
      </div>
      {past.length > 0 && <div className="panel soft"><h2>Earlier</h2>{past.map((b: any) => <div className="fam-row" key={b.id}><b>{b.teacher}</b> <span className="muted">{when(b.starts_at)} · {b.status}</span></div>)}</div>}
      <Modal open={!!pick} onClose={() => setPick(null)} label="Book a meeting">{pick && <>
        <h3>Meet {pick.teacher}</h3><p>{when(pick.starts_at)} · {pick.minutes} minutes · {pick.mode.replace('_', ' ')}{pick.location ? ` · ${pick.location}` : ''}</p>{a.err && <ErrorBox message={a.err} />}
        <Field label="What would you like to talk about? (optional)" rows={2} value={agenda} onChange={setAgenda} />
        <div className="flex"><button className="btn" disabled={a.busy} onClick={() => a.run(() => api(`/family/children/${child.id}/meetings`, { method: 'POST', body: { slotId: pick.id, agenda: agenda || undefined } }), () => { setPick(null); reload(); })}>{t('Book this time')}</button><button className="btn ghost" onClick={() => setPick(null)}>Cancel</button></div></>}</Modal>
    </div>
  );
}

// ============================================ Classwork: this week and shared materials ============================================
export function FamilyClasswork() {
  const { child } = useChild(); const { data, err } = useApi<any>(`/family/children/${child.id}/classwork`, [child.id]);
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  return (
    <div className="stack">
      <h1 className="fam-h">{t('Classwork')}</h1>
      <div className="panel"><h2>{t('What’s being taught')}</h2>{data.plans.length === 0 ? <p className="muted">No lessons planned for the next two weeks.</p> : data.plans.map((l: any, i: number) => <div className="fam-row" key={i}><b>{l.topic}</b> <span className="chip sage">{l.subject}</span><br /><span className="muted" style={{ fontSize: '.85rem' }}>{dayName(l.planned_on)}{l.objectives ? ` · ${l.objectives}` : ''}</span></div>)}</div>
      <div className="panel soft"><h2>{t('Learning materials')}</h2>{data.materials.length === 0 ? <p className="muted">Nothing shared yet.</p> : data.materials.map((m: any) => <div className="fam-row" key={m.id}><b>{m.title}</b> <span className="chip sage">{m.subject}</span>{m.description && <div className="muted">{m.description}</div>}<div className="flex" style={{ marginTop: '.3rem' }}>{m.link_url && <a className="btn ghost sm" href={m.link_url} target="_blank" rel="noopener noreferrer">Open link</a>}{m.has_file && <a className="btn ghost sm" href={`/api/family/children/${child.id}/materials/${m.id}/file`} target="_blank" rel="noopener noreferrer">Open file</a>}<span className="muted" style={{ fontSize: '.8rem' }}>added {dt(m.added)}</span></div></div>)}</div>
    </div>
  );
}

// ============================================ Growth: activities and teacher notes ============================================
const KIND_ICON: Record<string, string> = { sport: 'Sport', arts: 'Arts', club: 'Club', academic: 'Academic', community: 'Community', competition: 'Competition', leadership: 'Leadership', other: 'Other' };
export function FamilyGrowth() {
  const { child } = useChild(); const { data, err } = useApi<any>(`/family/children/${child.id}/growth`, [child.id]);
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  return (
    <div className="stack">
      <h1 className="fam-h">{t('Beyond marks')}</h1>
      <div className="panel"><h2>{t('Activities and achievements')}</h2>{data.activities.length === 0 ? <p className="muted">Nothing recorded yet. Sports, arts, clubs, competitions and leadership appear here as teachers record them.</p> : data.activities.map((x: any) => <div className="fam-row" key={x.id}><div className="flex" style={{ justifyContent: 'space-between' }}><b>{x.title}</b><span className="chip sage">{KIND_ICON[x.kind]}</span></div><span className="muted" style={{ fontSize: '.85rem' }}>{dt(x.occurred_on)} · {x.level.replace('_', ' ')}{x.result ? ` · ${x.result}` : ''}</span>{x.description && <p style={{ margin: '.3rem 0 0' }}>{x.description}</p>}</div>)}</div>
      <div className="panel soft"><h2>{t('Notes from teachers')}</h2>{data.notes.length === 0 ? <p className="muted">No shared notes yet.</p> : data.notes.map((n: any) => <div className="fam-row" key={n.id}><span className="chip sage" style={{ textTransform: 'capitalize' }}>{n.category}</span><p style={{ margin: '.3rem 0' }}>{n.note}</p><span className="muted" style={{ fontSize: '.8rem' }}>{n.author} · {dt(n.date)}</span></div>)}</div>
    </div>
  );
}

// ============================================ Handing in homework ============================================
export function HandIn({ homework, onDone }: { homework: any; onDone: () => void }) {
  const { child } = useChild(); const [open, setOpen] = useState(false); const [text, setText] = useState(''); const file = useRef<HTMLInputElement>(null); const a = useAction();
  const cur = useApi<any>(open ? `/family/children/${child.id}/homework/${homework.id}/submission` : null, [open, homework.id]);
  const sub = cur.data?.submission; const graded = sub?.status === 'graded';
  const send = () => { const fd = new FormData(); if (text.trim()) fd.set('body', text.trim()); if (file.current?.files?.[0]) fd.set('file', file.current.files[0]); return a.run(() => api(`/family/children/${child.id}/homework/${homework.id}/submission`, { method: 'POST', form: fd }), () => { setOpen(false); setText(''); onDone(); }); };
  const status = homework.submission_status;
  return (<>
    <div className="flex" style={{ marginTop: '.5rem' }}>
      {status === 'graded' ? <span className="badge on">Marked{homework.submission_marks !== null ? `: ${homework.submission_marks}${homework.max_marks ? ` / ${homework.max_marks}` : ''}` : ''}</span> : status === 'returned' ? <span className="badge">Returned: please redo</span> : status === 'submitted' ? <span className="badge on">Handed in</span> : null}
      <button className="btn ghost sm" onClick={() => { a.clear(); setOpen(true); }}>{status ? (status === 'graded' ? 'See feedback' : 'View / change') : 'Hand in'}</button>
    </div>
    <Modal open={open} onClose={() => setOpen(false)} label="Hand in homework">
      <h3>{homework.title}</h3>
      {cur.err ? <ErrorBox message={cur.err} /> : !cur.data ? <Loading /> : (<div className="stack">
        {sub && <div className="notice" role="status"><b>Handed in {sub.submitted_at}</b>{sub.late ? ' (late)' : ''}{sub.body && <p style={{ whiteSpace: 'pre-wrap', margin: '.3rem 0' }}>{sub.body}</p>}{sub.has_file && <p style={{ margin: 0 }}><a href={`/api/family/children/${child.id}/homework/${homework.id}/submission/file`} target="_blank" rel="noopener noreferrer">Open attached file</a></p>}</div>}
        {graded && <div className="notice ok"><b>Marks: {sub.marks ?? '—'}{cur.data.assignment.maxMarks ? ` / ${cur.data.assignment.maxMarks}` : ''}</b>{sub.feedback && <p style={{ margin: '.3rem 0 0' }}>{sub.feedback}</p>}<p className="muted" style={{ margin: '.3rem 0 0', fontSize: '.8rem' }}>Marked work cannot be changed.</p></div>}
        {sub?.status === 'returned' && <div className="notice error">The teacher asked for changes{sub.feedback ? `: ${sub.feedback}` : '.'}</div>}
        {!graded && <>{a.err && <ErrorBox message={a.err} />}<Field label="Your answer" rows={4} value={text} onChange={setText} placeholder="Type your answer here, or attach a file." /><div className="field"><label htmlFor="hf">Attach a file (PDF or photo, up to 5 MB)</label><input id="hf" type="file" ref={file} accept="application/pdf,image/jpeg,image/png,image/webp" /></div>
          <div className="flex"><button className="btn" disabled={a.busy} onClick={send}>{a.busy ? 'Sending…' : sub ? 'Hand in again' : 'Hand in'}</button><button className="btn ghost" onClick={() => setOpen(false)}>Close</button></div></>}
        {graded && <button className="btn ghost" onClick={() => setOpen(false)}>Close</button>}
      </div>)}
    </Modal>
  </>);
}
