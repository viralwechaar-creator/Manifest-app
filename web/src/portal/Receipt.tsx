import { Loading } from '../components/States';
import { dt, useApi } from './ui';

export const inr = (n: number) => (n < 0 ? '−' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
export const MODE: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', upi: 'UPI', bank_transfer: 'Bank transfer', card: 'Card', online: 'Online', other: 'Other' };

/** A printable receipt. `path` is the staff or family receipt endpoint. */
export function Receipt({ path }: { path: string }) {
  const { data: r, err } = useApi<any>(path, [path]);
  if (err) return <div className="notice error" role="alert">{err}</div>; if (!r) return <Loading />;
  return (<div className="receipt">
    <div className="rc-head"><div><div className="eyebrow">{r.school}</div><h3 style={{ fontSize: '1.6rem', margin: '.3rem 0' }}>Fee receipt</h3><span className="muted" style={{ fontSize: '.82rem', whiteSpace: 'pre-line' }}>{r.address}{r.phone ? `\n${r.phone}` : ''}</span></div>
      <div style={{ textAlign: 'right' }}><b style={{ fontFamily: 'var(--font-mono)' }}>{r.receiptNo}</b><div className="muted" style={{ fontSize: '.85rem' }}>{dt(r.paidOn)}</div>{r.status === 'cancelled' && <span className="badge off">CANCELLED</span>}</div></div>
    <dl className="kv" style={{ gridTemplateColumns: '110px 1fr', margin: '1rem 0' }}><dt>Student</dt><dd><b>{r.student.name}</b> ({r.student.code})</dd><dt>Class</dt><dd>{r.student.section ?? '—'}</dd><dt>Paid by</dt><dd>{MODE[r.mode]}{r.reference ? ` · ${r.reference}` : ''}</dd></dl>
    <table className="tbl" style={{ minWidth: 0 }}><thead><tr><th>Towards</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead><tbody>{r.lines.map((l: any, i: number) => <tr key={i}><td>{l.description}</td><td style={{ textAlign: 'right' }}>{inr(l.amount)}</td></tr>)}<tr><td><b>Total received</b></td><td style={{ textAlign: 'right' }}><b>{inr(r.amount)}</b></td></tr></tbody></table>
    {r.refunded > 0 && <p className="muted" style={{ fontSize: '.85rem' }}>Of this, {inr(r.refunded)} has been refunded.</p>}
    <p className="muted" style={{ fontSize: '.78rem', marginTop: '1rem' }}>Received by {r.receivedBy ?? 'the school office'}. This is a computer-generated receipt.</p>
    <button className="btn noprint" onClick={() => window.print()}>Print / save as PDF</button></div>);
}
