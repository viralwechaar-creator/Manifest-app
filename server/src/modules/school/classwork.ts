import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { query } from '../../db';
import { audit } from '../../lib/audit';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { PRIVATE_DIR, sniff } from '../uploads';
import { childOf, familyOnly, notifyFamilies } from './family';
import { isAdmin, myStaffId, requireStaffId, teachesSection } from './helpers';

const DIR = path.join(PRIVATE_DIR, 'classwork');
fs.mkdirSync(DIR, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const idp = (v: string) => z.coerce.number().int().positive().parse(v);
const MIME: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

async function storeFile(file: Express.Multer.File | undefined) {
  if (!file) return null;
  const t = sniff(file.buffer);
  if (!t) throw new HttpError(400, 'Only JPG, PNG, WebP images and PDF files are allowed.');
  const stored = `${crypto.randomBytes(18).toString('hex')}.${t.ext}`;
  await fs.promises.writeFile(path.join(DIR, stored), file.buffer, { flag: 'wx' });
  return { stored, name: (file.originalname || 'file').replace(/[^\w.\- ]/g, '_').slice(0, 80) };
}
function sendPrivate(res: Response, stored: string, name: string) {
  const ext = path.extname(stored).slice(1);
  res.set({ 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Content-Disposition': `inline; filename="${name.replace(/"/g, '')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(path.join(DIR, path.basename(stored))).on('error', () => res.status(404).end()).pipe(res);
}

// ======================================= Teacher side =======================================
export const classworkRouter = Router();
const manage = requirePermission('homework.manage');

/** A teacher works on their own homework; admins on any. */
async function ownAssignment(req: Request, assignmentId: number) {
  const a = (await query(`select a.*, to_char(a.due_on,'YYYY-MM-DD') as due_str, sub.name as subject, c.name || ' ' || sec.name as section from assignments a join subjects sub on sub.id=a.subject_id join sections sec on sec.id=a.section_id join classes c on c.id=sec.class_id where a.id=$1`, [assignmentId])).rows[0];
  if (!a) throw new HttpError(404, 'Not found');
  if (!isAdmin(req) && a.staff_id !== (await myStaffId(req))) throw new HttpError(404, 'Not found');
  return a;
}

/** The classes and subjects this teacher may plan lessons and share materials for (admins: every class and its subjects). */
classworkRouter.get('/my-classes', manage, asyncH(async (req, res) => {
  const admin = isAdmin(req); const sid = admin ? null : await requireStaffId(req);
  res.json((await query(
    `select sec.id as section_id, c.name || ' ' || sec.name as section, sub.id as subject_id, sub.name as subject
       from sections sec join classes c on c.id=sec.class_id join academic_years ay on ay.id=sec.academic_year_id and ay.is_current
       join class_subjects cs on cs.class_id=c.id join subjects sub on sub.id=cs.subject_id
      where ($1::int is null or exists (select 1 from teacher_assignments ta where ta.staff_id=$1 and ta.section_id=sec.id and ta.subject_id=sub.id))
      order by c.level, sec.name, sub.name`, [sid])).rows);
}));
classworkRouter.get('/homework/:id/submissions', manage, asyncH(async (req, res) => {
  const a = await ownAssignment(req, idp(req.params.id));
  const rows = (await query(
    `select s.id as student_id, s.full_name, s.student_code, x.id as submission_id, x.status, x.body, x.file_name, (x.file_stored is not null) as has_file, x.marks::float as marks, x.feedback,
            to_char(x.submitted_at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') as submitted_at, ((x.submitted_at at time zone 'Asia/Kolkata')::date > $2::date) as late
       from students s left join assignment_submissions x on x.student_id=s.id and x.assignment_id=$1
      where s.section_id=$3 and s.status='active' order by s.full_name`, [a.id, a.due_on, a.section_id])).rows;
  res.json({ assignment: { id: a.id, title: a.title, subject: a.subject, section: a.section, dueOn: a.due_str, maxMarks: a.max_marks === null ? null : Number(a.max_marks) }, rows, counts: { total: rows.length, submitted: rows.filter((r) => r.submission_id).length, graded: rows.filter((r) => r.status === 'graded').length } });
}));
classworkRouter.put('/submissions/:id/grade', manage, asyncH(async (req, res) => {
  const id = idp(req.params.id);
  const b = z.object({ status: z.enum(['graded', 'returned']), marks: z.number().min(0).optional(), feedback: z.string().trim().max(1000).optional() }).parse(req.body);
  const sub = (await query('select x.id, x.assignment_id, x.student_id from assignment_submissions x where x.id=$1', [id])).rows[0];
  if (!sub) throw new HttpError(404, 'Not found');
  const a = await ownAssignment(req, sub.assignment_id);
  if (b.marks !== undefined && a.max_marks !== null && b.marks > Number(a.max_marks)) throw new HttpError(400, `Marks cannot be more than ${Number(a.max_marks)}.`);
  if (b.status === 'graded' && a.max_marks !== null && b.marks === undefined) throw new HttpError(400, 'Enter the marks, or use "Return for changes".');
  await query('update assignment_submissions set status=$2, marks=$3, feedback=$4, graded_by=$5, graded_at=now() where id=$1', [id, b.status, b.marks ?? null, b.feedback ?? null, req.auth!.user.id]);
  await notifyFamilies('select id from students where id=$1', [sub.student_id], b.status === 'graded' ? 'Homework marked' : 'Homework returned', `${a.title}: ${b.status === 'graded' ? (b.marks !== undefined ? `${b.marks}${a.max_marks !== null ? ` / ${Number(a.max_marks)}` : ''}` : 'marked') : 'please check the teacher’s note and submit again'}.`, '/family/homework', 'academics');
  await audit(req, 'homework.graded', 'assignment', a.id, { studentId: sub.student_id });
  res.json({ ok: true });
}));
classworkRouter.get('/submissions/:id/file', manage, asyncH(async (req, res) => {
  const x = (await query('select assignment_id, file_stored, file_name from assignment_submissions where id=$1', [idp(req.params.id)])).rows[0];
  if (!x?.file_stored) throw new HttpError(404, 'Not found');
  await ownAssignment(req, x.assignment_id);
  sendPrivate(res, x.file_stored, x.file_name ?? 'submission');
}));

// ---- lesson plans ----
const planBody = z.object({ sectionId: z.number().int().positive(), subjectId: z.number().int().positive(), plannedOn: z.string().date(), topic: z.string().trim().min(1).max(200), objectives: z.string().trim().max(1500).optional(), activities: z.string().trim().max(1500).optional(), resources: z.string().trim().max(800).optional() });
classworkRouter.get('/lesson-plans', manage, asyncH(async (req, res) => {
  const admin = isAdmin(req); const sid = admin ? null : await requireStaffId(req);
  const from = z.string().date().catch(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)).parse(req.query.from);
  res.json((await query(
    `select l.id, to_char(l.planned_on,'YYYY-MM-DD') as planned_on, l.topic, l.objectives, l.activities, l.resources, l.status, sub.name as subject, c.name || ' ' || sec.name as section, l.section_id, l.subject_id, t.full_name as teacher
       from lesson_plans l join subjects sub on sub.id=l.subject_id join sections sec on sec.id=l.section_id join classes c on c.id=sec.class_id join staff t on t.id=l.staff_id
      where l.planned_on >= $1 and ($2::int is null or l.staff_id=$2) and ($3::int is null or l.section_id=$3) order by l.planned_on, l.id limit 300`, [from, sid, req.query.sectionId ? idp(String(req.query.sectionId)) : null])).rows);
}));
classworkRouter.post('/lesson-plans', manage, asyncH(async (req, res) => {
  const sid = await requireStaffId(req); const b = planBody.parse(req.body);
  if (!isAdmin(req) && !(await teachesSection(sid, b.sectionId, b.subjectId))) throw new HttpError(403, 'You can plan lessons only for classes and subjects you teach.');
  const r = await query('insert into lesson_plans (section_id, subject_id, staff_id, planned_on, topic, objectives, activities, resources) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id', [b.sectionId, b.subjectId, sid, b.plannedOn, b.topic, b.objectives ?? null, b.activities ?? null, b.resources ?? null]);
  res.status(201).json({ id: r.rows[0].id });
}));
classworkRouter.patch('/lesson-plans/:id', manage, asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = z.object({ status: z.enum(['planned', 'done', 'skipped']).optional(), topic: z.string().trim().min(1).max(200).optional(), objectives: z.string().trim().max(1500).optional(), activities: z.string().trim().max(1500).optional(), resources: z.string().trim().max(800).optional() }).parse(req.body);
  const own = isAdmin(req) ? null : await requireStaffId(req);
  const r = await query('update lesson_plans set status=coalesce($3,status), topic=coalesce($4,topic), objectives=coalesce($5,objectives), activities=coalesce($6,activities), resources=coalesce($7,resources), updated_at=now() where id=$1 and ($2::int is null or staff_id=$2) returning id', [id, own, b.status ?? null, b.topic ?? null, b.objectives ?? null, b.activities ?? null, b.resources ?? null]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));
classworkRouter.delete('/lesson-plans/:id', manage, asyncH(async (req, res) => {
  const own = isAdmin(req) ? null : await requireStaffId(req);
  if (!(await query('delete from lesson_plans where id=$1 and ($2::int is null or staff_id=$2)', [idp(req.params.id), own])).rowCount) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));

// ---- learning materials ----
classworkRouter.get('/materials', manage, asyncH(async (req, res) => {
  const own = isAdmin(req) ? null : await requireStaffId(req);
  res.json((await query(
    `select m.id, m.title, m.description, m.link_url, m.file_name, (m.file_stored is not null) as has_file, to_char(m.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD') as added, sub.name as subject, c.name || ' ' || sec.name as section, t.full_name as teacher
       from learning_materials m join subjects sub on sub.id=m.subject_id join sections sec on sec.id=m.section_id join classes c on c.id=sec.class_id join staff t on t.id=m.staff_id
      where ($1::int is null or m.staff_id=$1) order by m.created_at desc limit 200`, [own])).rows);
}));
classworkRouter.post('/materials', manage, upload.single('file'), asyncH(async (req, res) => {
  const sid = await requireStaffId(req);
  const b = z.object({ sectionId: z.coerce.number().int().positive(), subjectId: z.coerce.number().int().positive(), title: z.string().trim().min(1).max(160), description: z.string().trim().max(600).optional(), linkUrl: z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'Use an http or https link').optional() }).parse(req.body);
  if (!isAdmin(req) && !(await teachesSection(sid, b.sectionId, b.subjectId))) throw new HttpError(403, 'You can share materials only with classes and subjects you teach.');
  if (!req.file && !b.linkUrl) throw new HttpError(400, 'Attach a file or add a link.');
  const f = await storeFile(req.file);
  const r = await query('insert into learning_materials (section_id, subject_id, staff_id, title, description, link_url, file_stored, file_name) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id', [b.sectionId, b.subjectId, sid, b.title, b.description ?? null, b.linkUrl ?? null, f?.stored ?? null, f?.name ?? null]);
  await notifyFamilies('select s.id from students s where s.section_id=$1 and s.status=\'active\'', [b.sectionId], 'New learning material', b.title, '/family/classwork', 'academics');
  res.status(201).json({ id: r.rows[0].id });
}));
classworkRouter.delete('/materials/:id', manage, asyncH(async (req, res) => {
  const own = isAdmin(req) ? null : await requireStaffId(req);
  const r = await query('delete from learning_materials where id=$1 and ($2::int is null or staff_id=$2) returning file_stored', [idp(req.params.id), own]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  if (r.rows[0].file_stored) fs.promises.unlink(path.join(DIR, path.basename(r.rows[0].file_stored))).catch(() => undefined);
  res.json({ ok: true });
}));

// ======================================= Family side =======================================
export const familyClasswork = Router();
familyClasswork.use(requireAuth, familyOnly);

/** The homework item must belong to this child's own class. */
async function childAssignment(childId: number, assignmentId: number) {
  const a = (await query(`select a.id, a.title, a.max_marks, to_char(a.due_on,'YYYY-MM-DD') as due_str from assignments a join students s on s.section_id=a.section_id where a.id=$1 and s.id=$2`, [assignmentId, childId])).rows[0];
  if (!a) throw new HttpError(404, 'Not found');
  return a;
}
familyClasswork.get('/children/:id/homework/:aid/submission', asyncH(async (req, res) => {
  const id = await childOf(req); const a = await childAssignment(id, idp(req.params.aid));
  const x = (await query(`select status, body, file_name, (file_stored is not null) as has_file, marks::float as marks, feedback, to_char(submitted_at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') as submitted_at, ((submitted_at at time zone 'Asia/Kolkata')::date > $3::date) as late from assignment_submissions where assignment_id=$1 and student_id=$2`, [a.id, id, a.due_str])).rows[0] ?? null;
  res.json({ assignment: { id: a.id, title: a.title, dueOn: a.due_str, maxMarks: a.max_marks === null ? null : Number(a.max_marks) }, submission: x });
}));
familyClasswork.post('/children/:id/homework/:aid/submission', upload.single('file'), asyncH(async (req, res) => {
  const id = await childOf(req); const a = await childAssignment(id, idp(req.params.aid));
  const b = z.object({ body: z.string().trim().max(5000).optional() }).parse(req.body);
  if (!b.body && !req.file) throw new HttpError(400, 'Write your answer or attach a file.');
  const existing = (await query('select id, status, file_stored from assignment_submissions where assignment_id=$1 and student_id=$2', [a.id, id])).rows[0];
  if (existing?.status === 'graded') throw new HttpError(409, 'This homework has already been marked, so it can no longer be changed.');
  const f = await storeFile(req.file);
  await query(
    `insert into assignment_submissions (assignment_id, student_id, body, file_stored, file_name, submitted_by) values ($1,$2,$3,$4,$5,$6)
     on conflict (assignment_id, student_id) do update set body=excluded.body, file_stored=coalesce(excluded.file_stored, assignment_submissions.file_stored), file_name=coalesce(excluded.file_name, assignment_submissions.file_name),
       submitted_by=excluded.submitted_by, submitted_at=now(), status='submitted', marks=null, feedback=null, graded_at=null`,
    [a.id, id, b.body ?? null, f?.stored ?? null, f?.name ?? null, req.auth!.user.id]);
  if (existing?.file_stored && f) fs.promises.unlink(path.join(DIR, path.basename(existing.file_stored))).catch(() => undefined);
  const teacher = (await query('select t.user_id from assignments x join staff t on t.id=x.staff_id where x.id=$1', [a.id])).rows[0]?.user_id;
  if (teacher) await query('insert into notifications (user_id, title, body, link) values ($1,$2,$3,$4)', [teacher, 'Homework submitted', `${a.title}: a student handed in work.`, `/portal/homework/${a.id}`]);
  res.status(201).json({ ok: true });
}));
familyClasswork.get('/children/:id/homework/:aid/submission/file', asyncH(async (req, res) => {
  const id = await childOf(req); const a = await childAssignment(id, idp(req.params.aid));
  const x = (await query('select file_stored, file_name from assignment_submissions where assignment_id=$1 and student_id=$2', [a.id, id])).rows[0];
  if (!x?.file_stored) throw new HttpError(404, 'Not found');
  sendPrivate(res, x.file_stored, x.file_name ?? 'submission');
}));
familyClasswork.get('/children/:id/classwork', asyncH(async (req, res) => {
  const id = await childOf(req);
  res.json({
    plans: (await query(`select to_char(l.planned_on,'YYYY-MM-DD') as planned_on, l.topic, l.objectives, sub.name as subject from lesson_plans l join subjects sub on sub.id=l.subject_id join students s on s.section_id=l.section_id where s.id=$1 and l.planned_on between current_date - 1 and current_date + 14 and l.status <> 'skipped' order by l.planned_on, sub.name`, [id])).rows,
    materials: (await query(`select m.id, m.title, m.description, m.link_url, m.file_name, (m.file_stored is not null) as has_file, to_char(m.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD') as added, sub.name as subject from learning_materials m join subjects sub on sub.id=m.subject_id join students s on s.section_id=m.section_id where s.id=$1 order by m.created_at desc limit 60`, [id])).rows,
  });
}));
familyClasswork.get('/children/:id/materials/:mid/file', asyncH(async (req, res) => {
  const id = await childOf(req);
  const m = (await query('select m.file_stored, m.file_name from learning_materials m join students s on s.section_id=m.section_id where m.id=$1 and s.id=$2', [idp(req.params.mid), id])).rows[0];
  if (!m?.file_stored) throw new HttpError(404, 'Not found');
  sendPrivate(res, m.file_stored, m.file_name ?? 'material');
}));
