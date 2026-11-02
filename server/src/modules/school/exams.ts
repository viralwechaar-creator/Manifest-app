import { Request, Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { notifyFamilies } from './family';
import { has, isAdmin, isClassTeacher, myStaffId, requireStaffId, teachesSection } from './helpers';

export const examsRouter = Router();
const int = z.number().int().positive();
const idp = (v: string) => z.coerce.number().int().positive().parse(v);

export { gradeOf } from '../../lib/grading';
import { activeScale, gradeOf } from '../../lib/grading';
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Competition ranking: equal scores share a rank (1, 2, 2, 4). */
export function rankBy<T>(items: T[], score: (t: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => score(b) - score(a)); const out = new Map<T, number>();
  sorted.forEach((it, i) => out.set(it, i > 0 && score(it) === score(sorted[i - 1]) ? out.get(sorted[i - 1])! : i + 1));
  return out;
}

const anyExamAccess = requirePermission('dashboard.view');
const manage = requirePermission('exams.manage');

// ---------- Exams ----------
examsRouter.get('/exams', anyExamAccess, asyncH(async (req, res) => {
  if (!has(req, 'exams.manage') && !has(req, 'marks.enter') && !has(req, 'results.view_all')) throw new HttpError(403, 'You do not have permission to see exams.');
  res.json((await query(
    `select e.*, ay.label as year, (select count(*)::int from exam_subjects x where x.exam_id=e.id) as subject_count,
            (select count(*)::int from marks m join exam_subjects x on x.id=m.exam_subject_id where x.exam_id=e.id) as marks_entered
       from exams e join academic_years ay on ay.id=e.academic_year_id order by e.created_at desc`)).rows);
}));
const examBody = z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(['class_test', 'unit_test', 'midterm', 'final']), academicYearId: int, startsOn: z.string().date().nullable().optional() });
examsRouter.post('/exams', manage, asyncH(async (req, res) => {
  const b = examBody.parse(req.body);
  const r = await query('insert into exams (name, kind, academic_year_id, starts_on) values ($1,$2,$3,$4) returning id', [b.name, b.kind, b.academicYearId, b.startsOn ?? null]);
  await audit(req, 'exam.created', 'exam', r.rows[0].id);
  res.status(201).json({ id: r.rows[0].id });
}));
examsRouter.delete('/exams/:id', manage, asyncH(async (req, res) => {
  const id = idp(req.params.id);
  if ((await query('select 1 from marks m join exam_subjects x on x.id=m.exam_subject_id where x.exam_id=$1 limit 1', [id])).rowCount) throw new HttpError(409, 'Marks have already been entered for this exam, so it cannot be deleted.');
  const r = await query('delete from exams where id=$1', [id]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'exam.deleted', 'exam', id);
  res.json({ ok: true });
}));
examsRouter.post('/exams/:id/publish', manage, asyncH(async (req, res) => {
  const { published } = z.object({ published: z.boolean() }).parse(req.body); const id = idp(req.params.id);
  if (published) {
    const gaps = (await query(
      `select count(*)::int n from exam_subjects x join sections sec on sec.class_id=x.class_id and sec.academic_year_id=(select academic_year_id from exams where id=x.exam_id)
         join students s on s.section_id=sec.id and s.status='active'
        where x.exam_id=$1 and not exists (select 1 from marks m where m.exam_subject_id=x.id and m.student_id=s.id)`, [id])).rows[0].n;
    if (gaps > 0) throw new HttpError(409, `${gaps} mark${gaps === 1 ? ' is' : 's are'} still missing. Enter or mark absent for every student before publishing.`);
  }
  const r = await query('update exams set results_published=$2 where id=$1', [id, published]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  if (published) await notifyFamilies(
    `select s.id from students s join sections sec on sec.id=s.section_id where s.status='active' and sec.class_id in (select class_id from exam_subjects where exam_id=$1)`, [id],
    'Results published', 'New exam results are available.', '/family/results');
  await audit(req, published ? 'exam.published' : 'exam.unpublished', 'exam', id);
  res.json({ ok: true });
}));

examsRouter.get('/exams/:id/subjects', anyExamAccess, asyncH(async (req, res) => {
  res.json((await query(
    `select x.id, x.class_id, c.name as class_name, x.subject_id, s.name as subject, x.max_marks, x.pass_marks, to_char(x.exam_date,'YYYY-MM-DD') as exam_date,
            (select count(*)::int from marks m where m.exam_subject_id=x.id) as entered
       from exam_subjects x join classes c on c.id=x.class_id join subjects s on s.id=x.subject_id where x.exam_id=$1 order by c.level, s.name`, [idp(req.params.id)])).rows);
}));
examsRouter.post('/exams/:id/subjects', manage, asyncH(async (req, res) => {
  const b = z.object({ classId: int, subjectId: int, maxMarks: z.number().positive().max(1000), passMarks: z.number().min(0), examDate: z.string().date().nullable().optional() }).parse(req.body);
  if (b.passMarks > b.maxMarks) throw new HttpError(400, 'Pass marks cannot exceed maximum marks.', { passMarks: 'Too high' });
  if (!(await query('select 1 from class_subjects where class_id=$1 and subject_id=$2', [b.classId, b.subjectId])).rowCount) throw new HttpError(400, 'That subject is not taught in that class.');
  await query(
    `insert into exam_subjects (exam_id, class_id, subject_id, max_marks, pass_marks, exam_date) values ($1,$2,$3,$4,$5,$6)
     on conflict (exam_id, class_id, subject_id) do update set max_marks=excluded.max_marks, pass_marks=excluded.pass_marks, exam_date=excluded.exam_date`,
    [idp(req.params.id), b.classId, b.subjectId, b.maxMarks, b.passMarks, b.examDate ?? null]);
  await audit(req, 'exam.subject_set', 'exam', req.params.id);
  res.status(201).json({ ok: true });
}));
examsRouter.delete('/exam-subjects/:id', manage, asyncH(async (req, res) => {
  const id = idp(req.params.id);
  if ((await query('select 1 from marks where exam_subject_id=$1 limit 1', [id])).rowCount) throw new HttpError(409, 'Marks are already entered for this subject.');
  const r = await query('delete from exam_subjects where id=$1', [id]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));

// ---------- Marks entry ----------
async function assertCanEnter(req: Request, sectionId: number, subjectId: number) {
  if (!has(req, 'marks.enter')) throw new HttpError(403, 'You do not have permission to enter marks.');
  if (isAdmin(req)) return;
  const sid = await myStaffId(req);
  if (!sid || !(await teachesSection(sid, sectionId, subjectId))) throw new HttpError(403, 'You can enter marks only for the classes and subjects you teach.');
}
examsRouter.get('/marks', anyExamAccess, asyncH(async (req, res) => {
  const xs = idp(String(req.query.examSubjectId)); const sectionId = idp(String(req.query.sectionId));
  const x = (await query(`select x.*, e.results_published, e.name as exam, s.name as subject, sec.class_id as sec_class, c.name || ' ' || sec.name as section from exam_subjects x join exams e on e.id=x.exam_id join subjects s on s.id=x.subject_id, sections sec join classes c on c.id=sec.class_id where x.id=$1 and sec.id=$2`, [xs, sectionId])).rows[0];
  if (!x || x.sec_class !== x.class_id) throw new HttpError(404, 'Exam subject not found for that class.');
  await assertCanEnter(req, sectionId, x.subject_id);
  const rows = (await query(
    `select st.id, st.student_code, st.full_name, m.marks::float as marks, coalesce(m.absent,false) as absent, (m.student_id is not null) as entered
       from students st left join marks m on m.student_id=st.id and m.exam_subject_id=$1 where st.section_id=$2 and st.status='active' order by st.full_name`, [xs, sectionId])).rows;
  res.json({ exam: x.exam, subject: x.subject, section: x.section, maxMarks: +x.max_marks, passMarks: +x.pass_marks, locked: x.results_published && !isAdmin(req), rows });
}));
examsRouter.put('/marks', anyExamAccess, asyncH(async (req, res) => {
  const b = z.object({ examSubjectId: int, sectionId: int, records: z.array(z.object({ studentId: int, marks: z.number().min(0).nullable(), absent: z.boolean().optional() })).min(1).max(300) }).parse(req.body);
  const x = (await query('select x.*, e.results_published from exam_subjects x join exams e on e.id=x.exam_id where x.id=$1', [b.examSubjectId])).rows[0];
  if (!x) throw new HttpError(404, 'Exam subject not found');
  await assertCanEnter(req, b.sectionId, x.subject_id);
  if (x.results_published && !isAdmin(req)) throw new HttpError(409, 'Results are published, so marks are locked. Ask an administrator to change them.');
  const max = +x.max_marks; let n = 0;
  await tx(async (c) => {
    const valid = new Set((await c.query("select id from students where section_id=$1 and status='active' and (select class_id from sections where id=$1)=$2", [b.sectionId, x.class_id])).rows.map((r) => r.id));
    for (const r of b.records) {
      if (!valid.has(r.studentId)) throw new HttpError(400, 'One of the students is not in this class.');
      if (r.marks != null && r.marks > max) throw new HttpError(400, `Marks cannot be more than ${max}.`);
      if (r.absent) { await c.query(`insert into marks (exam_subject_id, student_id, marks, absent, entered_by) values ($1,$2,null,true,$3) on conflict (exam_subject_id, student_id) do update set marks=null, absent=true, entered_by=excluded.entered_by, updated_at=now()`, [x.id, r.studentId, req.auth!.user.id]); n++; }
      else if (r.marks == null) await c.query('delete from marks where exam_subject_id=$1 and student_id=$2', [x.id, r.studentId]); // cleared = not entered
      else { await c.query(`insert into marks (exam_subject_id, student_id, marks, absent, entered_by) values ($1,$2,$3,false,$4) on conflict (exam_subject_id, student_id) do update set marks=excluded.marks, absent=false, entered_by=excluded.entered_by, updated_at=now()`, [x.id, r.studentId, r.marks, req.auth!.user.id]); n++; }
    }
  });
  await audit(req, 'marks.entered', 'exam_subject', x.id, { section: b.sectionId, count: n, afterPublish: x.results_published });
  res.json({ saved: n });
}));

// ---------- Results and ranking ----------
interface Row { studentId: number; code: string; name: string; sectionId: number; section: string; classId: number; marks: Record<number, { marks: number | null; absent: boolean } | undefined> }
export async function computeResults(examId: number, scope: { sectionIds?: number[]; classId?: number }) {
  const exam = (await query('select e.*, ay.label as year from exams e join academic_years ay on ay.id=e.academic_year_id where e.id=$1', [examId])).rows[0];
  if (!exam) throw new HttpError(404, 'Exam not found');
  const subjects = (await query('select x.id, x.class_id, x.subject_id, s.name, x.max_marks::float as max, x.pass_marks::float as pass from exam_subjects x join subjects s on s.id=x.subject_id where x.exam_id=$1 order by s.name', [examId])).rows;
  const classIds = [...new Set(subjects.map((s) => s.class_id))];
  const students = (await query(
    `select st.id, st.student_code, st.full_name, st.section_id, c.name || ' ' || sec.name as section, sec.class_id from students st join sections sec on sec.id=st.section_id join classes c on c.id=sec.class_id
      where st.status='active' and sec.class_id = any($1::int[]) and sec.academic_year_id=$2 and ($3::int[] is null or sec.id = any($3)) and ($4::int is null or sec.class_id=$4) order by st.full_name`,
    [classIds, exam.academic_year_id, scope.sectionIds ?? null, scope.classId ?? null])).rows;
  const marks = (await query('select m.exam_subject_id, m.student_id, m.marks::float as marks, m.absent from marks m join exam_subjects x on x.id=m.exam_subject_id where x.exam_id=$1', [examId])).rows;
  const byStudent = new Map<number, Map<number, { marks: number | null; absent: boolean }>>();
  for (const m of marks) { if (!byStudent.has(m.student_id)) byStudent.set(m.student_id, new Map()); byStudent.get(m.student_id)!.set(m.exam_subject_id, { marks: m.marks, absent: m.absent }); }

  // Class-wide pool (all sections of the class) is needed for class rank, even when only one section is requested.
  const poolStudents = scope.sectionIds || scope.classId !== undefined ? (await query(
    `select st.id, sec.class_id, st.section_id from students st join sections sec on sec.id=st.section_id where st.status='active' and sec.class_id = any($1::int[]) and sec.academic_year_id=$2`, [classIds, exam.academic_year_id])).rows : students.map((s: any) => ({ id: s.id, class_id: s.class_id, section_id: s.section_id }));

  const calc = (st: { id: number; class_id: number }) => {
    const subs = subjects.filter((s) => s.class_id === st.class_id); const got = byStudent.get(st.id) ?? new Map();
    let total = 0, maxTotal = 0, pending = 0, failed: string[] = [];
    const per: any[] = subs.map((s) => {
      const m = got.get(s.id);
      if (!m) { pending++; return { examSubjectId: s.id, subjectId: s.subject_id, subject: s.name, max: s.max, pass: s.pass, marks: null, absent: false, pending: true }; }
      const v = m.absent ? 0 : (m.marks ?? 0); total += v; maxTotal += s.max;
      if (m.absent || v < s.pass) failed.push(s.name);
      return { examSubjectId: s.id, subjectId: s.subject_id, subject: s.name, max: s.max, pass: s.pass, marks: m.marks, absent: m.absent, pending: false, grade: gradeOf((v / s.max) * 100) };
    });
    const complete = subs.length > 0 && pending === 0;
    const pct = maxTotal ? r2((total / maxTotal) * 100) : 0;
    return { subjects: per, total: r2(total), maxTotal, percentage: pct, grade: complete ? gradeOf(pct) : null, complete, pending, passed: complete ? failed.length === 0 : null, failedSubjects: failed };
  };
  const pool = poolStudents.map((p: any) => ({ ...p, ...calc(p) }));
  const poolComplete = pool.filter((p: any) => p.complete);
  const classRank = new Map<number, Map<any, number>>(); const sectionRank = new Map<number, Map<any, number>>();
  for (const cid of classIds) classRank.set(cid, rankBy(poolComplete.filter((p: any) => p.class_id === cid), (p: any) => p.total));
  for (const sid of new Set(pool.map((p: any) => p.section_id))) sectionRank.set(sid as number, rankBy(poolComplete.filter((p: any) => p.section_id === sid), (p: any) => p.total));
  const poolById = new Map(pool.map((p: any) => [p.id, p]));
  // Per-subject rank within the class (used for class tests and subject-wise report cards).
  const subjRank = new Map<string, number>();
  for (const s of subjects) {
    const inClass = pool.filter((p: any) => p.class_id === s.class_id && (byStudent.get(p.id)?.get(s.id)));
    const rk = rankBy(inClass, (p: any) => { const m = byStudent.get(p.id)!.get(s.id)!; return m.absent ? -1 : (m.marks ?? 0); });
    for (const [p, r] of rk) subjRank.set(`${p.id}:${s.id}`, r);
  }
  const rows = students.map((st: any) => {
    const p: any = poolById.get(st.id);
    return { studentId: st.id, code: st.student_code, name: st.full_name, sectionId: st.section_id, section: st.section, classId: st.class_id,
      subjects: p.subjects.map((s: any) => ({ ...s, rank: subjRank.get(`${st.id}:${s.examSubjectId}`) ?? null })),
      total: p.total, maxTotal: p.maxTotal, percentage: p.percentage, grade: p.grade, complete: p.complete, pending: p.pending, passed: p.passed, failedSubjects: p.failedSubjects,
      sectionRank: p.complete ? sectionRank.get(st.section_id)!.get(p) ?? null : null, classRank: p.complete ? classRank.get(st.class_id)!.get(p) ?? null : null,
      classSize: poolComplete.filter((x: any) => x.class_id === st.class_id).length, sectionSize: poolComplete.filter((x: any) => x.section_id === st.section_id).length };
  });
  return { exam, subjects, rows };
}

/** Sections the requester may see results for. null = every section. */
async function visibleSections(req: Request): Promise<number[] | null> {
  if (has(req, 'results.view_all') || has(req, 'exams.manage')) return null;
  const sid = await myStaffId(req);
  if (!sid) return [];
  return (await query('select id from sections where class_teacher_id=$1 union select section_id from teacher_assignments where staff_id=$1', [sid])).rows.map((r) => r.id);
}
examsRouter.get('/exams/:id/results', anyExamAccess, asyncH(async (req, res) => {
  const vis = await visibleSections(req);
  const sectionId = req.query.sectionId ? idp(String(req.query.sectionId)) : null; const classId = req.query.classId ? idp(String(req.query.classId)) : undefined;
  let sectionIds: number[] | undefined;
  if (vis) { sectionIds = sectionId ? (vis.includes(sectionId) ? [sectionId] : []) : vis; if (!sectionIds.length) throw new HttpError(403, 'You can see results only for classes you teach.'); }
  else if (sectionId) sectionIds = [sectionId];
  const out = await computeResults(idp(req.params.id), { sectionIds, classId });
  const sortBy = String(req.query.sort ?? 'rank');
  out.rows.sort((a: any, b: any) => sortBy === 'name' ? a.name.localeCompare(b.name) : a.classId - b.classId || (a.classRank ?? 1e9) - (b.classRank ?? 1e9) || a.name.localeCompare(b.name));
  res.json(out);
}));

/** Everything on one report card. Callers must have checked that the requester may see this student. */
export async function buildReport(studentId: number, examId: number) {
  const st = (await query(`select st.id, st.student_code, st.full_name, st.date_of_birth, st.section_id, c.name || ' ' || sec.name as section, sec.class_id, sec.academic_year_id from students st join sections sec on sec.id=st.section_id join classes c on c.id=sec.class_id where st.id=$1`, [studentId])).rows[0];
  if (!st) throw new HttpError(404, 'Student not found');
  const { exam, rows } = await computeResults(examId, { sectionIds: [st.section_id] });
  const row = rows.find((r: any) => r.studentId === studentId);
  if (!row) throw new HttpError(404, 'No results for this student in that exam.');
  const att = (await query(
    `select count(*) filter (where status in ('present','late'))::int as present, count(*)::int as marked from student_attendance a join sections s on s.id=a.section_id where a.student_id=$1 and s.academic_year_id=$2`, [studentId, st.academic_year_id])).rows[0];
  const remark = (await query('select remark from report_remarks where exam_id=$1 and student_id=$2', [examId, studentId])).rows[0]?.remark ?? null;
  const school = (await query("select value from site_settings where key='school_name'")).rows[0]?.value ?? '';
  return { school, exam: { id: exam.id, name: exam.name, kind: exam.kind, year: exam.year, published: exam.results_published }, student: { code: st.student_code, name: st.full_name, section: st.section, dob: st.date_of_birth }, result: row,
    attendance: { present: att.present, marked: att.marked, percentage: att.marked ? r2((att.present / att.marked) * 100) : null }, remark, gradeScale: activeScale().bands, board: (await query("select value from site_settings where key='board'")).rows[0]?.value || null };
}
examsRouter.get('/report/:studentId', anyExamAccess, asyncH(async (req, res) => {
  const studentId = idp(req.params.studentId); const examId = idp(String(req.query.examId));
  const st = (await query('select section_id from students where id=$1', [studentId])).rows[0];
  if (!st) throw new HttpError(404, 'Student not found');
  const vis = await visibleSections(req);
  if (vis && !vis.includes(st.section_id)) throw new HttpError(404, 'Student not found');
  const out = await buildReport(studentId, examId);
  await audit(req, 'report.viewed', 'student', studentId, { examId });
  res.json(out);
}));
examsRouter.put('/report/:studentId/remark', anyExamAccess, asyncH(async (req, res) => {
  const studentId = idp(req.params.studentId); const b = z.object({ examId: int, remark: z.string().trim().min(1).max(500) }).parse(req.body);
  const st = (await query('select section_id from students where id=$1', [studentId])).rows[0];
  if (!st) throw new HttpError(404, 'Student not found');
  const sid = await myStaffId(req);
  if (!isAdmin(req) && !(sid && (await isClassTeacher(sid, st.section_id)))) throw new HttpError(403, 'Only the class teacher can write the report remark.');
  await query(`insert into report_remarks (exam_id, student_id, remark, entered_by) values ($1,$2,$3,$4) on conflict (exam_id, student_id) do update set remark=excluded.remark, entered_by=excluded.entered_by`, [b.examId, studentId, b.remark, req.auth!.user.id]);
  await audit(req, 'report.remark_set', 'student', studentId);
  res.json({ ok: true });
}));

// ---------- Analytics ----------
examsRouter.get('/analytics/exam/:id', requirePermission('results.view_all'), asyncH(async (req, res) => {
  const { subjects, rows } = await computeResults(idp(req.params.id), {});
  const classes = (await query('select id, name from classes')).rows; const nameOf = new Map(classes.map((c) => [c.id, c.name]));
  const out = subjects.map((s: any) => {
    const vals = rows.filter((r: any) => r.classId === s.class_id).map((r: any) => r.subjects.find((x: any) => x.examSubjectId === s.id)).filter((x: any) => x && !x.pending);
    const pts = vals.map((v: any) => (v.absent ? 0 : v.marks ?? 0));
    return { class: nameOf.get(s.class_id), subject: s.name, entries: vals.length, averagePct: pts.length ? r2((pts.reduce((a: number, b: number) => a + b, 0) / pts.length / s.max) * 100) : null,
      passRate: vals.length ? r2((vals.filter((v: any) => !v.absent && (v.marks ?? 0) >= s.pass).length / vals.length) * 100) : null, highest: pts.length ? Math.max(...pts) : null, lowest: pts.length ? Math.min(...pts) : null, max: s.max };
  });
  res.json({ subjects: out, toppers: rows.filter((r: any) => r.classRank === 1).map((r: any) => ({ name: r.name, section: r.section, percentage: r.percentage })) });
}));

// ---------- Homework and assignments ----------
examsRouter.get('/homework', requirePermission('homework.manage'), asyncH(async (req, res) => {
  const p: unknown[] = []; const where = ['true'];
  if (!isAdmin(req)) { const sid = await myStaffId(req); p.push(sid ?? 0); where.push(`(a.staff_id=$${p.length} or a.section_id in (select id from sections where class_teacher_id=$${p.length}))`); }
  if (req.query.sectionId) { p.push(idp(String(req.query.sectionId))); where.push(`a.section_id=$${p.length}`); }
  res.json((await query(
    `select a.id, a.kind, a.title, a.description, to_char(a.due_on,'YYYY-MM-DD') as due_on, a.max_marks::float as max_marks, c.name || ' ' || sec.name as section, a.section_id, sub.name as subject, st.full_name as teacher
       from assignments a join sections sec on sec.id=a.section_id join classes c on c.id=sec.class_id join subjects sub on sub.id=a.subject_id join staff st on st.id=a.staff_id
      where ${where.join(' and ')} order by a.due_on desc, a.id desc limit 200`, p)).rows);
}));
examsRouter.post('/homework', requirePermission('homework.manage'), asyncH(async (req, res) => {
  const b = z.object({ sectionId: int, subjectId: int, kind: z.enum(['homework', 'assignment']), title: z.string().trim().min(1).max(120), description: z.string().max(2000).optional(), dueOn: z.string().date(), maxMarks: z.number().positive().max(1000).nullable().optional() }).parse(req.body);
  const sid = await requireStaffId(req);
  if (!isAdmin(req) && !(await teachesSection(sid, b.sectionId, b.subjectId))) throw new HttpError(403, 'You can set work only for the classes and subjects you teach.');
  if (!(await query('select 1 from sections s join class_subjects cs on cs.class_id=s.class_id where s.id=$1 and cs.subject_id=$2', [b.sectionId, b.subjectId])).rowCount) throw new HttpError(400, 'That subject is not taught in this class.');
  if (b.dueOn < new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'The due date cannot be in the past.', { dueOn: 'In the past' });
  const r = await query('insert into assignments (section_id, subject_id, staff_id, kind, title, description, due_on, max_marks) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id', [b.sectionId, b.subjectId, sid, b.kind, b.title, b.description ?? null, b.dueOn, b.maxMarks ?? null]);
  await notifyFamilies("select id from students where status='active' and section_id=$1", [b.sectionId], `New ${b.kind}`, `${b.title}, due ${b.dueOn}`, '/family/homework');
  await audit(req, 'homework.created', 'assignment', r.rows[0].id);
  res.status(201).json({ id: r.rows[0].id });
}));
examsRouter.delete('/homework/:id', requirePermission('homework.manage'), asyncH(async (req, res) => {
  const id = idp(req.params.id); const sid = await myStaffId(req);
  const r = await query('delete from assignments where id=$1 and ($2::boolean or staff_id=$3)', [id, isAdmin(req), sid ?? 0]);
  if (!r.rowCount) throw new HttpError(404, 'Not found, or it belongs to another teacher.');
  await audit(req, 'homework.deleted', 'assignment', id);
  res.json({ ok: true });
}));
