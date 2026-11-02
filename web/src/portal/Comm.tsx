import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, qs } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Tabs } from '../components/Tabs';
import { Empty, ErrorBox, Loading } from '../components/States';
import { dt, Select, useApi } from './ui';

const when = (v: string) => new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Shared conversation view for staff and parents. */
export function Conversation({ base, post, onBack, reloadList }: { base: string; post: string; onBack: () => void; reloadList: () => void }) {
  const { data, err, reload } = useApi<any>(base, [base]); const [text, setText] = useState(''); const [m, setM] = useState(''); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); reloadList(); }, [data?.messages.length]); // eslint-disable-line
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  const send = async () => { setM(''); try { await api(post, { method: 'POST', body: { body: text } }); setText(''); reload(); } catch (e) { setM((e as ApiError).message); } };
  return (<div className="panel convo"><div className="flex" style={{ justifyContent: 'space-between' }}><div><button className="btn ghost sm" onClick={onBack}>← All conversations</button><h2 style={{ margin: '.6rem 0 0' }}>{data.thread.subject}</h2><span className="muted" style={{ fontSize: '.85rem' }}>About {data.thread.student} · {data.thread.teacher} and {data.thread.parent}</span></div></div>
    <div className="bubbles" aria-live="polite">{data.messages.map((x: any) => <div key={x.id} className={'bubble' + (x.mine ? ' mine' : '')}><span>{x.body}</span><small>{x.mine ? 'You' : x.sender} · {when(x.created_at)}</small></div>)}<div ref={end} /></div>
    {m && <div className="notice error" role="alert">{m}</div>}
    <div className="flex" style={{ flexWrap: 'nowrap', alignItems: 'end' }}><textarea className="input" style={{ minHeight: 56 }} aria-label="Your message" placeholder="Write a message" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} /><button className="btn" disabled={!text.trim()} onClick={send}>Send</button></div></div>);
}

export function MessagesPage() {
  const threads = useApi<any[]>('/admin/school/messages/threads'); const [open, setOpen] = useState<number | null>(null); const [sp] = useSearchParams();
  const [nw, setNw] = useState(false); const [q, setQ] = useState(''); const found = useApi<any>(q.trim().length >= 2 ? `/admin/school/students${qs({ q })}` : null, [q], true); const [f, setF] = useState<any>({ student: null, subject: '', body: '' }); const [m, setM] = useState('');
  useEffect(() => { const t = Number(sp.get('thread')); if (t) setOpen(t); }, [sp]);
  return (<>
    <div className="ph1"><h1>Messages</h1><button className="btn" onClick={() => { setM(''); setF({ student: null, subject: '', body: '' }); setQ(''); setNw(true); }}>New message to a parent</button></div>
    <p className="muted">Private conversations with parents of students you teach. Only you and that parent can read them.</p>
    {open ? <Conversation base={`/admin/school/messages/threads/${open}`} post={`/admin/school/messages/threads/${open}/messages`} onBack={() => setOpen(null)} reloadList={threads.reload} /> : threads.err ? <ErrorBox message={threads.err} /> : !threads.data ? <Loading /> : threads.data.length === 0 ? <Empty>No conversations yet.</Empty> : <div className="stack" style={{ gap: '.5rem' }}>{threads.data.map((t) => <button key={t.id} className="fam-link" onClick={() => setOpen(t.id)}><span><b>{t.subject}</b> {t.unread > 0 && <span className="badge new">{t.unread} new</span>}<br /><span className="muted" style={{ fontSize: '.85rem' }}>{t.parent} · about {t.student} · {t.preview}</span></span><span className="muted" style={{ fontSize: '.78rem' }}>{when(t.last_message_at)}</span></button>)}</div>}
    <Modal open={nw} onClose={() => setNw(false)} label="New message"><h3>Message a parent</h3>{m && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{m}</div>}
      {!f.student ? <><div className="field"><label htmlFor="mq">Find the student</label><input id="mq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student name or ID" /></div>{found.data?.rows.slice(0, 6).map((s: any) => <button key={s.id} className="fam-link" style={{ marginBottom: '.4rem' }} onClick={() => setF({ ...f, student: s })}><span><b>{s.full_name}</b> <span className="muted">{s.class_name} {s.section_name}</span></span><span aria-hidden>→</span></button>)}</> : <>
        <p>About <b>{f.student.full_name}</b> <button className="btn ghost sm" onClick={() => setF({ ...f, student: null })}>change</button></p>
        <div className="field"><label htmlFor="ms">Subject</label><input id="ms" type="text" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div><div className="field"><label htmlFor="mb">Message</label><textarea id="mb" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
        <div className="flex"><button className="btn" disabled={!f.subject.trim() || !f.body.trim()} onClick={async () => { setM(''); try { const r = await api('/admin/school/messages/threads', { method: 'POST', body: { studentId: f.student.id, subject: f.subject, body: f.body } }); setNw(false); threads.reload(); setOpen(r.id); } catch (e) { setM((e as ApiError).message); } }}>Send</button><button className="btn ghost" onClick={() => setNw(false)}>Cancel</button></div></>}</Modal>
  </>);
}

const CAT: Record<string, string> = { academic: 'Academic', transport: 'Transport', fees: 'Fees', safety: 'Safety', facilities: 'Facilities', staff_conduct: 'Staff conduct (confidential)', student_conduct: 'Student conduct', other: 'Other' };
const STAT = ['open', 'in_progress', 'resolved', 'closed'];

export function ComplaintsPage() {
  const { can } = useAuth(); const handler = can('complaints.handle'); const [tab, setTab] = useState<'desk' | 'mine'>(handler ? 'desk' : 'mine');
  const [status, setStatus] = useState(''); const [cat, setCat] = useState(''); const [q, setQ] = useState('');
  const desk = useApi<any[]>(handler ? `/admin/school/complaints${qs({ status, category: cat, q })}` : null, [status, cat, q], true); const mine = useApi<any[]>('/admin/school/complaints/mine');
  const [open, setOpen] = useState<number | null>(null); const [nw, setNw] = useState<any>(null); const [m, setM] = useState('');
  return (<>
    <div className="ph1"><h1>Complaints & concerns</h1>{can('complaints.submit') && <button className="btn" onClick={() => { setM(''); setNw({ category: 'student_conduct', subject: '', body: '', studentId: '' }); }}>Raise a concern</button>}</div>
    {handler && <Tabs tabs={[{ id: 'desk', label: 'All complaints' }, { id: 'mine', label: 'Raised by me' }]} value={tab} onChange={setTab} />}
    {tab === 'desk' && handler && <><div className="toolbar"><input className="input" type="search" placeholder="Search subject or reference" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} /><Select value={status} onChange={setStatus} blank="Any status" options={STAT.map((s) => ({ value: s, label: s.replace('_', ' ') }))} /><Select value={cat} onChange={setCat} blank="Any category" options={Object.entries(CAT).map(([value, label]) => ({ value, label }))} /></div>
      {desk.err ? <ErrorBox message={desk.err} /> : !desk.data ? <Loading /> : desk.data.length === 0 ? <Empty>No complaints.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Ref</th><th>Subject</th><th>From</th><th>Category</th><th>Assigned</th><th>Status</th></tr></thead><tbody>{desk.data.map((c) => <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(c.id)}><td><code>{c.ref}</code></td><td><b>{c.subject}</b>{c.student && <div className="muted" style={{ fontSize: '.8rem' }}>about {c.student}</div>}</td><td>{c.by}</td><td><span className={'chip ' + (c.confidential ? '' : 'sage')}>{CAT[c.category]}</span></td><td>{c.assigned ?? '—'}</td><td><span className={'badge ' + (c.status === 'open' ? 'new' : c.status === 'in_progress' ? 'contacted' : 'on')}>{c.status.replace('_', ' ')}</span></td></tr>)}</tbody></table></div>}</>}
    {(tab === 'mine' || !handler) && (!mine.data ? <Loading /> : mine.data.length === 0 ? <Empty>You have not raised any concerns.</Empty> : <div className="tbl-wrap"><table className="tbl"><tbody>{mine.data.map((c) => <tr key={c.id}><td><code>{c.ref}</code></td><td><b>{c.subject}</b></td><td>{CAT[c.category]}</td><td><span className="badge new">{c.status.replace('_', ' ')}</span></td><td>{dt(c.created_at)}</td></tr>)}</tbody></table></div>)}
    <ComplaintModal id={open} onClose={() => setOpen(null)} onChange={desk.reload} />
    <Modal open={!!nw} onClose={() => setNw(null)} label="Raise a concern">{nw && <><h3>Raise a concern</h3>{m && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{m}</div>}<p className="muted" style={{ fontSize: '.85rem' }}>Goes to the principal. Choose “Staff conduct” for something that must stay confidential.</p>
      <Select label="About" id="nc1" blank={null} value={nw.category} onChange={(v) => setNw({ ...nw, category: v })} options={Object.entries(CAT).map(([value, label]) => ({ value, label }))} />
      <div className="field"><label htmlFor="nc2">Subject *</label><input id="nc2" type="text" value={nw.subject} onChange={(e) => setNw({ ...nw, subject: e.target.value })} /></div><div className="field"><label htmlFor="nc3">What happened? *</label><textarea id="nc3" value={nw.body} onChange={(e) => setNw({ ...nw, body: e.target.value })} /></div>
      <div className="flex"><button className="btn" onClick={async () => { setM(''); try { await api('/admin/school/complaints', { method: 'POST', body: { category: nw.category, subject: nw.subject, body: nw.body } }); setNw(null); mine.reload(); desk.reload(); setTab('mine'); } catch (e) { setM((e as ApiError).message); } }}>Submit</button><button className="btn ghost" onClick={() => setNw(null)}>Cancel</button></div></>}</Modal>
  </>);
}

function ComplaintModal({ id, onClose, onChange }: { id: number | null; onClose: () => void; onChange: () => void }) {
  const { data: c, err, reload } = useApi<any>(id ? `/admin/school/complaints/${id}` : null, [id]); const hs = useApi<any[]>(id ? '/admin/school/complaints/handlers' : null, [id]);
  const [note, setNote] = useState(''); const [internal, setInternal] = useState(false); const [res, setRes] = useState(''); const [m, setM] = useState('');
  useEffect(() => { setRes(c?.resolution ?? ''); setNote(''); setM(''); }, [c?.id]); // eslint-disable-line
  const patch = async (b: any) => { setM(''); try { await api(`/admin/school/complaints/${id}`, { method: 'PATCH', body: b }); reload(); onChange(); } catch (e) { setM((e as ApiError).message); } };
  return (<Modal open={!!id} onClose={onClose} label="Complaint">{err ? <ErrorBox message={err} /> : !c ? <Loading /> : <>
    <div className="flex" style={{ justifyContent: 'space-between' }}><code>{c.ref}</code><span className="chip">{CAT[c.category]}</span></div><h3 style={{ marginTop: '.4rem' }}>{c.subject}</h3><p className="muted" style={{ fontSize: '.85rem' }}>From {c.by}{c.student ? ` · about ${c.student} (${c.student_code})` : ''} · {when(c.created_at)}</p><p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
    {m && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{m}</div>}
    <div className="two-col"><Select label="Status" id="cs1" blank={null} value={c.status} onChange={(v) => patch({ status: v, resolution: res || undefined })} options={STAT.map((s) => ({ value: s, label: s.replace('_', ' ') }))} /><Select label="Assigned to" id="cs2" value={c.assigned_to ?? ''} onChange={(v) => patch({ assignedTo: v || null })} blank="Nobody" options={(hs.data ?? []).map((h) => ({ value: h.id, label: h.display_name }))} /></div>
    <div className="field"><label htmlFor="cs3">Resolution (shown to the person who complained)</label><textarea id="cs3" value={res} onChange={(e) => setRes(e.target.value)} onBlur={() => res && res !== c.resolution && patch({ resolution: res })} /></div>
    <h3 style={{ fontSize: '1.15rem' }}>Updates</h3>{c.updates.length === 0 ? <p className="muted">None yet.</p> : c.updates.map((u: any) => <div key={u.id} className="fam-row"><span className="muted" style={{ fontSize: '.8rem' }}>{u.author ?? 'complainant'} · {when(u.created_at)} {u.internal && <span className="chip">internal</span>}</span><div>{u.note}</div></div>)}
    <div className="field" style={{ marginTop: '.8rem' }}><label htmlFor="cs4">Add an update</label><textarea id="cs4" value={note} onChange={(e) => setNote(e.target.value)} /></div><label className="check" style={{ marginBottom: '.8rem' }}><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /><span>Internal note: not shown to the person who complained</span></label>
    <div className="flex"><button className="btn" disabled={!note.trim()} onClick={async () => { setM(''); try { await api(`/admin/school/complaints/${id}/updates`, { method: 'POST', body: { note, internal } }); setNote(''); reload(); } catch (e) { setM((e as ApiError).message); } }}>Add update</button><button className="btn ghost" onClick={onClose}>Close</button></div></>}</Modal>);
}
