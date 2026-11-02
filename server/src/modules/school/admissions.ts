import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Request, Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit, notifyPermission } from '../../lib/audit';
import { sha256 } from '../../lib/crypto';
import { requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { PRIVATE_DIR, sniff } from '../uploads';
import { issueParentAccount } from './family';
import { onStudentEnrolled } from './fees';
import { registerStudent } from './students';

export const DOC_KINDS = ['birth_certificate', 'photo', 'address_proof', 'transfer_certificate', 'previous_marksheet', 'other'] as const;
const APP_DIR = path.join(PRIVATE_DIR, 'applications');
fs.mkdirSync(APP_DIR, { recursive: true });
const FINAL = ['rejected', 'withdrawn', 'enrolled'];

const settings = async () => Object.fromEntries((await query("select key, value from site_settings where key in ('admission_required_documents','admissions_accepting','privacy_notice_version')")).rows.map((r) => [r.key, r.value]));
const requiredDocs = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter((x) => (DOC_KINDS as readonly string[]).includes(x));
const trackingCode = () => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = crypto.randomBytes(10); const s = [...b].map((x) => a[x % a.length]).join(''); return `${s.slice(0, 5)}-${s.slice(5)}`; };
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
async function event(applicationId: number, actor: string, action: string, note?: string | null, c = { query }) { await c.query('insert into application_events (application_id, actor, action, note) values ($1,$2,$3,$4)', [applicationId, actor, action, note ?? null]); }

// ======================= Public side (no sign-in; protected by a secret tracking code) =======================
export const applyRouter = Router();
const limiter = rateLimit({ windowMs: 60 * 60_000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again later.' } });
const submitLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many applications from this address. Please try again later.' } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

applyRouter.get('/options', asyncH(async (_req, res) => {
  const st = await settings();
  res.json({
    accepting: st.admissions_accepting !== 'false',
    requiredDocuments: requiredDocs(st.admission_required_documents),
    years: (await query("select id, label, is_current from academic_years where ends_on >= current_date order by starts_on")).rows,
    classes: (await query('select id, name from classes order by level')).rows,
  });
}));

const phone = z.string().trim().regex(/^[+0-9][0-9 ()-]{6,18}$/, 'Enter a valid phone number');
applyRouter.post('/submit', submitLimiter, asyncH(async (req, res) => {
  const st = await settings();
  if (st.admissions_accepting === 'false') throw new HttpError(403, 'Online applications are closed at the moment. Please contact the school office.');
  const b = z.object({
    academicYearId: z.number().int().positive(), classId: z.number().int().positive(), studentName: z.string().trim().min(1).max(120), dateOfBirth: z.string().date(), gender: z.enum(['female', 'male', 'other']),
    previousSchool: z.string().trim().max(160).optional().or(z.literal('')), address: z.string().trim().min(3, 'Please give the home address').max(400), healthNotes: z.string().trim().max(1000).optional().or(z.literal('')),
    guardianName: z.string().trim().min(1).max(120), guardianRelation: z.string().trim().min(1).max(30), guardianPhone: phone, guardianEmail: z.string().trim().email().max(200).optional().or(z.literal('')),
    consent: z.literal(true, { message: 'Please confirm to continue' }), website: z.string().max(0).optional(),
  }).safeParse(req.body);
  if (!b.success) { if ((req.body as any)?.website) return res.json({ ok: true }); throw b.error; }
  const d = b.data;
  if (d.dateOfBirth > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Date of birth cannot be in the future.', { dateOfBirth: 'In the future' });
  const code = trackingCode();
  const out = await tx(async (c) => {
    const yr = Number((await c.query('select extract(year from starts_on)::int y from academic_years where id=$1', [d.academicYearId])).rows[0]?.y);
    if (!yr) throw new HttpError(400, 'Choose an academic year.');
    if (!(await c.query('select 1 from classes where id=$1', [d.classId])).rowCount) throw new HttpError(400, 'Choose a class.');
    const n = (await c.query('insert into application_counters (year, last_number) values ($1,1) on conflict (year) do update set last_number = application_counters.last_number + 1 returning last_number', [yr])).rows[0].last_number;
    const ref = `APP-${yr}-${String(n).padStart(4, '0')}`;
    const r = await c.query(
      `insert into applications (reference, tracking_hash, academic_year_id, class_id, student_name, date_of_birth, gender, previous_school, address, health_notes, guardian_name, guardian_relation, guardian_phone, guardian_email, consent_purpose, consent_notice_version)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::citext,'Process the admission application',$15) returning id`,
      [ref, sha256(code), d.academicYearId, d.classId, d.studentName, d.dateOfBirth, d.gender, d.previousSchool || null, d.address, d.healthNotes || null, d.guardianName, d.guardianRelation, d.guardianPhone, d.guardianEmail || null, st.privacy_notice_version || '1']);
    await event(r.rows[0].id, 'applicant', 'submitted', null, c);
    return { id: r.rows[0].id as number, reference: ref };
  });
  await notifyPermission('admissions.review', 'New admission application', `${d.studentName} (${out.reference})`, `/portal/admissions/${out.id}`);
  res.status(201).json({ reference: out.reference, trackingCode: code, requiredDocuments: requiredDocs(st.admission_required_documents) });
}));

// The tracking code is hashed exactly as issued (XXXXX-XXXXX); normalise user input to that shape.
const codeShape = (c: string) => { const n = normCode(c); return n.length === 10 ? `${n.slice(0, 5)}-${n.slice(5)}` : c; };
async function lookup(reference: string, code: string) {
  const a = (await query('select * from applications where reference=$1 and tracking_hash=$2', [String(reference).trim().toUpperCase(), sha256(codeShape(String(code)))])).rows[0];
  if (!a) throw new HttpError(404, 'We could not find an application with that reference and tracking code.');
  return a;
}

applyRouter.post('/status', limiter, asyncH(async (req, res) => {
  const b = z.object({ reference: z.string().min(5).max(30), code: z.string().min(5).max(20) }).parse(req.body);
  const a = await lookup(b.reference, b.code); const st = await settings(); const need = requiredDocs(st.admission_required_documents);
  const docs = (await query('select id, kind, original_name, status, review_note, uploaded_at from application_documents where application_id=$1 order by id', [a.id])).rows;
  const events = (await query("select at, action, note from application_events where application_id=$1 and actor <> 'internal' order by at", [a.id])).rows;
  res.json({ reference: a.reference, studentName: a.student_name, status: a.status, className: (await query('select name from classes where id=$1', [a.class_id])).rows[0]?.name, submittedAt: a.submitted_at,
    decisionNote: ['approved', 'rejected', 'documents_pending', 'waitlisted', 'enrolled'].includes(a.status) ? a.decision_note : null, documents: docs,
    missingDocuments: need.filter((k) => !docs.some((d) => d.kind === k && d.status !== 'rejected')), canUpload: !FINAL.includes(a.status), requiredDocuments: need, events });
}));

applyRouter.post('/documents', limiter, upload.single('file'), asyncH(async (req, res) => {
  const b = z.object({ reference: z.string().min(5).max(30), code: z.string().min(5).max(20), kind: z.enum(DOC_KINDS) }).parse(req.body);
  const a = await lookup(b.reference, b.code);
  if (FINAL.includes(a.status)) throw new HttpError(409, 'This application is closed, so documents can no longer be added.');
  if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
  const t = sniff(req.file.buffer);
  if (!t) throw new HttpError(400, 'Only JPG, PNG, WebP images and PDF files are allowed.');
  if ((await query('select count(*)::int n from application_documents where application_id=$1', [a.id])).rows[0].n >= 12) throw new HttpError(400, 'You have reached the limit of 12 documents.');
  const stored = `${crypto.randomBytes(18).toString('hex')}.${t.ext}`;
  await fs.promises.writeFile(path.join(APP_DIR, stored), req.file.buffer, { flag: 'wx' });
  const original = path.basename(req.file.originalname).replace(/[^\w.\- ]/g, '_').slice(0, 80);
  const mime = t.ext === 'pdf' ? 'application/pdf' : t.ext === 'png' ? 'image/png' : t.ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const r = await query('insert into application_documents (application_id, kind, original_name, stored_name, mime, size_bytes) values ($1,$2,$3,$4,$5,$6) returning id', [a.id, b.kind, original, stored, mime, req.file.size]);
  await event(a.id, 'applicant', 'document_uploaded', b.kind);
  if (a.status === 'documents_pending') await query("update applications set status='under_review' where id=$1", [a.id]);
  res.status(201).json({ id: r.rows[0].id });
}));

// ======================= Staff side =======================
export const admissionsRouter = Router();
const review = requirePermission('admissions.review');
const idp = (v: string) => z.coerce.number().int().positive().parse(v);
const either = (req: Request, _r: any, next: any) => (req.auth?.permissions.includes('admissions.review') || req.auth?.permissions.includes('admissions.view') ? next() : next(new HttpError(req.auth ? 403 : 401, 'You do not have permission to do this.')));

admissionsRouter.get('/', either, asyncH(async (req, res) => {
  const p: unknown[] = []; const where = ['true']; const q = String(req.query.q ?? '').trim();
  if (q) { p.push(`%${q}%`); where.push(`(a.student_name ilike $${p.length} or a.reference ilike $${p.length} or a.guardian_name ilike $${p.length} or a.guardian_phone ilike $${p.length})`); }
  for (const [k, col] of [['status', 'a.status'], ['class_id', 'a.class_id']] as const) { const v = req.query[k]; if (typeof v === 'string' && v) { p.push(v); where.push(`${col}::text=$${p.length}`); } }
  const page = Math.max(1, Number(req.query.page) || 1); const size = 25;
  const total = (await query(`select count(*)::int n from applications a where ${where.join(' and ')}`, p)).rows[0].n; p.push(size, (page - 1) * size);
  const rows = (await query(
    `select a.id, a.reference, a.student_name, a.status, a.submitted_at, c.name as class_name, ay.label as year, a.guardian_name,
            (select count(*)::int from application_documents d where d.application_id=a.id) as docs, (select count(*)::int from application_documents d where d.application_id=a.id and d.status='verified') as docs_verified
       from applications a join classes c on c.id=a.class_id join academic_years ay on ay.id=a.academic_year_id where ${where.join(' and ')} order by a.submitted_at desc limit $${p.length - 1} offset $${p.length}`, p)).rows;
  const counts = (await query('select status, count(*)::int n from applications group by status')).rows;
  res.json({ rows, total, page, size, counts });
}));

admissionsRouter.get('/:id', either, asyncH(async (req, res) => {
  const id = idp(req.params.id);
  const a = (await query(`select a.*, c.name as class_name, ay.label as year from applications a join classes c on c.id=a.class_id join academic_years ay on ay.id=a.academic_year_id where a.id=$1`, [id])).rows[0];
  if (!a) throw new HttpError(404, 'Application not found');
  delete a.tracking_hash;
  const docs = (await query('select id, kind, original_name, mime, size_bytes, status, review_note, uploaded_at from application_documents where application_id=$1 order by id', [id])).rows;
  const events = (await query('select at, actor, action, note from application_events where application_id=$1 order by at', [id])).rows;
  const need = requiredDocs((await settings()).admission_required_documents);
  const missing = need.filter((k) => !docs.some((d) => d.kind === k && d.status === 'verified'));
  const sections = (await query(`select s.id, s.name, s.capacity, (select count(*)::int from students st where st.section_id=s.id and st.status='active') as used from sections s where s.class_id=$1 and s.academic_year_id=$2 order by s.name`, [a.class_id, a.academic_year_id])).rows;
  await audit(req, 'application.viewed', 'application', id);
  res.json({ ...a, documents: docs, events, requiredDocuments: need, missingVerified: missing, sections });
}));

admissionsRouter.get('/:id/documents/:docId/file', review, asyncH(async (req, res) => {
  const d = (await query('select stored_name, mime, original_name from application_documents where id=$1 and application_id=$2', [idp(req.params.docId), idp(req.params.id)])).rows[0];
  if (!d) throw new HttpError(404, 'Not found');
  await audit(req, 'application.document_opened', 'application', req.params.id, { document: req.params.docId });
  res.set({ 'Content-Type': d.mime, 'Content-Disposition': `inline; filename="${d.original_name.replace(/"/g, '')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(path.join(APP_DIR, d.stored_name)).on('error', () => res.status(404).end()).pipe(res);
}));

const who = async (req: Request) => (await query('select display_name from users where id=$1', [req.auth!.user.id])).rows[0].display_name as string;
async function load(id: number, c: { query: Function } = { query }) {
  const a = (await c.query('select * from applications where id=$1', [id])).rows[0];
  if (!a) throw new HttpError(404, 'Application not found');
  return a;
}

admissionsRouter.post('/:id/action', review, asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = z.object({ action: z.enum(['start_review', 'request_documents', 'waitlist', 'reject', 'withdraw']), note: z.string().trim().max(500).optional() }).parse(req.body);
  const a = await load(id); const name = await who(req);
  if (FINAL.includes(a.status)) throw new HttpError(409, 'This application is already closed.');
  if (['request_documents', 'reject', 'waitlist'].includes(b.action) && !b.note) throw new HttpError(400, 'Please add a note for the applicant.', { note: 'Required' });
  const next = { start_review: 'under_review', request_documents: 'documents_pending', waitlist: 'waitlisted', reject: 'rejected', withdraw: 'withdrawn' }[b.action];
  if (b.action === 'start_review' && a.status !== 'submitted') throw new HttpError(409, 'Review has already started.');
  await query('update applications set status=$2, decision_note=case when $3::text is not null then $3 else decision_note end, decided_by=case when $2 in (\'rejected\',\'withdrawn\') then $4::uuid else decided_by end, decided_at=case when $2 in (\'rejected\',\'withdrawn\') then now() else decided_at end where id=$1', [id, next, b.note ?? null, req.auth!.user.id]);
  await event(id, name, b.action, b.note);
  await audit(req, `application.${b.action}`, 'application', id);
  res.json({ ok: true, status: next });
}));

admissionsRouter.post('/:id/documents/:docId/verify', review, asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = z.object({ status: z.enum(['verified', 'rejected', 'pending']), note: z.string().trim().max(300).optional() }).parse(req.body);
  if (b.status === 'rejected' && !b.note) throw new HttpError(400, 'Please say why the document is rejected.', { note: 'Required' });
  const a = await load(id); if (FINAL.includes(a.status)) throw new HttpError(409, 'This application is already closed.');
  const r = await query('update application_documents set status=$3, review_note=$4, reviewed_by=$5 where id=$1 and application_id=$2 returning kind', [idp(req.params.docId), id, b.status, b.note ?? null, req.auth!.user.id]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await event(id, await who(req), `document_${b.status}`, `${r.rows[0].kind}${b.note ? ': ' + b.note : ''}`);
  // Move to "verified" automatically once every required document is verified.
  const need = requiredDocs((await settings()).admission_required_documents);
  const docs = (await query('select kind, status from application_documents where application_id=$1', [id])).rows;
  const allOk = need.every((k) => docs.some((d) => d.kind === k && d.status === 'verified'));
  if (['submitted', 'under_review', 'documents_pending'].includes(a.status) && need.length > 0 && allOk) await query("update applications set status='verified' where id=$1", [id]);
  if (a.status === 'verified' && !allOk) await query("update applications set status='under_review' where id=$1", [id]);
  await audit(req, 'application.document_reviewed', 'application', id, { status: b.status });
  res.json({ ok: true });
}));

admissionsRouter.post('/:id/approve', review, asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  const a = await load(id);
  if (!['submitted', 'under_review', 'documents_pending', 'verified', 'waitlisted'].includes(a.status)) throw new HttpError(409, 'This application cannot be approved from its current status.');
  const need = requiredDocs((await settings()).admission_required_documents);
  const docs = (await query('select kind, status from application_documents where application_id=$1', [id])).rows;
  const missing = need.filter((k) => !docs.some((d) => d.kind === k && d.status === 'verified'));
  if (missing.length) throw new HttpError(409, `These documents must be uploaded and verified first: ${missing.map((m) => m.replace(/_/g, ' ')).join(', ')}.`);
  await query("update applications set status='approved', decision_note=$2, decided_by=$3, decided_at=now() where id=$1", [id, b.note ?? 'Your application has been approved. The school will contact you with the next steps.', req.auth!.user.id]);
  await event(id, await who(req), 'approved', b.note);
  await audit(req, 'application.approved', 'application', id);
  res.json({ ok: true });
}));

/** Admission confirmation and onboarding: creates the student, issues the student ID and parent login, and raises the first fees. */
admissionsRouter.post('/:id/enrol', review, asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = z.object({ sectionId: z.number().int().positive() }).parse(req.body);
  const out = await tx(async (c) => {
    const a = (await c.query('select * from applications where id=$1 for update', [id])).rows[0];
    if (!a) throw new HttpError(404, 'Application not found');
    if (a.status !== 'approved') throw new HttpError(409, 'Only an approved application can be enrolled.');
    const sec = (await c.query('select class_id, academic_year_id from sections where id=$1', [b.sectionId])).rows[0];
    if (!sec || sec.class_id !== a.class_id || sec.academic_year_id !== a.academic_year_id) throw new HttpError(400, 'Choose a section of the class and year this application is for.');
    const dob = new Date(a.date_of_birth).toISOString().slice(0, 10);
    const s = await registerStudent(c, { fullName: a.student_name, dateOfBirth: dob, gender: a.gender, sectionId: b.sectionId, address: a.address ?? '', healthNotes: a.health_notes ?? '',
      guardians: [{ fullName: a.guardian_name, relation: a.guardian_relation, phone: a.guardian_phone, email: a.guardian_email ?? '', isPrimary: true }] });
    const parent = await issueParentAccount(c, s.id);
    await c.query("update applications set status='enrolled', student_id=$2, decided_at=now() where id=$1", [id, s.id]);
    await c.query('insert into application_events (application_id, actor, action, note) values ($1,$2,$3,$4)', [id, 'internal', 'enrolled', `Student ID ${s.studentCode}`]);
    await c.query("insert into application_events (application_id, actor, action, note) values ($1,'school','enrolled','Admission confirmed. Welcome!')", [id]);
    const fees = await onStudentEnrolled(c, s.id);
    return { studentId: s.id, studentCode: s.studentCode, parentLogin: parent, feesRaised: fees.charges };
  });
  await audit(req, 'application.enrolled', 'application', id, { studentId: out.studentId });
  res.json(out);
}));
