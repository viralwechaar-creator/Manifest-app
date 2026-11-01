import { NextFunction, Request, Response, Router } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { query } from '../../db';
import { audit } from '../../lib/audit';
import { generateTempPassword, hashPassword } from '../../lib/password';
import { requireAuth } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { buildReport, computeResults, gradeOf } from './exams';
import { buildReceipt, duesFor } from './fees';
import { eachDate, isoDow, today } from './helpers';

/** In-app notification to the parents and portal accounts of the students returned by `studentSql`. */
export async function notifyFamilies(studentSql: string, params: unknown[], title: string, body: string, link: string) {
  await query(
    `insert into notifications (user_id, title, body, link)
     select distinct uid, $${params.length + 1}, $${params.length + 2}, $${params.length + 3} from (
       select g.user_id as uid from student_guardians sg join guardians g on g.id=sg.guardian_id where sg.student_id in (${studentSql}) and g.user_id is not null
       union select s.user_id from students s where s.id in (${studentSql}) and s.user_id is not null) q where uid is not null`,
    [...params, title, body, link]);
}

// ---------- Account issuing (used from the staff side and, later, by the admission workflow) ----------
export async function issueParentAccount(c: PoolClient, studentId: number, guardianId?: number) {
  const g = (await c.query(
    `select g.id, g.user_id, g.full_name, g.email from student_guardians sg join guardians g on g.id=sg.guardian_id
      where sg.student_id=$1 and ($2::int is null or g.id=$2) order by sg.is_primary desc, g.id limit 1`, [studentId, guardianId ?? null])).rows[0];
  if (!g) throw new HttpError(400, 'This student has no guardian to create a login for.');
  const kids = (await c.query('select s.id, s.student_code from students s join student_guardians sg on sg.student_id=s.id where sg.guardian_id=$1 order by s.id', [g.id])).rows;
  const first = kids.find((k: any) => k.id === studentId) ?? kids[0];
  let userId = g.user_id as string | null; let temp: string | null = null; let loginId: string;
  if (!userId) {
    const taken = await c.query('select 1 from users where login_id=$1::citext union select 1 from login_aliases where login_id=$1::citext', [first.student_code]);
    if (taken.rowCount) throw new HttpError(409, 'That student ID is already used as a login by someone else.');
    temp = generateTempPassword();
    userId = (await c.query('insert into users (login_id, display_name, email, password_hash, must_change_password) values ($1::citext,$2,$3::citext,$4,true) returning id', [first.student_code, g.full_name, g.email, await hashPassword(temp)])).rows[0].id as string;
    await c.query("insert into user_roles select $1, id from roles where code='parent'", [userId]);
    await c.query('update guardians set user_id=$1 where id=$2', [userId, g.id]);
    loginId = first.student_code;
  } else loginId = (await c.query('select login_id from users where id=$1', [userId])).rows[0].login_id;
  // Every linked child's ID signs in to the same parent account.
  for (const k of kids) {
    if (k.student_code === loginId) continue;
    const clash = await c.query('select 1 from users where login_id=$1::citext', [k.student_code]);
    if (!clash.rowCount) await c.query('insert into login_aliases (login_id, user_id) values ($1::citext,$2) on conflict do nothing', [k.student_code, userId]);
  }
  return { loginId, temporaryPassword: temp, existingAccount: temp === null, guardian: g.full_name, signInWithIds: kids.map((k: any) => k.student_code) };
}

export async function issueStudentAccount(c: PoolClient, studentId: number) {
  const s = (await c.query('select id, student_code, full_name, user_id from students where id=$1', [studentId])).rows[0];
  if (!s) throw new HttpError(404, 'Student not found');
  if (s.user_id) throw new HttpError(409, 'This student already has a login.');
  const loginId = `${s.student_code}-S`; const temp = generateTempPassword();
  const u = await c.query('insert into users (login_id, display_name, password_hash, must_change_password) values ($1::citext,$2,$3,true) returning id', [loginId, s.full_name, await hashPassword(temp)]);
  await c.query("insert into user_roles select $1, id from roles where code='student'", [u.rows[0].id]);
  await c.query('update students set user_id=$1 where id=$2', [u.rows[0].id, studentId]);
  return { loginId, temporaryPassword: temp };
}

// ---------- The family portal API: parents and students only ----------
export const familyRouter = Router();

function familyOnly(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new HttpError(401, 'Please sign in.'));
  if (!req.auth.roles.some((r) => r === 'parent' || r === 'student')) return next(new HttpError(403, 'This area is for parents and students.'));
  if (req.auth.user.mustChangePassword) return next(new HttpError(403, 'You must change your password first.'));
  next();
}
familyRouter.use(requireAuth, familyOnly);

const isParent = (req: Request) => req.auth!.roles.includes('parent');
async function linkedIds(req: Request): Promise<number[]> {
  const uid = req.auth!.user.id;
  const rows = isParent(req)
    ? (await query('select distinct s.id from students s join student_guardians sg on sg.student_id=s.id join guardians g on g.id=sg.guardian_id where g.user_id=$1', [uid])).rows
    : (await query('select id from students where user_id=$1', [uid])).rows;
  return rows.map((r) => r.id);
}
/** The IDOR guard: every child-specific route goes through here. A child that is not yours is simply "not found". */
async function childOf(req: Request): Promise<number> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || !(await linkedIds(req)).includes(id)) throw new HttpError(404, 'Not found');
  return id;
}

familyRouter.get('/children', asyncH(async (req, res) => {
  const ids = await linkedIds(req);
  const rows = (await query(
    `select s.id, s.student_code, s.full_name, s.status, s.gender, c.name || ' ' || sec.name as section, sec.id as section_id
       from students s left join sections sec on sec.id=s.section_id left join classes c on c.id=sec.class_id where s.id = any($1::int[]) order by s.full_name`, [ids])).rows;
  res.json({ role: isParent(req) ? 'parent' : 'student', children: rows });
}));

familyRouter.get('/children/:id/overview', asyncH(async (req, res) => {
  const id = await childOf(req);
  const s = (await query(
    `select s.id, s.student_code, s.full_name, s.date_of_birth, s.status, s.admission_date, c.name || ' ' || sec.name as section, sec.id as section_id, t.full_name as class_teacher
       from students s left join sections sec on sec.id=s.section_id left join classes c on c.id=sec.class_id left join staff t on t.id=sec.class_teacher_id where s.id=$1`, [id])).rows[0];
  const todayStatus = (await query('select status from student_attendance where student_id=$1 and date=$2', [id, today()])).rows[0]?.status ?? null;
  const att = (await query(
    `select count(*) filter (where status in ('present','late'))::int p, count(*) filter (where status='absent')::int a, count(*) filter (where status='late')::int l, count(*)::int n
       from student_attendance where student_id=$1 and date > current_date - 30`, [id])).rows[0];
  const hw = (await query(`select count(*)::int n from assignments where section_id=$1 and due_on >= current_date`, [s.section_id])).rows[0].n;
  const lastExam = (await query(
    `select e.id, e.name from exams e where e.results_published and exists (select 1 from exam_subjects x where x.exam_id=e.id and x.class_id=(select class_id from sections where id=$1)) order by e.created_at desc limit 1`, [s.section_id])).rows[0] ?? null;
  const pending = (await query("select count(*)::int n from student_leave_requests where student_id=$1 and status='pending'", [id])).rows[0].n;
  res.json({ student: s, attendance: { today: todayStatus, last30: { present: att.p, absent: att.a, late: att.l, marked: att.n, percentage: att.n ? Math.round((1000 * att.p) / att.n) / 10 : null } }, homeworkDue: hw, latestResults: lastExam, pendingLeave: pending,
    fees: null, transport: null });
}));

familyRouter.get('/children/:id/attendance', asyncH(async (req, res) => {
  const id = await childOf(req);
  const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).default(today().slice(0, 7)).parse(req.query.month);
  const from = `${month}-01`; const to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).toISOString().slice(0, 10);
  const days = (await query("select to_char(date,'YYYY-MM-DD') as date, status from student_attendance where student_id=$1 and date between $2 and $3", [id, from, to])).rows;
  const marked = new Set(days.map((d) => d.date));
  const leave = (await query("select from_date, to_date from student_leave_requests where student_id=$1 and status='approved' and from_date <= $3 and to_date >= $2", [id, from, to])).rows;
  for (const l of leave) for (const d of eachDate(new Date(l.from_date).toISOString().slice(0, 10), new Date(l.to_date).toISOString().slice(0, 10))) if (d >= from && d <= to && !marked.has(d) && isoDow(d) !== 7) days.push({ date: d, status: 'excused' });
  const t = { present: 0, absent: 0, late: 0, excused: 0 } as Record<string, number>; for (const d of days) t[d.status]++;
  const ytd = (await query(`select count(*) filter (where status in ('present','late'))::int p, count(*)::int n from student_attendance a join sections s on s.id=a.section_id where a.student_id=$1 and s.academic_year_id=(select id from academic_years where is_current)`, [id])).rows[0];
  res.json({ month, days: days.sort((a, b) => a.date.localeCompare(b.date)), totals: t, year: { present: ytd.p, marked: ytd.n, percentage: ytd.n ? Math.round((1000 * ytd.p) / ytd.n) / 10 : null } });
}));

/** Published results only. Only the child's own rank is shown, never other students. */
async function publishedExamsFor(studentId: number) {
  const st = (await query('select s.section_id, sec.class_id from students s join sections sec on sec.id=s.section_id where s.id=$1', [studentId])).rows[0];
  if (!st) return { st: null, exams: [] };
  const exams = (await query(
    `select e.id, e.name, e.kind from exams e where e.results_published and exists (select 1 from exam_subjects x where x.exam_id=e.id and x.class_id=$1) order by e.created_at desc`, [st.class_id])).rows;
  return { st, exams };
}
familyRouter.get('/children/:id/results', asyncH(async (req, res) => {
  const id = await childOf(req); const { st, exams } = await publishedExamsFor(id);
  if (!st) return res.json([]);
  const out: any[] = [];
  for (const e of exams) {
    const r = (await computeResults(e.id, { sectionIds: [st.section_id] })).rows.find((x: any) => x.studentId === id);
    if (r) out.push({ examId: e.id, name: e.name, kind: e.kind, complete: r.complete, total: r.total, maxTotal: r.maxTotal, percentage: r.percentage, grade: r.grade, passed: r.passed, classRank: r.classRank, classSize: r.classSize, sectionRank: r.sectionRank, sectionSize: r.sectionSize });
  }
  res.json(out);
}));
familyRouter.get('/children/:id/report/:examId', asyncH(async (req, res) => {
  const id = await childOf(req); const { exams } = await publishedExamsFor(id);
  const examId = z.coerce.number().int().positive().parse(req.params.examId);
  if (!exams.some((e) => e.id === examId)) throw new HttpError(404, 'Not found'); // unpublished = not found
  const r = await buildReport(id, examId);
  await audit(req, 'report.viewed_by_family', 'student', id, { examId });
  res.json(r);
}));
familyRouter.get('/children/:id/performance', asyncH(async (req, res) => {
  const id = await childOf(req); const { st, exams } = await publishedExamsFor(id);
  if (!st) return res.json({ subjects: [], trend: [] });
  const per = new Map<string, { subject: string; pts: number[]; classPts: number[] }>(); const trend: any[] = [];
  for (const e of exams.reverse()) {
    const { rows, subjects } = await computeResults(e.id, { classId: st.class_id });
    const mine = rows.find((r: any) => r.studentId === id); if (!mine) continue;
    if (mine.complete) trend.push({ exam: e.name, percentage: mine.percentage });
    for (const sub of subjects.filter((x: any) => x.class_id === st.class_id)) {
      const m = mine.subjects.find((x: any) => x.examSubjectId === sub.id); if (!m || m.pending) continue;
      const rec: { subject: string; pts: number[]; classPts: number[] } = per.get(sub.name) ?? { subject: sub.name, pts: [], classPts: [] }; rec.pts.push(((m.absent ? 0 : m.marks ?? 0) / sub.max) * 100);
      const all = rows.map((r: any) => r.subjects.find((x: any) => x.examSubjectId === sub.id)).filter((x: any) => x && !x.pending);
      if (all.length) rec.classPts.push(all.reduce((a: number, x: any) => a + ((x.absent ? 0 : x.marks ?? 0) / sub.max) * 100, 0) / all.length);
      per.set(sub.name, rec);
    }
  }
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  res.json({ subjects: [...per.values()].map((p) => ({ subject: p.subject, averagePct: avg(p.pts), classAveragePct: avg(p.classPts), grade: p.pts.length ? gradeOf(avg(p.pts)!) : null })), trend });
}));

familyRouter.get('/children/:id/homework', asyncH(async (req, res) => {
  const id = await childOf(req);
  res.json((await query(
    `select a.id, a.kind, a.title, a.description, to_char(a.due_on,'YYYY-MM-DD') as due_on, a.max_marks::float as max_marks, sub.name as subject, st.full_name as teacher
       from assignments a join students s on s.section_id=a.section_id join subjects sub on sub.id=a.subject_id join staff st on st.id=a.staff_id
      where s.id=$1 and a.due_on >= current_date - 14 order by a.due_on, a.id`, [id])).rows);
}));
familyRouter.get('/children/:id/timetable', asyncH(async (req, res) => {
  const id = await childOf(req);
  res.json({ periods: (await query("select id, number, name, to_char(starts_at,'HH24:MI') as starts_at, to_char(ends_at,'HH24:MI') as ends_at, is_break from periods order by number")).rows,
    slots: (await query(`select ts.day, ts.period_id, sub.name as subject, st.full_name as teacher from timetable_slots ts join students s on s.section_id=ts.section_id join subjects sub on sub.id=ts.subject_id join staff st on st.id=ts.staff_id where s.id=$1`, [id])).rows });
}));
familyRouter.get('/children/:id/remarks', asyncH(async (req, res) => {
  const id = await childOf(req);
  res.json((await query(`select r.id, r.kind, r.text, r.created_at, st.full_name as teacher from student_remarks r join staff st on st.id=r.staff_id where r.student_id=$1 and r.visible_to_parent order by r.created_at desc limit 100`, [id])).rows);
}));

// Notices and the school calendar for everything this account is linked to.
familyRouter.get('/notices', asyncH(async (req, res) => {
  const ids = await linkedIds(req); const aud = isParent(req) ? 'parents' : 'students';
  res.json((await query(
    `select n.id, n.title, n.body, n.published_at, n.audience from notices n
      where (n.expires_on is null or n.expires_on >= current_date) and (n.audience='everyone' or n.audience=$1
        or (n.audience='section' and n.section_id in (select section_id from students where id = any($2::int[]))))
      order by n.published_at desc limit 50`, [aud, ids])).rows);
}));
familyRouter.get('/events', asyncH(async (_req, res) => {
  res.json((await query("select id, title, category, description, location, starts_at, ends_at from events where published and starts_at >= now() - interval '1 day' order by starts_at limit 30")).rows);
}));

// Leave applications: parents only (students are minors).
familyRouter.get('/children/:id/leave', asyncH(async (req, res) => {
  const id = await childOf(req);
  res.json((await query('select id, from_date, to_date, reason, status, decision_note, created_at from student_leave_requests where student_id=$1 order by created_at desc limit 50', [id])).rows);
}));
familyRouter.post('/children/:id/leave', asyncH(async (req, res) => {
  if (!isParent(req)) throw new HttpError(403, 'Only a parent can apply for leave.');
  const id = await childOf(req);
  const b = z.object({ fromDate: z.string().date(), toDate: z.string().date(), reason: z.string().trim().min(3, 'Please give a reason').max(300) }).parse(req.body);
  if (b.toDate < b.fromDate) throw new HttpError(400, 'The last day cannot be before the first day.', { toDate: 'Before first day' });
  if (b.fromDate < today()) throw new HttpError(400, 'Leave cannot start in the past. Please contact the school office.', { fromDate: 'In the past' });
  if ((await query("select 1 from student_leave_requests where student_id=$1 and status in ('pending','approved') and from_date <= $3 and to_date >= $2", [id, b.fromDate, b.toDate])).rowCount) throw new HttpError(409, 'Leave is already requested for some of those days.');
  const r = await query('insert into student_leave_requests (student_id, from_date, to_date, reason, applied_by) values ($1,$2,$3,$4,$5) returning id', [id, b.fromDate, b.toDate, b.reason, req.auth!.user.id]);
  await query(`insert into notifications (user_id, title, body, link) select t.user_id, 'Student leave request', s.full_name || ': ' || $2::text, '/portal/student-leave'
                 from students s join sections sec on sec.id=s.section_id join staff t on t.id=sec.class_teacher_id where s.id=$1 and t.user_id is not null`, [id, `${b.fromDate} to ${b.toDate}`]);
  await audit(req, 'student_leave.requested', 'student', id);
  res.status(201).json({ id: r.rows[0].id });
}));
familyRouter.post('/children/:id/leave/:leaveId/cancel', asyncH(async (req, res) => {
  if (!isParent(req)) throw new HttpError(403, 'Only a parent can cancel leave.');
  const id = await childOf(req);
  const r = await query("update student_leave_requests set status='cancelled' where id=$1 and student_id=$2 and status='pending'", [z.coerce.number().int().parse(req.params.leaveId), id]);
  if (!r.rowCount) throw new HttpError(404, 'No pending request found.');
  res.json({ ok: true });
}));

// ---------- Fees: dues, receipts and "I have paid" notifications ----------
familyRouter.get('/children/:id/fees', asyncH(async (req, res) => {
  const id = await childOf(req); const t = today();
  const dues = (await duesFor({ query: query as any }, id)).map((r: any) => ({ id: r.id, description: r.description, dueOn: r.due_str, amount: r.gross / 100, adjustments: (r.net - r.gross) / 100, net: r.net / 100, paid: r.paid / 100, balance: r.balance / 100, overdue: r.balance > 0 && r.due_str < t }));
  const payments = (await query("select id, receipt_no, amount::float as amount, mode, reference, to_char(paid_on,'YYYY-MM-DD') as paid_on from payments where student_id=$1 and status='valid' order by paid_on desc, id desc limit 100", [id])).rows;
  const claims = (await query("select id, amount::float as amount, mode, reference, to_char(paid_on,'YYYY-MM-DD') as paid_on, status, decision_note from payment_claims where student_id=$1 order by created_at desc limit 20", [id])).rows;
  const instructions = (await query("select value from site_settings where key='payment_instructions'")).rows[0]?.value ?? '';
  const balance = dues.reduce((a, d) => a + d.balance, 0);
  res.json({ dues, payments, claims, instructions, totals: { balance, overdue: dues.filter((d) => d.overdue).reduce((a, d) => a + d.balance, 0), paid: dues.reduce((a, d) => a + d.paid, 0), nextDue: dues.filter((d) => d.balance > 0).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0]?.dueOn ?? null } });
}));
familyRouter.get('/children/:id/receipts/:paymentId', asyncH(async (req, res) => {
  const id = await childOf(req); const pid = z.coerce.number().int().positive().parse(req.params.paymentId);
  if (!(await query("select 1 from payments where id=$1 and student_id=$2 and status='valid'", [pid, id])).rowCount) throw new HttpError(404, 'Not found'); // another family's receipt is simply not found
  res.json(await buildReceipt(pid));
}));
familyRouter.post('/children/:id/claims', asyncH(async (req, res) => {
  if (!isParent(req)) throw new HttpError(403, 'Only a parent can send payment details.');
  const id = await childOf(req);
  const b = z.object({ amount: z.number().positive().max(10_000_000).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most two decimal places'), mode: z.enum(['cash', 'cheque', 'upi', 'bank_transfer', 'card', 'online', 'other']), reference: z.string().trim().max(80).optional(), paidOn: z.string().date(), note: z.string().trim().max(200).optional() }).parse(req.body);
  if (b.paidOn > today()) throw new HttpError(400, 'The payment date cannot be in the future.', { paidOn: 'In the future' });
  if (['cheque', 'upi', 'bank_transfer', 'card', 'online'].includes(b.mode) && !b.reference) throw new HttpError(400, 'Please enter the transaction or reference number so the school can match it.', { reference: 'Required' });
  if ((await query("select count(*)::int n from payment_claims where student_id=$1 and status='pending'", [id])).rows[0].n >= 5) throw new HttpError(429, 'You already have several payments waiting for confirmation.');
  const r = await query('insert into payment_claims (student_id, amount, mode, reference, paid_on, note, submitted_by) values ($1,$2,$3,$4,$5,$6,$7) returning id', [id, b.amount, b.mode, b.reference ?? null, b.paidOn, b.note ?? null, req.auth!.user.id]);
  await query(`insert into notifications (user_id, title, body, link) select distinct u.id, 'Payment to confirm', $1, '/portal/finance/claims' from users u join user_roles ur on ur.user_id=u.id join role_permissions rp on rp.role_id=ur.role_id join permissions p on p.id=rp.permission_id where p.code='fees.collect' and u.status='active'`, [`₹${b.amount} via ${b.mode.replace('_', ' ')}`]);
  await audit(req, 'payment_claim.submitted', 'student', id, { amount: b.amount });
  res.status(201).json({ id: r.rows[0].id });
}));
