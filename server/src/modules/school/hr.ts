import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Request, Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit, notifyPermission } from '../../lib/audit';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { PRIVATE_DIR, sniff } from '../uploads';
import { eachDate, isoDow, myStaffId, requireStaffId } from './helpers';

const DOC_DIR = path.join(PRIVATE_DIR, 'staff'); const RESUME_DIR = path.join(PRIVATE_DIR, 'resumes');
fs.mkdirSync(DOC_DIR, { recursive: true }); fs.mkdirSync(RESUME_DIR, { recursive: true });
const idp = (v: string) => z.coerce.number().int().positive().parse(v);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const mime = (ext: string) => (ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
const r2 = (n: number) => Math.round(n * 100) / 100;
const sendPrivate = (res: any, dir: string, stored: string, type: string, name: string) => { res.set({ 'Content-Type': type, 'Content-Disposition': `inline; filename="${name.replace(/"/g, '')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); fs.createReadStream(path.join(dir, stored)).on('error', () => res.status(404).end()).pipe(res); };

export const hrRouter = Router();
const hr = requirePermission('hr.manage');

// ======================= Staff documents =======================
async function canSeeStaffDocs(req: Request, staffId: number) {
  if (req.auth!.permissions.includes('hr.manage')) return true;
  return (await myStaffId(req)) === staffId;
}
hrRouter.get('/staff/:id/documents', requireAuth, asyncH(async (req, res) => {
  const id = idp(req.params.id); if (!(await canSeeStaffDocs(req, id))) throw new HttpError(404, 'Not found');
  res.json((await query("select id, kind, title, original_name, size_bytes, to_char(expires_on,'YYYY-MM-DD') as expires_on, uploaded_at from staff_documents where staff_id=$1 order by uploaded_at desc", [id])).rows);
}));
hrRouter.post('/staff/:id/documents', hr, upload.single('file'), asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = z.object({ kind: z.enum(['id_proof', 'qualification', 'experience', 'contract', 'medical', 'other']), title: z.string().trim().min(1).max(120), expiresOn: z.string().date().optional().or(z.literal('')) }).parse(req.body);
  if (!(await query('select 1 from staff where id=$1', [id])).rowCount) throw new HttpError(404, 'Not found'); if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
  const t = sniff(req.file.buffer); if (!t) throw new HttpError(400, 'Only JPG, PNG, WebP images and PDF files are allowed.');
  const stored = `${crypto.randomBytes(18).toString('hex')}.${t.ext}`; await fs.promises.writeFile(path.join(DOC_DIR, stored), req.file.buffer, { flag: 'wx' });
  const r = await query('insert into staff_documents (staff_id, kind, title, stored_name, original_name, mime, size_bytes, expires_on, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id', [id, b.kind, b.title, stored, path.basename(req.file.originalname).replace(/[^\w.\- ]/g, '_').slice(0, 80), mime(t.ext), req.file.size, b.expiresOn || null, req.auth!.user.id]);
  await audit(req, 'staff_document.uploaded', 'staff', id, { kind: b.kind }); res.status(201).json({ id: r.rows[0].id });
}));
hrRouter.get('/staff/:id/documents/:docId/file', requireAuth, asyncH(async (req, res) => {
  const id = idp(req.params.id); if (!(await canSeeStaffDocs(req, id))) throw new HttpError(404, 'Not found');
  const d = (await query('select stored_name, mime, original_name from staff_documents where id=$1 and staff_id=$2', [idp(req.params.docId), id])).rows[0]; if (!d) throw new HttpError(404, 'Not found');
  await audit(req, 'staff_document.opened', 'staff', id, { document: req.params.docId }); sendPrivate(res, DOC_DIR, d.stored_name, d.mime, d.original_name);
}));
hrRouter.delete('/staff/:id/documents/:docId', hr, asyncH(async (req, res) => {
  const d = (await query('delete from staff_documents where id=$1 and staff_id=$2 returning stored_name', [idp(req.params.docId), idp(req.params.id)])).rows[0]; if (!d) throw new HttpError(404, 'Not found');
  await fs.promises.unlink(path.join(DOC_DIR, d.stored_name)).catch(() => {}); await audit(req, 'staff_document.deleted', 'staff', req.params.id); res.json({ ok: true });
}));
hrRouter.get('/documents/expiring', hr, asyncH(async (_req, res) => {
  res.json((await query("select d.id, d.title, d.kind, to_char(d.expires_on,'YYYY-MM-DD') as expires_on, s.id as staff_id, s.full_name from staff_documents d join staff s on s.id=d.staff_id where d.expires_on <= current_date + 60 and s.status <> 'left' order by d.expires_on")).rows);
}));

// ======================= Recruitment =======================
export const jobsPublicRouter = Router();
const jobLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many applications from this address. Please try again later.' } });
jobsPublicRouter.post('/', jobLimiter, upload.single('resume'), asyncH(async (req, res) => {
  const b = z.object({ openingId: z.coerce.number().int().positive().optional(), fullName: z.string().trim().min(1).max(120), email: z.string().trim().email().max(200), phone: z.string().trim().regex(/^[+0-9][0-9 ()-]{6,18}$/, 'Enter a valid phone number'), note: z.string().trim().max(1500).optional(), consent: z.literal('true', { message: 'Please confirm to continue' }), website: z.string().max(0).optional() }).safeParse(req.body);
  if (!b.success) { if (req.body?.website) return res.json({ ok: true }); throw b.error; }
  const d = b.data; let stored: string | null = null, original: string | null = null;
  if (d.openingId && !(await query('select 1 from job_openings where id=$1 and published', [d.openingId])).rowCount) throw new HttpError(400, 'That position is no longer open.');
  if (req.file) { const t = sniff(req.file.buffer); if (!t || t.ext !== 'pdf') throw new HttpError(400, 'Please upload your CV as a PDF.'); stored = `${crypto.randomBytes(18).toString('hex')}.pdf`; await fs.promises.writeFile(path.join(RESUME_DIR, stored), req.file.buffer, { flag: 'wx' }); original = path.basename(req.file.originalname).replace(/[^\w.\- ]/g, '_').slice(0, 80); }
  const ver = (await query("select value from site_settings where key='privacy_notice_version'")).rows[0]?.value ?? '1';
  const r = await query("insert into job_applications (opening_id, full_name, email, phone, note, resume_stored, resume_name, consent_purpose, consent_notice_version) values ($1,$2,$3::citext,$4,$5,$6,$7,'Consider this job application',$8) returning id", [d.openingId ?? null, d.fullName, d.email, d.phone, d.note ?? null, stored, original, ver]);
  await notifyPermission('hr.manage', 'New job application', d.fullName, `/portal/hr/recruitment?open=${r.rows[0].id}`);
  res.status(201).json({ ok: true });
}));

const STAGES = ['new', 'shortlisted', 'interview', 'offered', 'rejected', 'hired'] as const;
hrRouter.get('/applications', hr, asyncH(async (req, res) => {
  const p: unknown[] = []; const where = ['true']; const q = String(req.query.q ?? '').trim();
  if (q) { p.push(`%${q}%`); where.push(`(a.full_name ilike $${p.length} or a.email ilike $${p.length})`); }
  if (req.query.status) { p.push(String(req.query.status)); where.push(`a.status=$${p.length}`); }
  const rows = (await query(`select a.id, a.full_name, a.email, a.phone, a.note, a.status, a.hr_notes, a.created_at, (a.resume_stored is not null) as has_resume, o.title as position, a.staff_id from job_applications a left join job_openings o on o.id=a.opening_id where ${where.join(' and ')} order by a.created_at desc limit 300`, p)).rows;
  await audit(req, 'recruitment.viewed', 'job_applications', undefined, { count: rows.length }); res.json(rows);
}));
hrRouter.patch('/applications/:id', hr, asyncH(async (req, res) => {
  const b = z.object({ status: z.enum(STAGES).optional(), hrNotes: z.string().trim().max(2000).optional() }).parse(req.body); const id = idp(req.params.id);
  const a = (await query('select status, staff_id from job_applications where id=$1', [id])).rows[0]; if (!a) throw new HttpError(404, 'Not found');
  if (a.staff_id && b.status && b.status !== 'hired') throw new HttpError(409, 'This person has already been added as staff.');
  await query('update job_applications set status=coalesce($2,status), hr_notes=coalesce($3,hr_notes) where id=$1', [id, b.status ?? null, b.hrNotes ?? null]); await audit(req, 'recruitment.updated', 'job_application', id, { status: b.status }); res.json({ ok: true });
}));
hrRouter.get('/applications/:id/resume', hr, asyncH(async (req, res) => {
  const a = (await query('select resume_stored, resume_name from job_applications where id=$1', [idp(req.params.id)])).rows[0]; if (!a?.resume_stored) throw new HttpError(404, 'Not found');
  await audit(req, 'recruitment.resume_opened', 'job_application', req.params.id); sendPrivate(res, RESUME_DIR, a.resume_stored, 'application/pdf', a.resume_name ?? 'cv.pdf');
}));
hrRouter.post('/applications/:id/hire', hr, asyncH(async (req, res) => {
  const b = z.object({ designation: z.string().trim().min(1).max(80), kind: z.enum(['teacher', 'non_teaching']), joinedOn: z.string().date().optional() }).parse(req.body); const id = idp(req.params.id);
  const out = await tx(async (c) => {
    const a = (await c.query('select * from job_applications where id=$1 for update', [id])).rows[0]; if (!a) throw new HttpError(404, 'Not found');
    if (a.staff_id) throw new HttpError(409, 'Already added as staff.'); if (!['offered', 'hired'].includes(a.status)) throw new HttpError(409, 'Only someone who has been offered the job can be added as staff.');
    const n = (await c.query("select coalesce(max(substring(staff_code from '[0-9]+$')::int), 0) + 1 as n from staff")).rows[0].n;
    const s = await c.query('insert into staff (staff_code, full_name, kind, designation, email, phone, joined_on) values ($1,$2,$3,$4,$5::citext,$6,$7) returning id, staff_code', ['S' + String(n).padStart(4, '0'), a.full_name, b.kind, b.designation, a.email, a.phone, b.joinedOn ?? null]);
    await c.query("update job_applications set status='hired', staff_id=$2 where id=$1", [id, s.rows[0].id]); return s.rows[0];
  });
  await audit(req, 'recruitment.hired', 'job_application', id, { staffId: out.id }); res.status(201).json({ staffId: out.id, staffCode: out.staff_code });
}));

// ======================= Salary and payroll =======================
const payroll = requirePermission('payroll.manage');
const anyPayroll = (req: any, res: any, next: any) => (req.auth?.permissions.some((p: string) => p === 'payroll.manage' || p === 'payroll.approve') ? next() : next(new HttpError(req.auth ? 403 : 401, 'You do not have permission to do this.')));
hrRouter.get('/staff/:id/salary', payroll, asyncH(async (req, res) => { res.json((await query('select id, name, kind, amount::float as amount from salary_components where staff_id=$1 order by kind desc, name', [idp(req.params.id)])).rows); await audit(req, 'salary.viewed', 'staff', req.params.id); }));
hrRouter.put('/staff/:id/salary', payroll, asyncH(async (req, res) => {
  const id = idp(req.params.id); const { components } = z.object({ components: z.array(z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(['earning', 'deduction']), amount: z.number().min(0).max(10_000_000).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'At most two decimals') })).max(30) }).parse(req.body);
  if (new Set(components.map((c) => c.name.toLowerCase())).size !== components.length) throw new HttpError(400, 'Each component name can be used once.');
  await tx(async (c) => { if (!(await c.query('select 1 from staff where id=$1', [id])).rowCount) throw new HttpError(404, 'Not found'); await c.query('delete from salary_components where staff_id=$1', [id]); for (const x of components) await c.query('insert into salary_components (staff_id, name, kind, amount) values ($1,$2,$3,$4)', [id, x.name, x.kind, x.amount]); });
  await audit(req, 'salary.changed', 'staff', id, { components: components.length }); res.json({ ok: true });
}));

/** Working days = Monday to Saturday. Loss of pay = unexcused absence (half days count half). Approved leave is paid. */
function workingDays(month: string) { let n = 0; const [y, m] = month.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); for (const d of eachDate(`${month}-01`, last)) if (isoDow(d) !== 7) n++; return n; }
async function buildPayslips(c: { query: Function }, runId: number, month: string) {
  const days = workingDays(month); const from = `${month}-01`; const to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).toISOString().slice(0, 10);
  const staff = (await c.query("select s.id, s.full_name from staff s where s.status <> 'left' and (s.joined_on is null or s.joined_on <= $1) order by s.full_name", [to])).rows;
  let made = 0;
  for (const s of staff) {
    const comps = (await c.query('select name, kind, amount::float as amount from salary_components where staff_id=$1', [s.id])).rows; if (!comps.length) continue;
    const att = (await c.query("select status from staff_attendance where staff_id=$1 and date between $2 and $3", [s.id, from, to])).rows;
    const lop = Math.min(days, att.filter((a: any) => a.status === 'absent').length + att.filter((a: any) => a.status === 'half_day').length * 0.5);
    const gross = r2(comps.filter((x: any) => x.kind === 'earning').reduce((a: number, x: any) => a + x.amount, 0)); const ded = r2(comps.filter((x: any) => x.kind === 'deduction').reduce((a: number, x: any) => a + x.amount, 0));
    const lopAmt = r2((gross * lop) / days); const net = Math.max(0, r2(gross - ded - lopAmt));
    await c.query('insert into payslips (run_id, staff_id, working_days, loss_of_pay_days, gross, deductions, lop_deduction, net, lines) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [runId, s.id, days, lop, gross, ded, lopAmt, net, JSON.stringify(comps)]); made++;
  }
  return made;
}
hrRouter.get('/payroll', anyPayroll, asyncH(async (_req, res) => { res.json((await query(`select r.id, r.month, r.status, r.finalised_at, (select count(*)::int from payslips p where p.run_id=r.id) as payslips, (select coalesce(sum(net),0)::float from payslips p where p.run_id=r.id) as total_net, u.display_name as prepared_by from payroll_runs r left join users u on u.id=r.created_by order by r.month desc`)).rows); }));
hrRouter.post('/payroll', payroll, asyncH(async (req, res) => {
  const { month } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') }).parse(req.body);
  if (month > new Date().toISOString().slice(0, 7)) throw new HttpError(400, 'Payroll cannot be prepared for a future month.', { month: 'In the future' });
  const out = await tx(async (c) => {
    let run = (await c.query('select * from payroll_runs where month=$1 for update', [month])).rows[0];
    if (run?.status === 'finalised') throw new HttpError(409, 'This month’s payroll is finalised and locked.');
    if (!run) run = (await c.query('insert into payroll_runs (month, created_by) values ($1,$2) returning *', [month, req.auth!.user.id])).rows[0]; else await c.query('delete from payslips where run_id=$1', [run.id]); // regenerate the draft
    const n = await buildPayslips(c, run.id, month); if (!n) throw new HttpError(400, 'No staff have salary components set up yet.');
    return { id: run.id as number, payslips: n };
  });
  await audit(req, 'payroll.prepared', 'payroll_run', out.id, { month, payslips: out.payslips }); res.status(201).json(out);
}));
hrRouter.get('/payroll/:id', anyPayroll, asyncH(async (req, res) => {
  const id = idp(req.params.id); const run = (await query('select r.*, u.display_name as prepared_by from payroll_runs r left join users u on u.id=r.created_by where r.id=$1', [id])).rows[0]; if (!run) throw new HttpError(404, 'Not found');
  const slips = (await query('select p.id, s.full_name, s.staff_code, p.working_days::float as working_days, p.loss_of_pay_days::float as lop_days, p.gross::float as gross, p.deductions::float as deductions, p.lop_deduction::float as lop_deduction, p.net::float as net from payslips p join staff s on s.id=p.staff_id where p.run_id=$1 order by s.full_name', [id])).rows;
  await audit(req, 'payroll.viewed', 'payroll_run', id); res.json({ ...run, payslips: slips, totals: { gross: r2(slips.reduce((a, s) => a + s.gross, 0)), net: r2(slips.reduce((a, s) => a + s.net, 0)) } });
}));
hrRouter.delete('/payroll/:id', payroll, asyncH(async (req, res) => {
  const r = await query("delete from payroll_runs where id=$1 and status='draft'", [idp(req.params.id)]); if (!r.rowCount) throw new HttpError(409, 'Only a draft can be deleted.'); await audit(req, 'payroll.draft_deleted', 'payroll_run', req.params.id); res.json({ ok: true });
}));
/** Two people: one prepares, a different person with approval rights finalises. Finalising books the salaries as an expense. */
hrRouter.post('/payroll/:id/finalise', requirePermission('payroll.approve'), asyncH(async (req, res) => {
  const id = idp(req.params.id);
  const out = await tx(async (c) => {
    const run = (await c.query('select * from payroll_runs where id=$1 for update', [id])).rows[0]; if (!run) throw new HttpError(404, 'Not found');
    if (run.status !== 'draft') throw new HttpError(409, 'Already finalised.'); if (run.created_by === req.auth!.user.id) throw new HttpError(403, 'Payroll must be finalised by someone other than the person who prepared it.');
    const tot = Number((await c.query('select coalesce(sum(net),0) t from payslips where run_id=$1', [id])).rows[0].t); if (tot <= 0) throw new HttpError(400, 'There is nothing to pay.');
    await c.query("update payroll_runs set status='finalised', finalised_by=$2, finalised_at=now() where id=$1", [id, req.auth!.user.id]);
    await c.query("insert into expenses (category, description, amount, spent_on, mode, recorded_by) values ('Salaries', $1, $2, current_date, 'bank_transfer', $3)", [`Payroll ${run.month}`, tot, req.auth!.user.id]);
    await c.query(`insert into notifications (user_id, title, body, link) select s.user_id, 'Payslip available', $2, '/portal/my/payslips' from payslips p join staff s on s.id=p.staff_id where p.run_id=$1 and s.user_id is not null`, [id, `Your payslip for ${run.month} is ready.`]);
    return { month: run.month, total: tot };
  });
  await audit(req, 'payroll.finalised', 'payroll_run', id, out); res.json(out);
}));

// ---- own payslips (every staff member) and payslip view for payroll staff ----
const slipSql = `select p.id, r.month, r.status, s.full_name, s.staff_code, s.designation, p.working_days::float as working_days, p.loss_of_pay_days::float as lop_days, p.gross::float as gross, p.deductions::float as deductions, p.lop_deduction::float as lop_deduction, p.net::float as net, p.lines
  from payslips p join payroll_runs r on r.id=p.run_id join staff s on s.id=p.staff_id`;
hrRouter.get('/me/payslips', requireAuth, asyncH(async (req, res) => { const sid = await requireStaffId(req); res.json((await query(`select p.id, r.month, p.net::float as net from payslips p join payroll_runs r on r.id=p.run_id where p.staff_id=$1 and r.status='finalised' order by r.month desc`, [sid])).rows); }));
hrRouter.get('/payslips/:id', requireAuth, asyncH(async (req, res) => {
  const row = (await query(`${slipSql} where p.id=$1`, [idp(req.params.id)])).rows[0]; if (!row) throw new HttpError(404, 'Not found');
  const own = row.status === 'finalised' && (await myStaffId(req)) === (await query('select staff_id from payslips where id=$1', [row.id])).rows[0].staff_id;
  const officer = req.auth!.permissions.includes('payroll.manage') || req.auth!.permissions.includes('payroll.approve');
  if (!own && !officer) throw new HttpError(404, 'Not found'); // someone else's payslip is simply not found
  const school = (await query("select value from site_settings where key='school_name'")).rows[0]?.value ?? '';
  await audit(req, 'payslip.viewed', 'payslip', row.id); res.json({ ...row, school });
}));
