import { Request, Router } from 'express';
import { z } from 'zod';
import { query } from '../../db';
import { audit } from '../../lib/audit';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { childOf, familyOnly, notifyFamilies } from './family';
import { has } from './helpers';
import { assertStudentInScope } from './students';

const idp = (v: string) => z.coerce.number().int().positive().parse(v);
const KINDS = ['sport', 'arts', 'club', 'academic', 'community', 'competition', 'leadership', 'other'] as const;
const LEVELS = ['class', 'school', 'inter_school', 'district', 'state', 'national', 'international'] as const;
const CATS = ['learning', 'social', 'skills', 'interests', 'wellbeing', 'support'] as const;

// ======================================= Staff side =======================================
export const growthRouter = Router();
const manage = requirePermission('growth.manage');

growthRouter.get('/students/:id/growth', manage, asyncH(async (req, res) => {
  const id = idp(req.params.id); await assertStudentInScope(req, id);
  res.json({
    activities: (await query("select a.id, a.kind, a.title, a.level, to_char(a.occurred_on,'YYYY-MM-DD') as occurred_on, a.result, a.description, a.visible_to_family, u.display_name as recorded_by from student_activities a left join users u on u.id=a.recorded_by where a.student_id=$1 order by a.occurred_on desc, a.id desc", [id])).rows,
    observations: (await query("select o.id, o.category, o.note, o.shared_with_family, o.needs_support, to_char(o.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD') as date, u.display_name as author, (o.author_id = $2) as mine from student_observations o left join users u on u.id=o.author_id where o.student_id=$1 order by o.created_at desc", [id, req.auth!.user.id])).rows,
  });
}));
const activityBody = z.object({ kind: z.enum(KINDS), title: z.string().trim().min(1).max(160), level: z.enum(LEVELS).default('school'), occurredOn: z.string().date(), result: z.string().trim().max(160).optional(), description: z.string().trim().max(800).optional(), visibleToFamily: z.boolean().default(true) });
growthRouter.post('/students/:id/activities', manage, asyncH(async (req, res) => {
  const id = idp(req.params.id); await assertStudentInScope(req, id); const b = activityBody.parse(req.body);
  if (b.occurredOn > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'The date cannot be in the future.');
  const r = await query('insert into student_activities (student_id, kind, title, level, occurred_on, result, description, visible_to_family, recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id', [id, b.kind, b.title, b.level, b.occurredOn, b.result ?? null, b.description ?? null, b.visibleToFamily, req.auth!.user.id]);
  if (b.visibleToFamily) await notifyFamilies('select id from students where id=$1', [id], 'New achievement recorded', b.result ? `${b.title}: ${b.result}` : b.title, '/family/growth', 'general');
  res.status(201).json({ id: r.rows[0].id });
}));
growthRouter.delete('/activities/:id', manage, asyncH(async (req, res) => {
  const own = has(req, 'academics.manage');
  if (!(await query('delete from student_activities where id=$1 and ($2::boolean or recorded_by=$3)', [idp(req.params.id), own, req.auth!.user.id])).rowCount) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));
const obsBody = z.object({ category: z.enum(CATS), note: z.string().trim().min(1).max(1500), sharedWithFamily: z.boolean().default(false), needsSupport: z.boolean().default(false) });
growthRouter.post('/students/:id/observations', manage, asyncH(async (req, res) => {
  const id = idp(req.params.id); await assertStudentInScope(req, id); const b = obsBody.parse(req.body);
  const r = await query('insert into student_observations (student_id, category, note, shared_with_family, needs_support, author_id) values ($1,$2,$3,$4,$5,$6) returning id', [id, b.category, b.note, b.sharedWithFamily, b.needsSupport, req.auth!.user.id]);
  await audit(req, 'student.observation_added', 'student', id, { category: b.category, shared: b.sharedWithFamily });
  res.status(201).json({ id: r.rows[0].id });
}));
growthRouter.delete('/observations/:id', manage, asyncH(async (req, res) => {
  const own = has(req, 'academics.manage');
  if (!(await query('delete from student_observations where id=$1 and ($2::boolean or author_id=$3)', [idp(req.params.id), own, req.auth!.user.id])).rowCount) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));

/**
 * Students who may need extra support, with the reasons, so teachers can act early. Only students in the teacher's own classes.
 * Signals: a teacher flagged them, attendance under 75% in the last 30 days, or a latest exam percentage under 40.
 */
growthRouter.get('/support-list', manage, asyncH(async (req, res) => {
  const all = req.auth!.permissions.includes('students.view_all');
  const rows = (await query(
    `with mine as (
       select s.id, s.full_name, s.student_code, c.name || ' ' || sec.name as section from students s join sections sec on sec.id=s.section_id join classes c on c.id=sec.class_id
        where s.status='active' and ($1::boolean or s.section_id in (
          select sec2.id from sections sec2 join staff st on st.user_id=$2::uuid where sec2.class_teacher_id=st.id union select ta.section_id from teacher_assignments ta join staff st on st.user_id=$2::uuid where ta.staff_id=st.id))),
     att as (select student_id, count(*) filter (where status in ('present','late'))::float / nullif(count(*),0) as rate, count(*) as days from student_attendance where date >= current_date - 30 group by 1),
     flagged as (select distinct student_id from student_observations where needs_support and created_at >= now() - interval '90 days'),
     exam as (select distinct on (m.student_id) m.student_id, sum(m.marks) / nullif(sum(x.max_marks),0) * 100 as pct
                from marks m join exam_subjects x on x.id=m.exam_subject_id join exams e on e.id=x.exam_id where e.results_published and m.marks is not null group by m.student_id, e.id, e.created_at order by m.student_id, e.created_at desc)
     select mine.*, (flagged.student_id is not null) as flagged, round((att.rate*100)::numeric) as attendance_pct, att.days, round(exam.pct::numeric) as latest_exam_pct
       from mine left join att on att.student_id=mine.id left join flagged on flagged.student_id=mine.id left join exam on exam.student_id=mine.id
      where flagged.student_id is not null or (att.days >= 10 and att.rate < 0.75) or exam.pct < 40 order by mine.section, mine.full_name limit 200`, [all, req.auth!.user.id])).rows;
  res.json(rows.map((r) => ({ ...r, reasons: [r.flagged && 'Flagged by a teacher', r.attendance_pct !== null && r.days >= 10 && Number(r.attendance_pct) < 75 && `Attendance ${r.attendance_pct}% in the last 30 days`, r.latest_exam_pct !== null && Number(r.latest_exam_pct) < 40 && `Latest exam ${r.latest_exam_pct}%`].filter(Boolean) })));
}));

// ======================================= Family side =======================================
export const familyGrowth = Router();
familyGrowth.use(requireAuth, familyOnly);
/** Families see only what the school chose to share: activities marked visible and observations explicitly shared. */
familyGrowth.get('/children/:id/growth', asyncH(async (req: Request, res) => {
  const id = await childOf(req);
  res.json({
    activities: (await query("select id, kind, title, level, to_char(occurred_on,'YYYY-MM-DD') as occurred_on, result, description from student_activities where student_id=$1 and visible_to_family order by occurred_on desc, id desc", [id])).rows,
    notes: (await query("select o.id, o.category, o.note, to_char(o.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD') as date, u.display_name as author from student_observations o left join users u on u.id=o.author_id where o.student_id=$1 and o.shared_with_family order by o.created_at desc", [id])).rows,
  });
}));
