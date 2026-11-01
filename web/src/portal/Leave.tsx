import { useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { dt, useApi } from './ui';

const today = () => new Date().toISOString().slice(0, 10);
const day = (v: string) => String(v).slice(0, 10);

export function LeavePage() {
  const { can } = useAuth(); const approver = can('leave.approve');
  const [tab, setTab] = useState<'mine' | 'all'>(approver ? 'all' : 'mine');
  const { data, err, reload } = useApi<any[]>(`/admin/school/leave?scope=${tab}`, [tab]);
  const [open, setOpen] = useState(false); const [f, setF] = useState({ fromDate: today(), toDate: today(), reason: '' }); const [ferr, setFerr] = useState<ApiError | null>(null);
  const [dec, setDec] = useState<any | null>(null); const [note, setNote] = useState(''); const [derr, setDerr] = useState('');
  return (<>
    <div className="ph1"><h1>Leave</h1><button className="btn" onClick={() => { setFerr(null); setOpen(true); }}>Apply for leave</button></div>
    {approver && <Tabs tabs={[{ id: 'all', label: 'All requests' }, { id: 'mine', label: 'My requests' }]} value={tab} onChange={setTab} />}
    {err && <ErrorBox message={err} />}
    {!data ? <Loading /> : data.length === 0 ? <Empty>No leave requests.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr>{tab === 'all' && <th>Who</th>}<th>Dates</th><th>Reason</th><th>Status</th><th /></tr></thead><tbody>{data.map((l) => <tr key={l.id}>
      {tab === 'all' && <td><b>{l.full_name}</b></td>}<td>{dt(l.from_date)}{day(l.from_date) !== day(l.to_date) && <> – {dt(l.to_date)}</>}</td><td>{l.reason}{l.decision_note && <div className="muted" style={{ fontSize: '.8rem' }}>Note: {l.decision_note}</div>}</td>
      <td><span className={'badge ' + (l.status === 'approved' ? 'on' : l.status === 'pending' ? 'new' : 'off')}>{l.status}</span></td>
      <td className="act">{tab === 'all' && l.status === 'pending' && <button className="btn ghost sm" onClick={() => { setDec(l); setNote(''); setDerr(''); }}>Review</button>}{tab === 'mine' && l.status === 'pending' && <button className="btn ghost sm" onClick={async () => { await api(`/admin/school/leave/${l.id}/cancel`, { method: 'POST' }); reload(); }}>Cancel</button>}</td></tr>)}</tbody></table></div>}
    <Modal open={open} onClose={() => setOpen(false)} label="Apply for leave"><h3>Apply for leave</h3>{ferr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{ferr.message}</div>}
      <div className="two-col"><div className="field"><label htmlFor="l1">From</label><input id="l1" type="date" min={today()} value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} /></div><div className="field"><label htmlFor="l2">To</label><input id="l2" type="date" min={f.fromDate} value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></div></div>
      <div className="field"><label htmlFor="l3">Reason</label><textarea id="l3" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
      <p className="muted" style={{ fontSize: '.82rem' }}>If approved, your classes on those days become vacant periods and a substitute is arranged.</p>
      <div className="flex"><button className="btn" onClick={async () => { setFerr(null); try { await api('/admin/school/leave', { method: 'POST', body: f }); setOpen(false); setTab('mine'); reload(); } catch (e) { setFerr(e as ApiError); } }}>Send request</button><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div></Modal>
    <Modal open={!!dec} onClose={() => setDec(null)} label="Review leave">{dec && <><h3>{dec.full_name}</h3><p>{dt(dec.from_date)} – {dt(dec.to_date)}</p><p className="muted">{dec.reason}</p>{derr && <div className="notice error" role="alert">{derr}</div>}
      <div className="field"><label htmlFor="l4">Note (optional)</label><input id="l4" type="text" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="flex">{(['approved', 'rejected'] as const).map((d) => <button key={d} className={d === 'approved' ? 'btn' : 'btn ghost'} onClick={async () => { try { await api(`/admin/school/leave/${dec.id}/decision`, { method: 'POST', body: { decision: d, note } }); setDec(null); reload(); } catch (e) { setDerr((e as ApiError).message); } }}>{d === 'approved' ? 'Approve' : 'Reject'}</button>)}</div></>}</Modal>
  </>);
}

export function SubstitutionsPage() {
  const [date, setDate] = useState(today());
  const { data, err, reload } = useApi<any>(`/admin/school/substitutions/vacancies?date=${date}`, [date]);
  const [v, setV] = useState<any | null>(null); const [cands, setCands] = useState<any[] | null>(null); const [aerr, setAerr] = useState('');
  const open = async (row: any) => { setV(row); setCands(null); setAerr(''); try { setCands(await api(`/admin/school/substitutions/candidates?date=${date}&slotId=${row.slot_id}`)); } catch (e) { setAerr((e as ApiError).message); } };
  return (<>
    <div className="ph1"><h1>Vacant periods & substitutions</h1></div>
    <div className="toolbar"><input className="input" style={{ maxWidth: 170 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />{data && <span className={'badge ' + (data.open ? 'new' : 'on')}>{data.open ? `${data.open} still open` : 'All covered'}</span>}</div>
    {err && <ErrorBox message={err} />}
    {!data ? <Loading /> : data.rows.length === 0 ? <Empty>No vacant periods on this day. A period becomes vacant when its teacher is marked absent or has approved leave.</Empty> : <div className="stack">{data.rows.map((r: any) => <div className="panel" key={r.slot_id}>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <div><b style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>{r.period}</b> <span className="muted">{r.starts_at}–{r.ends_at}</span><div>{r.section} · {r.subject}</div><div className="muted" style={{ fontSize: '.85rem' }}>{r.absent_teacher} is {r.absence === 'on_leave' ? 'on leave' : 'absent'}</div></div>
        {r.substitution_id ? <div className="flex"><span className="badge on">Covered by {r.substitute}</span>{date >= today() && <button className="btn ghost sm" onClick={async () => { await api(`/admin/school/substitutions/${r.substitution_id}`, { method: 'DELETE' }); reload(); }}>Remove</button>}</div>
          : date >= today() ? <button className="btn" onClick={() => open(r)}>Find substitute</button> : <span className="badge off">Not covered</span>}</div></div>)}</div>}
    <Modal open={!!v} onClose={() => setV(null)} label="Choose a substitute">{v && <><h3>Substitute for {v.section}</h3><p className="muted">{v.period} · {v.subject} · {date}</p>{aerr && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{aerr}</div>}
      {!cands ? <Loading /> : cands.length === 0 ? <Empty>No teacher is free in this period.</Empty> : <div className="stack" style={{ gap: '.5rem', maxHeight: 340, overflow: 'auto' }}>{cands.map((c) => <div key={c.id} className="flex" style={{ justifyContent: 'space-between', border: '1px solid var(--line)', borderRadius: 16, padding: '.6rem .9rem' }}>
        <div><b>{c.full_name}</b><div className="muted" style={{ fontSize: '.8rem' }}>{[c.department, c.teaches_subject && 'teaches this subject', c.same_department && !c.teaches_subject && 'same department', c.covering_today > 0 && `${c.covering_today} cover(s) today`].filter(Boolean).join(' · ')}</div></div>
        <button className="btn sm" onClick={async () => { try { await api('/admin/school/substitutions', { method: 'POST', body: { date, slotId: v.slot_id, staffId: c.id } }); setV(null); reload(); } catch (e) { setAerr((e as ApiError).message); } }}>Assign</button></div>)}</div>}</>}</Modal>
  </>);
}
