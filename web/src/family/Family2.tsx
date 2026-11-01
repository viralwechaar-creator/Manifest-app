import { useState } from 'react';
import { api, ApiError } from '../api';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { fmtDate } from '../lib';
import { Conversation } from '../portal/Comm';
import { useApi } from '../portal/ui';
import { inr } from '../portal/Receipt';
import { useChild } from './Family';

const when = (v: string) => new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function FamilyMessages() {
  const { child, role } = useChild(); const threads = useApi<any[]>(role === 'parent' ? '/family/messages' : null); const teachers = useApi<any[]>(`/family/children/${child.id}/teachers`, [child.id]);
  const [open, setOpen] = useState<number | null>(null); const [nw, setNw] = useState<any>(null); const [e, setE] = useState('');
  if (role !== 'parent') return <div className="stack"><h1 className="fam-h">Messages</h1><Empty>Messages with teachers are for parents.</Empty></div>;
  return (<div className="stack"><div className="flex" style={{ justifyContent: 'space-between' }}><h1 className="fam-h">Messages</h1><button className="btn" onClick={() => { setE(''); setNw({ teacherUserId: '', subject: '', body: '' }); }}>New message</button></div>
    {open ? <Conversation base={`/family/messages/${open}`} post={`/family/messages/${open}`} onBack={() => setOpen(null)} reloadList={threads.reload} /> : threads.err ? <ErrorBox message={threads.err} /> : !threads.data ? <Loading /> : threads.data.length === 0 ? <Empty>No conversations yet. Use “New message” to write to a teacher.</Empty> : threads.data.map((t) => <button key={t.id} className="fam-link" onClick={() => setOpen(t.id)}><span><b>{t.subject}</b> {t.unread > 0 && <span className="badge new">{t.unread} new</span>}<br /><span className="muted" style={{ fontSize: '.85rem' }}>{t.teacher} · about {t.student}</span><br /><span className="muted" style={{ fontSize: '.82rem' }}>{t.preview}</span></span><span className="muted" style={{ fontSize: '.75rem' }}>{when(t.last_message_at)}</span></button>)}
    <Modal open={!!nw} onClose={() => setNw(null)} label="New message"><h3>Message a teacher of {child.full_name.split(' ')[0]}</h3>{e && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{e}</div>}
      <div className="field"><label htmlFor="fm1">To</label><select id="fm1" value={nw?.teacherUserId ?? ''} onChange={(x) => setNw({ ...nw, teacherUserId: x.target.value })}><option value="">Choose a teacher</option>{(teachers.data ?? []).map((t) => <option key={t.user_id} value={t.user_id}>{t.full_name}{t.role ? ` · ${t.role}` : ''}</option>)}</select></div>
      <div className="field"><label htmlFor="fm2">Subject</label><input id="fm2" type="text" value={nw?.subject ?? ''} onChange={(x) => setNw({ ...nw, subject: x.target.value })} /></div><div className="field"><label htmlFor="fm3">Message</label><textarea id="fm3" value={nw?.body ?? ''} onChange={(x) => setNw({ ...nw, body: x.target.value })} /></div>
      <div className="flex"><button className="btn" disabled={!nw?.teacherUserId || !nw?.subject?.trim() || !nw?.body?.trim()} onClick={async () => { setE(''); try { const r = await api('/family/messages', { method: 'POST', body: { studentId: child.id, teacherUserId: nw.teacherUserId, subject: nw.subject, body: nw.body } }); setNw(null); threads.reload(); setOpen(r.id); } catch (x) { setE((x as ApiError).message); } }}>Send</button><button className="btn ghost" onClick={() => setNw(null)}>Cancel</button></div></Modal></div>);
}

const CATS: Record<string, string> = { academic: 'Academics', transport: 'Transport', fees: 'Fees', safety: 'Safety', facilities: 'Facilities', staff_conduct: 'A staff member (kept confidential)', other: 'Something else' };
export function FamilyConcerns() {
  const { child, role } = useChild(); const list = useApi<any[]>('/family/complaints'); const [open, setOpen] = useState<number | null>(null); const one = useApi<any>(open ? `/family/complaints/${open}` : null, [open]);
  const [nw, setNw] = useState<any>(null); const [e, setE] = useState(''); const [reply, setReply] = useState('');
  return (<div className="stack"><div className="flex" style={{ justifyContent: 'space-between' }}><h1 className="fam-h">Concerns</h1>{role === 'parent' && <button className="btn" onClick={() => { setE(''); setNw({ category: 'academic', subject: '', body: '', about: true }); }}>Raise a concern</button>}</div>
    <p className="muted">Tell the school about anything that worries you. The principal’s office reads every concern and replies here.</p>
    {list.err ? <ErrorBox message={list.err} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty>You have not raised any concerns.</Empty> : list.data.map((c) => <button key={c.id} className="fam-link" onClick={() => { setOpen(c.id); setReply(''); }}><span><b>{c.subject}</b><br /><span className="muted" style={{ fontSize: '.82rem' }}>{c.ref} · {CATS[c.category]} · {fmtDate(c.created_at)}</span></span><span className={'badge ' + (c.status === 'resolved' || c.status === 'closed' ? 'on' : 'new')}>{c.status.replace('_', ' ')}</span></button>)}
    <Modal open={!!open} onClose={() => setOpen(null)} label="Concern">{!one.data ? <Loading /> : <><code>{one.data.ref}</code><h3 style={{ marginTop: '.3rem' }}>{one.data.subject}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{one.data.body}</p>{one.data.resolution && <div className="notice ok"><b>Outcome:</b> {one.data.resolution}</div>}
      {one.data.updates.map((u: any, i: number) => <div key={i} className="fam-row"><span className="muted" style={{ fontSize: '.8rem' }}>{u.who} · {when(u.created_at)}</span><div>{u.note}</div></div>)}
      {one.data.status !== 'closed' && <><div className="field" style={{ marginTop: '1rem' }}><label htmlFor="fc9">Add more information</label><textarea id="fc9" value={reply} onChange={(x) => setReply(x.target.value)} /></div><button className="btn" disabled={!reply.trim()} onClick={async () => { await api(`/family/complaints/${open}/reply`, { method: 'POST', body: { note: reply } }); setReply(''); one.reload(); }}>Send</button></>}</>}</Modal>
    <Modal open={!!nw} onClose={() => setNw(null)} label="Raise a concern"><h3>Raise a concern</h3>{e && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{e}</div>}
      <div className="field"><label htmlFor="fc1">What is it about?</label><select id="fc1" value={nw?.category} onChange={(x) => setNw({ ...nw, category: x.target.value })}>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="field"><label htmlFor="fc2">Subject</label><input id="fc2" type="text" value={nw?.subject ?? ''} onChange={(x) => setNw({ ...nw, subject: x.target.value })} /></div><div className="field"><label htmlFor="fc3">Please describe it</label><textarea id="fc3" value={nw?.body ?? ''} onChange={(x) => setNw({ ...nw, body: x.target.value })} /></div>
      <label className="check" style={{ marginBottom: '1rem' }}><input type="checkbox" checked={!!nw?.about} onChange={(x) => setNw({ ...nw, about: x.target.checked })} /><span>This is about {child.full_name}</span></label>
      <div className="flex"><button className="btn" onClick={async () => { setE(''); try { await api('/family/complaints', { method: 'POST', body: { category: nw.category, subject: nw.subject, body: nw.body, studentId: nw.about ? child.id : null } }); setNw(null); list.reload(); } catch (x) { setE((x as ApiError).message); } }}>Submit</button><button className="btn ghost" onClick={() => setNw(null)}>Cancel</button></div></Modal></div>);
}

export function FamilyTransport() {
  const { child } = useChild(); const { data, err } = useApi<any>(`/family/children/${child.id}/transport`, [child.id]);
  if (err) return <ErrorBox message={err} />; if (data === undefined) return <Loading />;
  return (<div className="stack"><h1 className="fam-h">Transport</h1>{!data ? <Empty>{child.full_name.split(' ')[0]} does not use school transport.</Empty> : <>
    <div className="fam-hero"><div className="eyebrow" style={{ color: 'var(--sand)' }}>Route</div><h1>{data.route}</h1><p>{data.stop} · {data.direction === 'both' ? 'both ways' : data.direction === 'pickup' ? 'morning only' : 'evening only'}</p></div>
    <div className="fam-tiles"><div className="fam-tile"><span>Morning pick-up</span><b>{data.pickup_time ?? '—'}</b></div><div className="fam-tile"><span>Evening drop</span><b>{data.drop_time ?? '—'}</b></div></div>
    <div className="panel"><dl className="kv"><dt>Vehicle</dt><dd>{data.reg_no ?? '—'}</dd><dt>Driver</dt><dd>{data.driver ?? '—'}{data.driver_phone && <> · <a href={`tel:${data.driver_phone}`}>{data.driver_phone}</a></>}</dd><dt>Attendant</dt><dd>{data.attendant ?? '—'}</dd><dt>Monthly fee</dt><dd>{inr(data.monthly_fee)} (included in Fees)</dd></dl></div></>}</div>);
}
export function FamilyLibrary() {
  const { child } = useChild(); const { data, err } = useApi<any>(`/family/children/${child.id}/library`, [child.id]);
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  return (<div className="stack"><h1 className="fam-h">Library</h1>{data.unpaidFines > 0 && <div className="notice error">Unpaid library fines: <b>{inr(data.unpaidFines)}</b>. Please pay at the library.</div>}
    <div className="panel"><h2>Books at home</h2>{data.open.length === 0 ? <p className="muted">No books borrowed right now.</p> : data.open.map((b: any, i: number) => <div className="fam-row" key={i}><div className="flex" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><span><b>{b.title}</b><br /><span className="muted" style={{ fontSize: '.82rem' }}>{b.author}</span></span><span style={{ textAlign: 'right' }}><span className={b.overdue ? 'err' : 'muted'}>due {fmtDate(b.due_on)}</span>{b.fine_so_far > 0 && <div className="err" style={{ fontSize: '.78rem' }}>fine so far {inr(b.fine_so_far)}</div>}</span></div></div>)}</div>
    {data.history.length > 0 && <div className="panel soft"><h2>Returned</h2>{data.history.slice(0, 10).map((b: any, i: number) => <div className="fam-row" key={i}><b>{b.title}</b> <span className="muted" style={{ fontSize: '.82rem' }}>returned {fmtDate(b.returned_on)}{b.fine > 0 ? ` · fine ${inr(b.fine)}${b.fine_paid ? ' (paid)' : ''}` : ''}</span></div>)}</div>}</div>);
}
