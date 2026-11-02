import { useState } from 'react';
import { api } from '../api';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { useAction, useApi } from './ui';

type Tab = 'enrolment' | 'workload' | 'transport' | 'safety';
const Meter = ({ pct, warn }: { pct: number | null; warn?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', minWidth: 120 }}>
    <div className="meter" style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--paper-2)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${Math.min(100, pct ?? 0)}%`, background: warn ? 'var(--danger)' : 'var(--forest)' }} /></div>
    <span style={{ fontSize: '.82rem', minWidth: 42 }}>{pct === null ? '—' : `${pct}%`}</span>
  </div>
);

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('enrolment');
  return (
    <>
      <div className="ph1"><h1>Reports</h1></div>
      <Tabs tabs={[{ id: 'enrolment' as const, label: 'Enrolment & retention' }, { id: 'workload' as const, label: 'Teacher workload' }, { id: 'transport' as const, label: 'Transport' }, { id: 'safety' as const, label: 'Safety' }]} value={tab} onChange={setTab} />
      {tab === 'enrolment' && <Enrolment />}{tab === 'workload' && <Workload />}{tab === 'transport' && <Transport />}{tab === 'safety' && <Safety />}
    </>
  );
}

function Enrolment() {
  const { data, err } = useApi<any>('/admin/school/reports/enrolment');
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="kpis"><div className="kpi"><b style={{ fontSize: '1.8rem' }}>{data.totals.active}</b><span>Active students</span></div><div className="kpi"><b style={{ fontSize: '1.8rem' }}>{data.totals.capacity}</b><span>Seats this year</span></div><div className="kpi"><b style={{ fontSize: '1.8rem' }}>{data.totals.capacity ? Math.round((data.totals.active / data.totals.capacity) * 100) : 0}%</b><span>Seats filled</span></div></div>
      <div className="panel"><h2>Class strength this year</h2>{data.strength.length === 0 ? <Empty>No classes set up for the current year.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Class</th><th>Students</th><th>Seats</th><th>Filled</th></tr></thead><tbody>{data.strength.map((r: any) => <tr key={r.class + r.section}><td><b>{r.class} {r.section}</b></td><td>{r.students}</td><td>{r.capacity}</td><td><Meter pct={r.fillPct} warn={r.fillPct > 100} /></td></tr>)}</tbody></table></div>}</div>
      <div className="panel"><h2>Year by year</h2><p className="muted" style={{ fontSize: '.85rem' }}>Retention is the share of students who stayed (promoted, repeated or completed) rather than leaving (transferred or withdrawn).</p>
        {data.byYear.length === 0 ? <Empty>No enrolment history yet.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Year</th><th>Enrolled</th><th>Promoted</th><th>Repeated</th><th>Completed</th><th>Transferred</th><th>Withdrawn</th><th>Retention</th></tr></thead><tbody>{data.byYear.map((y: any) => <tr key={y.year}><td><b>{y.year}</b></td><td>{y.enrolled}</td><td>{y.promoted}</td><td>{y.repeated}</td><td>{y.completed}</td><td>{y.transferred}</td><td>{y.withdrawn}</td><td>{y.retentionPct === null ? '—' : `${y.retentionPct}%`}</td></tr>)}</tbody></table></div>}</div>
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
        <div className="panel"><h2>Admissions by month</h2>{data.admissions.length === 0 ? <p className="muted">None in the last 12 months.</p> : <table className="tbl" style={{ minWidth: 0 }}><tbody>{data.admissions.map((m: any) => <tr key={m.month}><td>{m.month}</td><td><b>{m.n}</b></td></tr>)}</tbody></table>}</div>
        <div className="panel"><h2>Students who left, by month</h2>{data.leavers.length === 0 ? <p className="muted">None in the last 12 months.</p> : <table className="tbl" style={{ minWidth: 0 }}><tbody>{data.leavers.map((m: any) => <tr key={m.month}><td>{m.month}</td><td><b>{m.n}</b></td></tr>)}</tbody></table>}</div>
      </div>
    </div>
  );
}

function Workload() {
  const { data, err } = useApi<any>('/admin/school/reports/workload');
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="kpis"><div className="kpi"><b style={{ fontSize: '1.8rem' }}>{data.teachers}</b><span>Teachers</span></div><div className="kpi"><b style={{ fontSize: '1.8rem' }}>{data.averagePeriodsPerWeek}</b><span>Average periods a week</span></div></div>
      {data.rows.length === 0 ? <Empty>No teachers recorded yet.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Teacher</th><th>Periods / week</th><th>Classes</th><th>Class teacher of</th><th>Homework set (30 days)</th><th>Lessons planned (30 days)</th><th>Substitutions (30 days)</th></tr></thead><tbody>
        {data.rows.map((t: any) => <tr key={t.id}><td><b>{t.full_name}</b><br /><span className="muted">{t.designation ?? t.staff_code}</span></td><td>{t.periods_per_week}</td><td>{t.sections}</td><td>{t.class_teacher_of}</td><td>{t.homework_set_30d}</td><td>{t.lessons_planned_30d}</td><td>{t.substitutions_30d}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

function Transport() {
  const { data, err } = useApi<any>('/admin/school/reports/transport');
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="kpis"><div className="kpi"><b style={{ fontSize: '1.8rem' }}>{data.studentsOnTransport}</b><span>Students on transport</span></div><div className="kpi"><b style={{ fontSize: '1.8rem' }}>{data.activeStudents ? Math.round((data.studentsOnTransport / data.activeStudents) * 100) : 0}%</b><span>Of all students</span></div></div>
      {data.expiring.length > 0 && <div className="notice error" role="alert"><b>Vehicle papers due within 30 days:</b> {data.expiring.map((e: any) => `${e.reg_no} ${e.what.toLowerCase()} (${e.on_date})`).join(', ')}</div>}
      {data.routes.length === 0 ? <Empty>No routes set up yet.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Route</th><th>Vehicle</th><th>Stops</th><th>Students</th><th>Seats used</th></tr></thead><tbody>{data.routes.map((r: any) => <tr key={r.id}><td><b>{r.name}</b></td><td>{r.reg_no ?? <span className="muted">none</span>}</td><td>{r.stops}</td><td>{r.students}{r.capacity ? ` / ${r.capacity}` : ''}</td><td><Meter pct={r.utilisationPct} warn={r.overCapacity} /></td></tr>)}</tbody></table></div>}
    </div>
  );
}

function Safety() {
  const { data, err } = useApi<any>('/admin/school/reports/safety');
  if (err) return <ErrorBox message={err} />; if (!data) return <Loading />;
  const weeks = [...new Set(data.gateByWeek.map((g: any) => g.week))] as string[];
  const n = (w: string, k: string) => data.gateByWeek.find((g: any) => g.week === w && g.kind === k)?.n ?? 0;
  return (
    <div className="stack">
      <div className="kpis"><div className="kpi"><b style={{ fontSize: '1.8rem', color: data.openHigh ? 'var(--danger)' : undefined }}>{data.openHigh}</b><span>Serious incidents still open</span></div><div className="kpi"><b style={{ fontSize: '1.8rem' }}>{data.pendingPickups}</b><span>Pickup requests to review</span></div></div>
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
        <div className="panel"><h2>Incidents, last 90 days</h2>{data.incidentsByKind.length === 0 ? <p className="muted">None reported.</p> : <table className="tbl" style={{ minWidth: 0 }}><tbody>{data.incidentsByKind.map((k: any) => <tr key={k.kind}><td style={{ textTransform: 'capitalize' }}>{k.kind}</td><td><b>{k.n}</b></td></tr>)}</tbody></table>}</div>
        <div className="panel"><h2>All incidents by status</h2>{data.incidentsByStatus.length === 0 ? <p className="muted">None reported.</p> : <table className="tbl" style={{ minWidth: 0 }}><tbody>{data.incidentsByStatus.map((k: any) => <tr key={k.status}><td style={{ textTransform: 'capitalize' }}>{k.status}</td><td><b>{k.n}</b></td></tr>)}</tbody></table>}</div>
      </div>
      <div className="panel"><h2>Late arrivals and early departures by week</h2>{weeks.length === 0 ? <p className="muted">None recorded in the last 8 weeks.</p> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Week starting</th><th>Late arrivals</th><th>Early departures</th><th>Collected</th></tr></thead><tbody>{weeks.map((w) => <tr key={w}><td>{w}</td><td>{n(w, 'late_arrival')}</td><td>{n(w, 'early_departure')}</td><td>{n(w, 'pickup')}</td></tr>)}</tbody></table></div>}</div>
    </div>
  );
}

// ============================================ Message delivery log ============================================
export function DeliveryPage() {
  const [status, setStatus] = useState(''); const { data, err, reload } = useApi<any>(`/admin/outbox?status=${status}`, [status], true); const a = useAction(); const [done, setDone] = useState('');
  return (
    <>
      <div className="ph1"><h1>Message delivery</h1>{data?.configured && <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { const r: any = await api('/admin/outbox/process', { method: 'POST', body: {} }); setDone(`Sent ${r.sent}, failed ${r.failed}, will retry ${r.retrying}.`); }, reload)}>Send waiting messages now</button>}</div>
      <p className="muted" style={{ maxWidth: '64ch' }}>Everything families need to know appears in the app first. Email, SMS and WhatsApp copies go out only to people who have switched them on, and never twice for the same message in a day.</p>
      {a.err && <ErrorBox message={a.err} />}{done && <div className="notice ok" role="status">{done}</div>}
      {err ? <ErrorBox message={err} /> : !data ? <Loading /> : (<>
        {!data.configured && <div className="notice" role="status" style={{ marginBottom: '1rem' }}><b>No delivery service is connected yet.</b> Messages stay in the app. To send email, SMS or WhatsApp, connect a provider as described in <code>docs/NOTIFICATIONS.md</code> (it needs your provider account).</div>}
        <div className="kpis">{['queued', 'sent', 'failed'].map((s) => <button key={s} className="kpi" style={{ border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setStatus(status === s ? '' : s)}><b style={{ fontSize: '1.6rem' }}>{data.counts.find((c: any) => c.status === s)?.n ?? 0}</b><span>{s}{status === s ? ' (showing)' : ''}</span></button>)}</div>
        {data.rows.length === 0 ? <Empty>No messages here.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>To</th><th>Channel</th><th>Topic</th><th>Status</th><th /></tr></thead><tbody>
          {data.rows.map((m: any) => <tr key={m.id}><td>{m.created}</td><td>{m.person ?? '—'}<br /><span className="muted">{m.to_address}</span></td><td style={{ textTransform: 'capitalize' }}>{m.channel}</td><td>{m.category}</td><td><span className={'badge' + (m.status === 'sent' ? ' on' : '')}>{m.status}</span>{m.last_error && <div className="muted" style={{ fontSize: '.78rem' }}>{m.last_error}</div>}</td>
            <td className="act">{m.status === 'failed' && <button className="btn ghost sm" onClick={() => a.run(() => api(`/admin/outbox/${m.id}/retry`, { method: 'POST', body: {} }), reload)}>Retry</button>}</td></tr>)}</tbody></table></div>}
      </>)}
    </>
  );
}
