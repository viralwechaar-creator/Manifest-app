import { Request, Response, Router } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { notifyFamilies } from './family';

export const feesRouter = Router();
const idp = (v: string) => z.coerce.number().int().positive().parse(v);
const D = z.string().date();
/** Money enters as rupees with at most two decimals and is handled internally as whole paise. */
const money = z.number().positive().max(10_000_000).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most two decimal places');
const paise = (v: number) => Math.round(v * 100);
const rupees = (p: number) => p / 100;
const MODES = ['cash', 'cheque', 'upi', 'bank_transfer', 'card', 'online', 'other'] as const;
type Q = { query: PoolClient['query'] };

// ---------- Balances ----------
const BAL = `select c.id, c.student_id, c.head_id, h.name as head, c.description, c.due_on, to_char(c.due_on,'YYYY-MM-DD') as due_str, round(c.amount*100)::int as gross,
    round((c.amount + coalesce(adj.s,0))*100)::int as net, round(coalesce(al.s,0)*100)::int as paid
  from fee_charges c join fee_heads h on h.id=c.head_id
  left join (select charge_id, sum(amount) s from fee_adjustments group by 1) adj on adj.charge_id=c.id
  left join (select a.charge_id, sum(a.amount) s from payment_allocations a join payments p on p.id=a.payment_id and p.status='valid' group by 1) al on al.charge_id=c.id`;
export async function duesFor(c: Q, studentId: number, lock = false) {
  const rows = (await c.query(`${BAL} where c.student_id=$1 order by c.due_on, c.id ${lock ? 'for update of c' : ''}`, [studentId])).rows;
  return rows.map((r: any) => ({ ...r, balance: r.net - r.paid }));
}
const asMoney = (r: any) => ({ id: r.id, head: r.head, description: r.description, dueOn: r.due_str, amount: rupees(r.gross), adjustments: rupees(r.net - r.gross), net: rupees(r.net), paid: rupees(r.paid), balance: rupees(r.balance) });

// ---------- Charge generation ----------
function periods(freq: string, first: string): { key: string; label: string; due: string }[] {
  const d0 = new Date(first + 'T00:00:00Z'); const mk = (i: number, step: number) => { const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + i * step, d0.getUTCDate())); return d.toISOString().slice(0, 10); };
  const mon = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (freq === 'monthly') return Array.from({ length: 12 }, (_, i) => { const due = mk(i, 1); return { key: due.slice(0, 7), label: mon(due), due }; });
  if (freq === 'quarterly') return Array.from({ length: 4 }, (_, i) => { const due = mk(i, 3); return { key: `Q${i + 1}-${due.slice(0, 4)}`, label: `Term ${i + 1}`, due }; });
  return [{ key: 'one', label: freq === 'annual' ? 'Annual' : '', due: first }];
}

/** Creates any missing charges (safe to repeat). `recurringFrom` skips past recurring periods, e.g. for a student joining mid-year. */
export async function generateCharges(c: PoolClient, opts: { yearId: number; classId?: number; studentId?: number; recurringFrom?: string }) {
  const items = (await c.query(
    `select i.*, to_char(i.first_due_on,'YYYY-MM-DD') as first_due, h.name as head from fee_structure_items i join fee_heads h on h.id=i.head_id where i.academic_year_id=$1 and h.active and ($2::int is null or i.class_id=$2)`, [opts.yearId, opts.classId ?? null])).rows;
  let created = 0;
  for (const it of items) {
    const kids = (await c.query(
      `select s.id from students s join sections sec on sec.id=s.section_id where s.status='active' and sec.class_id=$1 and sec.academic_year_id=$2 and ($3::int is null or s.id=$3)`, [it.class_id, opts.yearId, opts.studentId ?? null])).rows;
    for (const k of kids) for (const p of periods(it.frequency, it.first_due)) {
      if (it.frequency !== 'one_time' && opts.recurringFrom && p.due < opts.recurringFrom) continue;
      const r = await c.query(
        `insert into fee_charges (student_id, item_id, head_id, academic_year_id, period_key, description, amount, due_on) values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (student_id, item_id, period_key) do nothing returning id, amount`,
        [k.id, it.id, it.head_id, opts.yearId, p.key, `${it.head}${p.label ? ' – ' + p.label : ''}`, it.amount, p.due]);
      if (!r.rowCount) continue;
      created++;
      // Standing concessions turn into adjustments on the new charge.
      const cons = (await c.query("select * from concessions where student_id=$1 and academic_year_id=$2 and (head_id is null or head_id=$3)", [k.id, opts.yearId, it.head_id])).rows;
      let left = paise(Number(r.rows[0].amount));
      for (const cn of cons) {
        const want = cn.kind === 'percent' ? Math.round((paise(Number(r.rows[0].amount)) * Number(cn.value)) / 100) : paise(Number(cn.value));
        const give = Math.min(want, left); if (give <= 0) continue; left -= give;
        await c.query("insert into fee_adjustments (charge_id, amount, kind, reason) values ($1,$2,'concession',$3)", [r.rows[0].id, -rupees(give), cn.reason]);
      }
    }
  }
  return { charges: created };
}
/** Called when a student is enrolled: raises the first fees from the class's structure. */
export async function onStudentEnrolled(c: PoolClient, studentId: number) {
  const s = (await c.query('select sec.academic_year_id, sec.class_id from students st join sections sec on sec.id=st.section_id where st.id=$1', [studentId])).rows[0];
  if (!s) return { charges: 0 };
  return generateCharges(c, { yearId: s.academic_year_id, classId: s.class_id, studentId, recurringFrom: new Date().toISOString().slice(0, 7) + '-01' });
}

// ---------- Payments ----------
async function nextReceipt(c: Q, year: number) {
  const n = (await c.query('insert into receipt_counters (year, last_number) values ($1,1) on conflict (year) do update set last_number = receipt_counters.last_number + 1 returning last_number', [year])).rows[0].last_number;
  return `REC-${year}-${String(n).padStart(6, '0')}`;
}
export async function recordPayment(c: PoolClient, p: { studentId: number; amount: number; mode: string; reference?: string | null; paidOn: string; note?: string | null; source: 'counter' | 'claim'; userId: string; allocations?: { chargeId: number; amount: number }[] }) {
  if (!(await c.query('select 1 from students where id=$1', [p.studentId])).rowCount) throw new HttpError(404, 'Student not found');
  const dues = (await duesFor(c, p.studentId, true)).filter((d: any) => d.balance > 0);
  const total = paise(p.amount); let plan: { chargeId: number; cents: number }[] = [];
  if (p.allocations?.length) {
    let sum = 0;
    for (const a of p.allocations) {
      const d = dues.find((x: any) => x.id === a.chargeId); const cents = paise(a.amount);
      if (!d) throw new HttpError(400, 'One of the selected fees is not owed by this student.');
      if (cents > d.balance) throw new HttpError(400, `${d.description}: the amount is more than what is owed (${rupees(d.balance)}).`);
      sum += cents; plan.push({ chargeId: a.chargeId, cents });
    }
    if (sum !== total) throw new HttpError(400, `The selected fees add up to ${rupees(sum)}, not ${p.amount}.`);
  } else {
    const owed = dues.reduce((a: number, d: any) => a + d.balance, 0);
    if (total > owed) throw new HttpError(400, `The amount is more than the ${rupees(owed)} currently owed. Advance payments are not supported.`, { amount: 'More than is owed' });
    let left = total; for (const d of dues) { if (left <= 0) break; const take = Math.min(left, d.balance); plan.push({ chargeId: d.id, cents: take }); left -= take; }
  }
  const receipt = await nextReceipt(c, Number(p.paidOn.slice(0, 4)));
  const r = await c.query('insert into payments (receipt_no, student_id, amount, mode, reference, paid_on, note, source, received_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id', [receipt, p.studentId, p.amount, p.mode, p.reference ?? null, p.paidOn, p.note ?? null, p.source, p.userId]);
  for (const a of plan) await c.query('insert into payment_allocations (payment_id, charge_id, amount) values ($1,$2,$3)', [r.rows[0].id, a.chargeId, rupees(a.cents)]);
  return { id: r.rows[0].id as number, receiptNo: receipt };
}

export async function buildReceipt(paymentId: number) {
  const p = (await query(
    `select p.*, s.full_name, s.student_code, c.name || ' ' || sec.name as section, u.display_name as received_by_name from payments p join students s on s.id=p.student_id
       left join sections sec on sec.id=s.section_id left join classes c on c.id=sec.class_id left join users u on u.id=p.received_by where p.id=$1`, [paymentId])).rows[0];
  if (!p) throw new HttpError(404, 'Receipt not found');
  const lines = (await query('select ch.description, a.amount::float as amount from payment_allocations a join fee_charges ch on ch.id=a.charge_id where a.payment_id=$1 order by ch.due_on', [paymentId])).rows;
  const refunded = (await query("select coalesce(sum(amount),0)::float t from refunds where payment_id=$1 and status='approved'", [paymentId])).rows[0].t;
  const school = (await query("select key, value from site_settings where key in ('school_name','address','phone')")).rows;
  const sm = Object.fromEntries(school.map((r) => [r.key, r.value]));
  return { receiptNo: p.receipt_no, status: p.status, school: sm.school_name, address: sm.address, phone: sm.phone, student: { name: p.full_name, code: p.student_code, section: p.section }, amount: Number(p.amount), mode: p.mode, reference: p.reference, paidOn: String(p.paid_on).slice(0, 10), note: p.note, receivedBy: p.received_by_name, lines, refunded };
}

// ===================== Staff API =====================
const setup = requirePermission('fees.setup'), viewFees = requirePermission('fees.view'), collect = requirePermission('fees.collect');

feesRouter.get('/heads', requirePermission('dashboard.view'), asyncH(async (_req, res) => { res.json((await query('select * from fee_heads order by name')).rows); }));
feesRouter.post('/heads', setup, asyncH(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
  const r = await query('insert into fee_heads (name) values ($1) returning id', [b.name]); await audit(req, 'fee_head.created', 'fee_head', r.rows[0].id); res.status(201).json({ id: r.rows[0].id });
}));
feesRouter.patch('/heads/:id', setup, asyncH(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(60).optional(), active: z.boolean().optional() }).parse(req.body);
  const r = await query('update fee_heads set name=coalesce($2,name), active=coalesce($3,active) where id=$1', [idp(req.params.id), b.name ?? null, b.active ?? null]);
  if (!r.rowCount) throw new HttpError(404, 'Not found'); res.json({ ok: true });
}));

feesRouter.get('/structure', viewFees, asyncH(async (req, res) => {
  const yearId = idp(String(req.query.yearId));
  res.json((await query(`select i.id, i.class_id, c.name as class_name, i.head_id, h.name as head, i.amount::float as amount, i.frequency, to_char(i.first_due_on,'YYYY-MM-DD') as first_due_on,
      (select count(*)::int from fee_charges ch where ch.item_id=i.id) as charges from fee_structure_items i join classes c on c.id=i.class_id join fee_heads h on h.id=i.head_id where i.academic_year_id=$1 order by c.level, h.name`, [yearId])).rows);
}));
feesRouter.put('/structure', setup, asyncH(async (req, res) => {
  const b = z.object({ yearId: z.number().int().positive(), classId: z.number().int().positive(), headId: z.number().int().positive(), amount: money, frequency: z.enum(['one_time', 'monthly', 'quarterly', 'annual']), firstDueOn: D }).parse(req.body);
  const ex = (await query('select id, (select count(*)::int from fee_charges where item_id=fee_structure_items.id) as n from fee_structure_items where academic_year_id=$1 and class_id=$2 and head_id=$3', [b.yearId, b.classId, b.headId])).rows[0];
  if (ex?.n > 0) throw new HttpError(409, 'Fees have already been generated from this line, so it cannot be changed. Give discounts or adjustments on the individual fees instead.');
  await query(`insert into fee_structure_items (academic_year_id, class_id, head_id, amount, frequency, first_due_on) values ($1,$2,$3,$4,$5,$6)
    on conflict (academic_year_id, class_id, head_id) do update set amount=excluded.amount, frequency=excluded.frequency, first_due_on=excluded.first_due_on`, [b.yearId, b.classId, b.headId, b.amount, b.frequency, b.firstDueOn]);
  await audit(req, 'fee_structure.set', 'class', b.classId, { yearId: b.yearId, headId: b.headId }); res.json({ ok: true });
}));
feesRouter.delete('/structure/:id', setup, asyncH(async (req, res) => {
  const id = idp(req.params.id);
  if ((await query('select 1 from fee_charges where item_id=$1 limit 1', [id])).rowCount) throw new HttpError(409, 'Fees have been generated from this line, so it cannot be removed.');
  const r = await query('delete from fee_structure_items where id=$1', [id]); if (!r.rowCount) throw new HttpError(404, 'Not found'); res.json({ ok: true });
}));
feesRouter.post('/generate', setup, asyncH(async (req, res) => {
  const b = z.object({ yearId: z.number().int().positive(), classId: z.number().int().positive().optional() }).parse(req.body);
  const out = await tx((c) => generateCharges(c, b)); await audit(req, 'fees.generated', 'academic_year', b.yearId, { classId: b.classId, created: out.charges }); res.json(out);
}));

feesRouter.get('/students/:id/dues', viewFees, asyncH(async (req, res) => {
  const id = idp(req.params.id);
  const s = (await query('select s.id, s.full_name, s.student_code, c.name || \' \' || sec.name as section from students s left join sections sec on sec.id=s.section_id left join classes c on c.id=sec.class_id where s.id=$1', [id])).rows[0];
  if (!s) throw new HttpError(404, 'Student not found');
  const dues = (await duesFor({ query: query as any }, id)).map(asMoney);
  const today = new Date().toISOString().slice(0, 10);
  const payments = (await query("select id, receipt_no, amount::float as amount, mode, reference, to_char(paid_on,'YYYY-MM-DD') as paid_on, status from payments where student_id=$1 order by paid_on desc, id desc limit 50", [id])).rows;
  const concessions = (await query('select c.id, c.kind, c.value::float as value, c.reason, h.name as head from concessions c left join fee_heads h on h.id=c.head_id where c.student_id=$1 order by c.id', [id])).rows;
  res.json({ student: s, dues, payments, concessions, totals: { balance: dues.reduce((a, d) => a + d.balance, 0), overdue: dues.filter((d) => d.dueOn < today).reduce((a, d) => a + d.balance, 0), paid: dues.reduce((a, d) => a + d.paid, 0) } });
}));

feesRouter.post('/payments', collect, asyncH(async (req, res) => {
  const b = z.object({ studentId: z.number().int().positive(), amount: money, mode: z.enum(MODES), reference: z.string().trim().max(80).optional(), paidOn: D, note: z.string().trim().max(200).optional(),
    allocations: z.array(z.object({ chargeId: z.number().int().positive(), amount: money })).max(60).optional() }).parse(req.body);
  if (b.paidOn > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'The payment date cannot be in the future.', { paidOn: 'In the future' });
  if (['cheque', 'upi', 'bank_transfer', 'card'].includes(b.mode) && !b.reference) throw new HttpError(400, 'Please enter the cheque, transaction or reference number.', { reference: 'Required' });
  const out = await tx((c) => recordPayment(c, { ...b, source: 'counter', userId: req.auth!.user.id }));
  await notifyFamilies('select id from students where id=$1', [b.studentId], 'Payment received', `₹${b.amount} received. Receipt ${out.receiptNo}.`, '/family/fees');
  await audit(req, 'payment.recorded', 'payment', out.id, { receipt: out.receiptNo, amount: b.amount, mode: b.mode }); res.status(201).json(out);
}));
feesRouter.get('/payments', viewFees, asyncH(async (req, res) => {
  const p: unknown[] = []; const where = ['true']; const q = String(req.query.q ?? '').trim();
  if (q) { p.push(`%${q}%`); where.push(`(p.receipt_no ilike $${p.length} or s.full_name ilike $${p.length} or s.student_code ilike $${p.length} or p.reference ilike $${p.length})`); }
  if (req.query.from) { p.push(D.parse(req.query.from)); where.push(`p.paid_on >= $${p.length}`); } if (req.query.to) { p.push(D.parse(req.query.to)); where.push(`p.paid_on <= $${p.length}`); }
  if (req.query.mode) { p.push(String(req.query.mode)); where.push(`p.mode = $${p.length}`); }
  const page = Math.max(1, Number(req.query.page) || 1); const size = 25;
  const total = (await query(`select count(*)::int n from payments p join students s on s.id=p.student_id where ${where.join(' and ')}`, p)).rows[0].n; p.push(size, (page - 1) * size);
  const rows = (await query(`select p.id, p.receipt_no, p.amount::float as amount, p.mode, p.reference, to_char(p.paid_on,'YYYY-MM-DD') as paid_on, p.status, p.source, s.full_name, s.student_code,
      (select coalesce(sum(amount),0)::float from refunds r where r.payment_id=p.id and r.status='approved') as refunded
      from payments p join students s on s.id=p.student_id where ${where.join(' and ')} order by p.paid_on desc, p.id desc limit $${p.length - 1} offset $${p.length}`, p)).rows;
  res.json({ rows, total, page, size });
}));
feesRouter.get('/payments/:id/receipt', viewFees, asyncH(async (req, res) => { res.json(await buildReceipt(idp(req.params.id))); }));
feesRouter.post('/payments/:id/cancel', requirePermission('refunds.approve'), asyncH(async (req, res) => {
  const b = z.object({ reason: z.string().trim().min(5, 'Please give a reason').max(300) }).parse(req.body); const id = idp(req.params.id);
  await tx(async (c) => {
    const p = (await c.query('select status from payments where id=$1 for update', [id])).rows[0];
    if (!p) throw new HttpError(404, 'Not found'); if (p.status !== 'valid') throw new HttpError(409, 'Already cancelled.');
    if ((await c.query("select 1 from refunds where payment_id=$1 and status in ('requested','approved')", [id])).rowCount) throw new HttpError(409, 'This payment has refunds. Resolve those first.');
    await c.query("update payments set status='cancelled', cancel_reason=$2 where id=$1", [id, b.reason]);
  });
  await audit(req, 'payment.cancelled', 'payment', id, { reason: b.reason }); res.json({ ok: true });
}));

// Concessions, waivers and one-off adjustments
feesRouter.post('/students/:id/concessions', requirePermission('fees.concession'), asyncH(async (req, res) => {
  const b = z.object({ headId: z.number().int().positive().nullable().optional(), yearId: z.number().int().positive(), kind: z.enum(['percent', 'fixed']), value: money, reason: z.string().trim().min(3, 'Please give a reason').max(200), applyToExisting: z.boolean().optional() }).parse(req.body);
  if (b.kind === 'percent' && b.value > 100) throw new HttpError(400, 'A percentage cannot be more than 100.', { value: 'Max 100' });
  const id = idp(req.params.id);
  const n = await tx(async (c) => {
    await c.query('insert into concessions (student_id, head_id, academic_year_id, kind, value, reason, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [id, b.headId ?? null, b.yearId, b.kind, b.value, b.reason, req.auth!.user.id]);
    let applied = 0;
    if (b.applyToExisting) for (const d of await duesFor(c, id, true)) { // unpaid part only, never below what has already been paid
      if ((b.headId && d.head_id !== b.headId) || d.balance <= 0) continue;
      const want = b.kind === 'percent' ? Math.round((d.gross * b.value) / 100) : paise(b.value); const give = Math.min(want, d.balance); if (give <= 0) continue;
      await c.query("insert into fee_adjustments (charge_id, amount, kind, reason, created_by) values ($1,$2,'concession',$3,$4)", [d.id, -rupees(give), b.reason, req.auth!.user.id]); applied++;
    }
    return applied;
  });
  await audit(req, 'concession.granted', 'student', id, { kind: b.kind, value: b.value, existingApplied: n }); res.status(201).json({ appliedToExisting: n });
}));
feesRouter.delete('/concessions/:id', requirePermission('fees.concession'), asyncH(async (req, res) => {
  const r = await query('delete from concessions where id=$1', [idp(req.params.id)]); if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'concession.removed', 'concession', req.params.id); res.json({ ok: true });
}));
feesRouter.post('/charges/:id/adjust', requirePermission('fees.concession'), asyncH(async (req, res) => {
  const b = z.object({ amount: z.number().refine((v) => v !== 0 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6 && Math.abs(v) <= 1_000_000, 'Enter a non-zero amount with at most two decimals'), kind: z.enum(['waiver', 'late_fee', 'correction']), reason: z.string().trim().min(3, 'Please give a reason').max(200) }).parse(req.body);
  const id = idp(req.params.id);
  await tx(async (c) => {
    const row = (await c.query(`${BAL} where c.id=$1 for update of c`, [id])).rows[0]; if (!row) throw new HttpError(404, 'Not found');
    if (row.net + paise(b.amount) < row.paid) throw new HttpError(400, 'This would reduce the fee below what has already been paid. Refund the payment instead.');
    if (row.net + paise(b.amount) < 0) throw new HttpError(400, 'The fee cannot go below zero.');
    await c.query('insert into fee_adjustments (charge_id, amount, kind, reason, created_by) values ($1,$2,$3,$4,$5)', [id, b.amount, b.kind, b.reason, req.auth!.user.id]);
  });
  await audit(req, 'fee.adjusted', 'fee_charge', id, { amount: b.amount, kind: b.kind }); res.status(201).json({ ok: true });
}));

// Refunds need two people: accounts requests, the principal or an administrator approves.
feesRouter.get('/refunds', viewFees, asyncH(async (_req, res) => {
  res.json((await query(`select r.id, r.amount::float as amount, r.reason, r.status, r.created_at, r.decision_note, r.payout_mode, r.payout_reference, p.receipt_no, s.full_name, s.student_code, u.display_name as requested_by
    from refunds r join payments p on p.id=r.payment_id join students s on s.id=p.student_id left join users u on u.id=r.requested_by order by (r.status='requested') desc, r.created_at desc limit 200`)).rows);
}));
feesRouter.post('/refunds', requirePermission('refunds.request'), asyncH(async (req, res) => {
  const b = z.object({ paymentId: z.number().int().positive(), amount: money, reason: z.string().trim().min(5, 'Please give a reason').max(300) }).parse(req.body);
  const r = await tx(async (c) => {
    const p = (await c.query('select amount::float as amount, status from payments where id=$1 for update', [b.paymentId])).rows[0];
    if (!p) throw new HttpError(404, 'Payment not found'); if (p.status !== 'valid') throw new HttpError(409, 'That payment is cancelled.');
    const used = (await c.query("select coalesce(sum(amount),0)::float t from refunds where payment_id=$1 and status in ('requested','approved')", [b.paymentId])).rows[0].t;
    if (paise(b.amount) > paise(p.amount) - paise(used)) throw new HttpError(400, `At most ${rupees(paise(p.amount) - paise(used))} can still be refunded for this payment.`, { amount: 'Too high' });
    return (await c.query('insert into refunds (payment_id, amount, reason, requested_by) values ($1,$2,$3,$4) returning id', [b.paymentId, b.amount, b.reason, req.auth!.user.id])).rows[0].id as number;
  });
  await query(`insert into notifications (user_id, title, body, link) select distinct u.id, 'Refund to approve', $1, '/portal/finance/refunds' from users u join user_roles ur on ur.user_id=u.id join role_permissions rp on rp.role_id=ur.role_id join permissions p on p.id=rp.permission_id where p.code='refunds.approve' and u.status='active' and u.id <> $2`, [`₹${b.amount}: ${b.reason.slice(0, 60)}`, req.auth!.user.id]);
  await audit(req, 'refund.requested', 'refund', r, { amount: b.amount }); res.status(201).json({ id: r });
}));
feesRouter.post('/refunds/:id/decision', requirePermission('refunds.approve'), asyncH(async (req, res) => {
  const b = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional(), payoutMode: z.enum(MODES).optional(), payoutReference: z.string().trim().max(80).optional() }).parse(req.body); const id = idp(req.params.id);
  const info = await tx(async (c) => {
    const r = (await c.query('select * from refunds where id=$1 for update', [id])).rows[0]; if (!r) throw new HttpError(404, 'Not found');
    if (r.status !== 'requested') throw new HttpError(409, 'Already decided.'); if (r.requested_by === req.auth!.user.id) throw new HttpError(403, 'You cannot approve a refund you requested.');
    if (b.decision === 'approved') {
      if (!b.payoutMode) throw new HttpError(400, 'Say how the refund is paid out.', { payoutMode: 'Required' });
      // Take the refund off the payment's allocations, latest-due fees first, so the fees show as owed again.
      let left = paise(Number(r.amount));
      const al = (await c.query('select a.charge_id, round(a.amount*100)::int as cents from payment_allocations a join fee_charges ch on ch.id=a.charge_id where a.payment_id=$1 order by ch.due_on desc, ch.id desc for update of a', [r.payment_id])).rows;
      for (const a of al) { if (left <= 0) break; const take = Math.min(left, a.cents); left -= take;
        if (take === a.cents) await c.query('delete from payment_allocations where payment_id=$1 and charge_id=$2', [r.payment_id, a.charge_id]); else await c.query('update payment_allocations set amount = amount - $3 where payment_id=$1 and charge_id=$2', [r.payment_id, a.charge_id, rupees(take)]); }
    }
    await c.query('update refunds set status=$2, decided_by=$3, decided_at=now(), decision_note=$4, payout_mode=$5, payout_reference=$6 where id=$1', [id, b.decision, req.auth!.user.id, b.note ?? null, b.payoutMode ?? null, b.payoutReference ?? null]);
    return (await c.query('select student_id from payments where id=$1', [r.payment_id])).rows[0];
  });
  if (b.decision === 'approved') await notifyFamilies('select id from students where id=$1', [info.student_id], 'Refund approved', 'A refund has been approved and will be paid out by the school.', '/family/fees');
  await audit(req, `refund.${b.decision}`, 'refund', id); res.json({ ok: true });
}));

// Expenses
feesRouter.get('/expenses', requirePermission('expenses.manage'), asyncH(async (req, res) => {
  const p: unknown[] = []; const where = ['true'];
  if (req.query.from) { p.push(D.parse(req.query.from)); where.push(`spent_on >= $${p.length}`); } if (req.query.to) { p.push(D.parse(req.query.to)); where.push(`spent_on <= $${p.length}`); }
  res.json({ rows: (await query(`select e.id, e.category, e.description, e.amount::float as amount, to_char(e.spent_on,'YYYY-MM-DD') as spent_on, e.mode, e.reference, e.paid_to, u.display_name as recorded_by from expenses e left join users u on u.id=e.recorded_by where ${where.join(' and ')} order by e.spent_on desc, e.id desc limit 300`, p)).rows,
    categories: (await query('select distinct category from expenses order by 1')).rows.map((r) => r.category) });
}));
feesRouter.post('/expenses', requirePermission('expenses.manage'), asyncH(async (req, res) => {
  const b = z.object({ category: z.string().trim().min(1).max(40), description: z.string().trim().min(1).max(200), amount: money, spentOn: D, mode: z.enum(['cash', 'cheque', 'upi', 'bank_transfer', 'card', 'other']), reference: z.string().trim().max(80).optional(), paidTo: z.string().trim().max(120).optional() }).parse(req.body);
  if (b.spentOn > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'The date cannot be in the future.', { spentOn: 'In the future' });
  const r = await query('insert into expenses (category, description, amount, spent_on, mode, reference, paid_to, recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id', [b.category, b.description, b.amount, b.spentOn, b.mode, b.reference ?? null, b.paidTo ?? null, req.auth!.user.id]);
  await audit(req, 'expense.recorded', 'expense', r.rows[0].id, { amount: b.amount }); res.status(201).json({ id: r.rows[0].id });
}));
feesRouter.delete('/expenses/:id', requirePermission('refunds.approve'), asyncH(async (req, res) => {
  const r = await query('delete from expenses where id=$1', [idp(req.params.id)]); if (!r.rowCount) throw new HttpError(404, 'Not found'); await audit(req, 'expense.deleted', 'expense', req.params.id); res.json({ ok: true });
}));

// Parents' "I have paid" notifications, confirmed by accounts
feesRouter.get('/claims', collect, asyncH(async (req, res) => {
  const st = String(req.query.status ?? 'pending');
  res.json((await query(`select c.id, c.amount::float as amount, c.mode, c.reference, to_char(c.paid_on,'YYYY-MM-DD') as paid_on, c.note, c.status, c.decision_note, c.created_at, s.id as student_id, s.full_name, s.student_code, p.receipt_no
    from payment_claims c join students s on s.id=c.student_id left join payments p on p.id=c.payment_id where ($1 = 'all' or c.status=$1) order by c.created_at desc limit 200`, [st])).rows);
}));
feesRouter.post('/claims/:id/decision', collect, asyncH(async (req, res) => {
  const b = z.object({ decision: z.enum(['accepted', 'rejected']), note: z.string().trim().max(300).optional() }).parse(req.body); const id = idp(req.params.id);
  if (b.decision === 'rejected' && !b.note) throw new HttpError(400, 'Please tell the parent why.', { note: 'Required' });
  const out = await tx(async (c) => {
    const cl = (await c.query('select * from payment_claims where id=$1 for update', [id])).rows[0]; if (!cl) throw new HttpError(404, 'Not found'); if (cl.status !== 'pending') throw new HttpError(409, 'Already decided.');
    let receipt: string | null = null; let paymentId: number | null = null;
    if (b.decision === 'accepted') { const p = await recordPayment(c, { studentId: cl.student_id, amount: Number(cl.amount), mode: cl.mode, reference: cl.reference, paidOn: new Date(cl.paid_on).toISOString().slice(0, 10), note: 'Confirmed from parent notification', source: 'claim', userId: req.auth!.user.id }); receipt = p.receiptNo; paymentId = p.id; }
    await c.query('update payment_claims set status=$2, decided_by=$3, decided_at=now(), decision_note=$4, payment_id=$5 where id=$1', [id, b.decision, req.auth!.user.id, b.note ?? null, paymentId]);
    return { studentId: cl.student_id as number, receipt, amount: Number(cl.amount) };
  });
  await notifyFamilies('select id from students where id=$1', [out.studentId], b.decision === 'accepted' ? 'Payment confirmed' : 'Payment could not be confirmed', b.decision === 'accepted' ? `₹${out.amount} confirmed. Receipt ${out.receipt}.` : (b.note ?? ''), '/family/fees');
  await audit(req, `payment_claim.${b.decision}`, 'payment_claim', id); res.json({ ok: true, receiptNo: out.receipt });
}));

// ---------- Reports ----------
const reports = requirePermission('finance.reports');
const csvCell = (v: unknown) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const sendCsv = (res: Response, name: string, head: string[], rows: unknown[][]) => { res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' }); res.send([head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')); };

async function collection(from: string, to: string) {
  const v = "p.status='valid' and p.paid_on between $1 and $2";
  const refunded = (await query("select coalesce(sum(r.amount),0)::float t from refunds r join payments p on p.id=r.payment_id where r.status='approved' and r.decided_at::date between $1 and $2", [from, to])).rows[0].t;
  return {
    totalReceived: (await query(`select coalesce(sum(amount),0)::float t, count(*)::int n from payments p where ${v}`, [from, to])).rows[0],
    refunded, expenses: (await query('select coalesce(sum(amount),0)::float t from expenses where spent_on between $1 and $2', [from, to])).rows[0].t,
    byMode: (await query(`select mode, sum(amount)::float as total, count(*)::int as n from payments p where ${v} group by mode order by total desc`, [from, to])).rows,
    byHead: (await query(`select h.name as head, sum(a.amount)::float as total from payment_allocations a join payments p on p.id=a.payment_id join fee_charges c on c.id=a.charge_id join fee_heads h on h.id=c.head_id where ${v} group by h.name order by total desc`, [from, to])).rows,
    byClass: (await query(`select cl.name as class, sum(a.amount)::float as total from payment_allocations a join payments p on p.id=a.payment_id join students s on s.id=p.student_id left join sections sec on sec.id=s.section_id left join classes cl on cl.id=sec.class_id where ${v} group by cl.name, cl.level order by cl.level nulls last`, [from, to])).rows,
    daily: (await query(`select to_char(p.paid_on,'YYYY-MM-DD') as day, sum(amount)::float as total from payments p where ${v} group by p.paid_on order by p.paid_on`, [from, to])).rows,
    expensesByCategory: (await query('select category, sum(amount)::float as total from expenses where spent_on between $1 and $2 group by category order by total desc', [from, to])).rows,
  };
}
feesRouter.get('/reports/collection', reports, asyncH(async (req, res) => {
  const to = D.parse(req.query.to ?? new Date().toISOString().slice(0, 10)); const from = D.parse(req.query.from ?? to.slice(0, 8) + '01');
  const c = await collection(from, to); await audit(req, 'report.collection_viewed', 'finance', undefined, { from, to });
  res.json({ from, to, ...c, net: Math.round((c.totalReceived.t - c.refunded - c.expenses) * 100) / 100 });
}));
async function outstanding(classId?: number) {
  const rows = (await query(
    `select s.id, s.student_code, s.full_name, c.id as class_id, c.name as class, sec.name as section, coalesce(sum(b.net - b.paid),0)::int as balance_paise,
            coalesce(sum(case when b.due_on < current_date then b.net - b.paid else 0 end),0)::int as overdue_paise, to_char(min(case when b.net - b.paid > 0 then b.due_on end),'YYYY-MM-DD') as oldest_due
       from students s join sections sec on sec.id=s.section_id join classes c on c.id=sec.class_id
       left join (${BAL.replace('select c.id,', 'select c.id,')}) b on b.student_id=s.id
      where s.status='active' and ($1::int is null or c.id=$1) group by s.id, c.id, c.name, sec.name, c.level having coalesce(sum(b.net - b.paid),0) > 0 order by overdue_paise desc, balance_paise desc`, [classId ?? null])).rows;
  return rows.map((r) => ({ ...r, balance: rupees(r.balance_paise), overdue: rupees(r.overdue_paise) }));
}
feesRouter.get('/reports/outstanding', reports, asyncH(async (req, res) => {
  const classId = req.query.classId ? idp(String(req.query.classId)) : undefined; const rows = await outstanding(classId);
  const byClass = new Map<string, { class: string; class_id: number; balance: number; overdue: number; students: number }>();
  for (const r of rows) { const e = byClass.get(r.class) ?? { class: r.class, class_id: r.class_id, balance: 0, overdue: 0, students: 0 }; e.balance += r.balance; e.overdue += r.overdue; e.students++; byClass.set(r.class, e); }
  await audit(req, 'report.outstanding_viewed', 'finance');
  res.json({ totalBalance: rows.reduce((a, r) => a + r.balance, 0), totalOverdue: rows.reduce((a, r) => a + r.overdue, 0), byClass: [...byClass.values()], students: rows.slice(0, 200) });
}));
feesRouter.get('/reports/outstanding.csv', reports, asyncH(async (req, res) => {
  const rows = await outstanding(req.query.classId ? idp(String(req.query.classId)) : undefined); await audit(req, 'report.outstanding_exported', 'finance', undefined, { rows: rows.length });
  sendCsv(res, 'outstanding-fees.csv', ['Student ID', 'Name', 'Class', 'Section', 'Overdue', 'Total balance', 'Oldest due'], rows.map((r) => [r.student_code, r.full_name, r.class, r.section, r.overdue, r.balance, r.oldest_due ?? '']));
}));
feesRouter.get('/reports/payments.csv', reports, asyncH(async (req, res) => {
  const to = D.parse(req.query.to ?? new Date().toISOString().slice(0, 10)); const from = D.parse(req.query.from ?? to.slice(0, 8) + '01');
  const rows = (await query("select p.receipt_no, to_char(p.paid_on,'YYYY-MM-DD') as paid_on, s.student_code, s.full_name, p.mode, p.reference, p.amount::float as amount, p.status from payments p join students s on s.id=p.student_id where p.paid_on between $1 and $2 order by p.paid_on, p.id", [from, to])).rows;
  await audit(req, 'report.payments_exported', 'finance', undefined, { from, to, rows: rows.length });
  sendCsv(res, `payments-${from}-to-${to}.csv`, ['Receipt', 'Date', 'Student ID', 'Name', 'Mode', 'Reference', 'Amount', 'Status'], rows.map((r) => [r.receipt_no, r.paid_on, r.student_code, r.full_name, r.mode, r.reference, r.amount, r.status]));
}));

// ---------- Reminders ----------
export async function sendFeeReminders(): Promise<{ dueSoon: number; overdue: number }> {
  let dueSoon = 0, overdue = 0;
  for (const [stage, cond, title] of [['due_soon', "b.due_on between current_date and current_date + 3", 'Fee due soon'], ['overdue', 'b.due_on < current_date', 'Fee overdue']] as const) {
    const rows = (await query(`select b.id, b.student_id, b.description, (b.net - b.paid) as bal, b.due_str from (${BAL}) b where (b.net - b.paid) > 0 and ${cond} and not exists (select 1 from fee_reminders r where r.charge_id=b.id and r.stage=$1)`, [stage])).rows;
    for (const r of rows) {
      const ins = await query('insert into fee_reminders (charge_id, stage) values ($1,$2) on conflict do nothing', [r.id, stage]); if (!ins.rowCount) continue;
      await notifyFamilies('select id from students where id=$1', [r.student_id], title, `${r.description}: ₹${rupees(r.bal)} due ${r.due_str}`, '/family/fees');
      if (stage === 'due_soon') dueSoon++; else overdue++;
    }
  }
  return { dueSoon, overdue };
}
feesRouter.post('/reminders/run', collect, asyncH(async (req, res) => { const r = await sendFeeReminders(); await audit(req, 'fees.reminders_sent', 'finance', undefined, r); res.json(r); }));

// ---------- Late fees ----------
/** Adds one late fee to each overdue charge that has not had one, using the school's settings. Off unless a late fee amount is set. */
export async function applyLateFees(by?: string): Promise<{ applied: number; perFee: number }> {
  const val = async (k: string) => Number((await query('select value from site_settings where key=$1', [k])).rows[0]?.value);
  const flat = await val('late_fee_flat'); const grace = Math.max(0, (await val('late_fee_grace_days')) || 0);
  if (!(flat > 0) || flat > 100000) return { applied: 0, perFee: 0 };
  const rows = (await query(`select b.id, b.student_id, b.description, b.due_str from (${BAL}) b where (b.net - b.paid) > 0 and b.due_on + $1::int < current_date and not exists (select 1 from fee_adjustments a where a.charge_id=b.id and a.kind='late_fee')`, [grace])).rows;
  for (const r of rows) {
    await query("insert into fee_adjustments (charge_id, amount, kind, reason, created_by) values ($1,$2,'late_fee',$3,$4)", [r.id, flat, `Late fee: not paid within ${grace} day(s) of ${r.due_str}`, by ?? null]);
    await notifyFamilies('select id from students where id=$1', [r.student_id], 'Late fee added', `${r.description}: a late fee of ₹${flat} was added because it was not paid on time.`, '/family/fees', 'fees');
  }
  return { applied: rows.length, perFee: flat };
}
feesRouter.post('/late-fees/run', collect, asyncH(async (req, res) => { const r = await applyLateFees(req.auth!.user.id); await audit(req, 'fees.late_fees_applied', 'finance', undefined, r); res.json(r); }));
void ({} as Request);
