import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { eachDate, has, isAdmin, isClassTeacher, isoDow, myStaffId, requireStaffId, today } from './helpers';

export const opsRouter = Router();
const D = z.string().date();
const int = z.number().int().positive();
const idp = (v: string) => z.coerce.number().int().positive().parse(v);

async function notifyStaff(staffId: number, title: string, body: string, link: string) {
  await query('insert into notifications (user_id, title, body, link) select user_id, $2, $3, $4 from staff where id=$1 and user_id is not null', [staffId, title, body, link]);
}

// ================= Periods and timetable =================
opsRouter.get('/periods', requirePermission('timetable.view'), asyncH(async (_req, res) => {
  res.json((await query('select id, number, name, to_char(starts_at, \'HH24:MI\') as starts_at, to_char(ends_at, \'HH24:MI\') as ends_at, is_break from periods order by number')).rows);
}));
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
opsRouter.put('/periods', requirePermission('timetable.manage'), asyncH(async (req, res) => {
  const { periods } = z.object({ periods: z.array(z.object({ number: int, name: z.string().trim().min(1).max(30), startsAt: time, endsAt: time, isBreak: z.boolean() })).min(1).max(16) }).parse(req.body);
  for (const p of periods) if (p.endsAt <= p.startsAt) throw new HttpError(400, `${p.name}: end time must be after start time.`);
  const sorted = [...periods].sort((a, b) => a.number - b.number);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].startsAt < sorted[i - 1].endsAt) throw new HttpError(400, `${sorted[i].name} starts before ${sorted[i - 1].name} ends.`);
  await tx(async (c) => {
    const keep = periods.map((p) => p.number);
    try { await c.query('delete from periods where number <> all($1::int[])', [keep]); }
    catch (e: any) { if (e.code === '23503') throw new HttpError(409, 'A period you removed is still used in a timetable. Clear those timetable entries first.'); throw e; }
    for (const p of periods) await c.query(
      `insert into periods (number, name, starts_at, ends_at, is_break) values ($1,$2,$3,$4,$5)
       on conflict (number) do update set name=excluded.name, starts_at=excluded.starts_at, ends_at=excluded.ends_at, is_break=excluded.is_break`, [p.number, p.name, p.startsAt, p.endsAt, p.isBreak]);
  });
  await audit(req, 'periods.updated', 'periods');
  res.json({ ok: true });
}));

const SLOT_SQL = `select ts.id, ts.day, ts.period_id, p.number as period_number, ts.section_id, c.name || ' ' || sec.name as section, ts.subject_id, sub.name as subject, ts.staff_id, st.full_name as teacher
  from timetable_slots ts join periods p on p.id=ts.period_id join sections sec on sec.id=ts.section_id join classes c on c.id=sec.class_id
  join subjects sub on sub.id=ts.subject_id join staff st on st.id=ts.staff_id`;

opsRouter.get('/timetable', requirePermission('timetable.view'), asyncH(async (req, res) => {
  const sec = req.query.sectionId ? idp(String(req.query.sectionId)) : null; const st = req.query.staffId ? idp(String(req.query.staffId)) : null;
  if (!sec && !st) throw new HttpError(400, 'Choose a class section or a teacher.');
  res.json((await query(`${SLOT_SQL} where ($1::int is null or ts.section_id=$1) and ($2::int is null or ts.staff_id=$2) order by ts.day, p.number`, [sec, st])).rows);
}));

// The signed-in teacher's own week, plus any substitutions assigned to them from today.
opsRouter.get('/timetable/my', requirePermission('timetable.view'), asyncH(async (req, res) => {
  const sid = await myStaffId(req);
  if (!sid) return res.json({ staffId: null, slots: [], substitutions: [] });
  const slots = (await query(`${SLOT_SQL} where ts.staff_id=$1 order by ts.day, p.number`, [sid])).rows;
  const subs = (await query(
    `select sb.id, sb.date, p.number as period_number, p.name as period, c.name || ' ' || sec.name as section, sub.name as subject, orig.full_name as covering_for
       from substitutions sb join timetable_slots ts on ts.id=sb.slot_id join periods p on p.id=sb.period_id join sections sec on sec.id=ts.section_id
       join classes c on c.id=sec.class_id join subjects sub on sub.id=ts.subject_id join staff orig on orig.id=ts.staff_id
      where sb.substitute_staff_id=$1 and sb.date >= current_date order by sb.date, p.number`, [sid])).rows;
  res.json({ staffId: sid, slots, substitutions: subs });
}));

opsRouter.put('/timetable/slot', requirePermission('timetable.manage'), asyncH(async (req, res) => {
  const b = z.object({ sectionId: int, day: z.number().int().min(1).max(7), periodId: int, subjectId: int, staffId: int }).parse(req.body);
  await tx(async (c) => {
    const per = (await c.query('select is_break from periods where id=$1', [b.periodId])).rows[0];
    if (!per) throw new HttpError(400, 'Unknown period.');
    if (per.is_break) throw new HttpError(400, 'That period is a break.');
    const ok = await c.query('select 1 from sections s join class_subjects cs on cs.class_id=s.class_id where s.id=$1 and cs.subject_id=$2', [b.sectionId, b.subjectId]);
    if (!ok.rowCount) throw new HttpError(400, 'That subject is not taught in this class.');
    const t = (await c.query('select kind, status, full_name from staff where id=$1', [b.staffId])).rows[0];
    if (!t || t.kind !== 'teacher' || t.status === 'left') throw new HttpError(400, 'Choose an active teacher.');
    const assigned = await c.query('select 1 from teacher_assignments where staff_id=$1 and section_id=$2 and subject_id=$3', [b.staffId, b.sectionId, b.subjectId]);
    if (!assigned.rowCount) throw new HttpError(400, `${t.full_name} is not assigned to teach this subject in this class. Assign them on the staff page first.`);
    const clash = (await c.query(
      `select c.name || ' ' || sec.name as section from timetable_slots ts join sections sec on sec.id=ts.section_id join classes c on c.id=sec.class_id
        where ts.staff_id=$1 and ts.day=$2 and ts.period_id=$3 and not (ts.section_id=$4)`, [b.staffId, b.day, b.periodId, b.sectionId])).rows[0];
    if (clash) throw new HttpError(409, `${t.full_name} already teaches ${clash.section} in that period.`);
    await c.query(
      `insert into timetable_slots (section_id, day, period_id, subject_id, staff_id) values ($1,$2,$3,$4,$5)
       on conflict (section_id, day, period_id) do update set subject_id=excluded.subject_id, staff_id=excluded.staff_id`, [b.sectionId, b.day, b.periodId, b.subjectId, b.staffId]);
  });
  await audit(req, 'timetable.slot_set', 'section', b.sectionId, { day: b.day, periodId: b.periodId });
  res.json({ ok: true });
}));
opsRouter.delete('/timetable/slot/:id', requirePermission('timetable.manage'), asyncH(async (req, res) => {
  const r = await query('delete from timetable_slots where id=$1', [idp(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'timetable.slot_cleared', 'timetable_slot', req.params.id);
  res.json({ ok: true });
}));

// ================= Student attendance =================
const STATUS = ['present', 'absent', 'late', 'excused'] as const;
async function assertCanMark(req: any, sectionId: number) {
  if (!has(req, 'attendance.students.mark')) throw new HttpError(403, 'You do not have permission to mark attendance.');
  if (has(req, 'attendance.students.view_all')) return;
  const sid = await myStaffId(req);
  if (!sid || !(await isClassTeacher(sid, sectionId))) throw new HttpError(403, 'Only the class teacher can mark attendance for this class.');
}
opsRouter.get('/attendance/students', requirePermission('dashboard.view'), asyncH(async (req, res) => {
  const sectionId = idp(String(req.query.sectionId)); const date = D.parse(req.query.date ?? today());
  if (!has(req, 'attendance.students.view_all')) await assertCanMark(req, sectionId);
  if (date > today()) throw new HttpError(400, 'Attendance cannot be marked for a future date.');
  const sec = (await query('select c.name || \' \' || s.name as label from sections s join classes c on c.id=s.class_id where s.id=$1', [sectionId])).rows[0];
  if (!sec) throw new HttpError(404, 'Section not found');
  const rows = (await query(
    `select st.id, st.student_code, st.full_name, a.status from students st left join student_attendance a on a.student_id=st.id and a.date=$2
      where st.section_id=$1 and st.status='active' order by st.full_name`, [sectionId, date])).rows;
  res.json({ section: sec.label, date, canMark: has(req, 'attendance.students.mark'), rows });
}));
opsRouter.put('/attendance/students', requirePermission('dashboard.view'), asyncH(async (req, res) => {
  const b = z.object({ sectionId: int, date: D, records: z.array(z.object({ studentId: int, status: z.enum(STATUS) })).min(1).max(300) }).parse(req.body);
  await assertCanMark(req, b.sectionId);
  if (b.date > today()) throw new HttpError(400, 'Attendance cannot be marked for a future date.');
  if (isoDow(b.date) === 7) throw new HttpError(400, 'Sunday is not a school day.');
  await tx(async (c) => {
    const valid = new Set((await c.query("select id from students where section_id=$1 and status='active'", [b.sectionId])).rows.map((r) => r.id));
    for (const r of b.records) if (!valid.has(r.studentId)) throw new HttpError(400, 'One of the students is not in this class.');
    for (const r of b.records) await c.query(
      `insert into student_attendance (student_id, date, section_id, status, marked_by) values ($1,$2,$3,$4,$5)
       on conflict (student_id, date) do update set status=excluded.status, section_id=excluded.section_id, marked_by=excluded.marked_by, updated_at=now()`,
      [r.studentId, b.date, b.sectionId, r.status, req.auth!.user.id]);
  });
  await audit(req, 'attendance.students_marked', 'section', b.sectionId, { date: b.date, count: b.records.length });
  res.json({ saved: b.records.length });
}));
opsRouter.get('/attendance/summary', requirePermission('attendance.students.view_all'), asyncH(async (req, res) => {
  const from = D.parse(req.query.from ?? today().slice(0, 8) + '01'); const to = D.parse(req.query.to ?? today());
  res.json((await query(
    `select sec.id as section_id, c.name || ' ' || sec.name as section,
            count(*) filter (where a.status in ('present','late'))::int as present, count(*) filter (where a.status='absent')::int as absent,
            count(*) filter (where a.status='late')::int as late, count(a.*)::int as marked,
            round(100.0 * count(*) filter (where a.status in ('present','late')) / nullif(count(a.*),0), 1) as pct
       from sections sec join classes c on c.id=sec.class_id
       left join student_attendance a on a.section_id=sec.id and a.date between $1 and $2
      where sec.academic_year_id = (select id from academic_years where is_current) group by sec.id, c.name, c.level order by c.level, sec.name`, [from, to])).rows);
}));

// ================= Staff attendance =================
opsRouter.get('/attendance/staff', requirePermission('attendance.staff.view'), asyncH(async (req, res) => {
  const date = D.parse(req.query.date ?? today());
  res.json({ date, canMark: has(req, 'attendance.staff.manage'), rows: (await query(
    `select s.id, s.staff_code, s.full_name, s.kind, s.designation, a.status, a.note from staff s left join staff_attendance a on a.staff_id=s.id and a.date=$1
      where s.status <> 'left' order by s.kind, s.full_name`, [date])).rows });
}));
opsRouter.put('/attendance/staff', requirePermission('attendance.staff.manage'), asyncH(async (req, res) => {
  const b = z.object({ date: D, records: z.array(z.object({ staffId: int, status: z.enum(['present', 'absent', 'late', 'half_day', 'on_leave']), note: z.string().max(200).optional() })).min(1).max(500) }).parse(req.body);
  if (b.date > today()) throw new HttpError(400, 'Attendance cannot be marked for a future date.');
  await tx(async (c) => {
    for (const r of b.records) await c.query(
      `insert into staff_attendance (staff_id, date, status, note, marked_by) values ($1,$2,$3,$4,$5)
       on conflict (staff_id, date) do update set status=excluded.status, note=excluded.note, marked_by=excluded.marked_by, updated_at=now()`,
      [r.staffId, b.date, r.status, r.note ?? null, req.auth!.user.id]);
    // Drop substitutions that are no longer needed because the teacher turned up after all.
    await c.query(
      `delete from substitutions sb using timetable_slots ts where ts.id=sb.slot_id and sb.date=$1 and ts.staff_id = any($2::int[])
         and not exists (select 1 from staff_attendance a where a.staff_id=ts.staff_id and a.date=$1 and a.status in ('absent','on_leave'))`,
      [b.date, b.records.map((r) => r.staffId)]);
  });
  await audit(req, 'attendance.staff_marked', 'staff_attendance', undefined, { date: b.date, count: b.records.length });
  res.json({ saved: b.records.length });
}));

// ================= Leave =================
opsRouter.get('/leave', requirePermission('leave.apply'), asyncH(async (req, res) => {
  const approver = has(req, 'leave.approve'); const me = await myStaffId(req);
  const status = String(req.query.status ?? '');
  const scope = String(req.query.scope ?? (approver ? 'all' : 'mine'));
  const p: unknown[] = []; const where = ['true'];
  if (scope === 'all') { if (!approver) throw new HttpError(403, 'You cannot see other staff leave.'); } else { p.push(me ?? 0); where.push(`l.staff_id=$${p.length}`); }
  if (status) { p.push(status); where.push(`l.status=$${p.length}`); }
  res.json((await query(`select l.*, s.full_name, s.staff_code from leave_requests l join staff s on s.id=l.staff_id where ${where.join(' and ')} order by (l.status='pending') desc, l.created_at desc limit 200`, p)).rows);
}));
opsRouter.post('/leave', requirePermission('leave.apply'), asyncH(async (req, res) => {
  const b = z.object({ fromDate: D, toDate: D, reason: z.string().trim().min(3, 'Please give a reason').max(400) }).parse(req.body);
  const sid = await requireStaffId(req);
  if (b.toDate < b.fromDate) throw new HttpError(400, 'The last day must not be before the first day.', { toDate: 'Before first day' });
  if (b.fromDate < today()) throw new HttpError(400, 'Leave cannot start in the past. Ask HR to record it.', { fromDate: 'In the past' });
  const overlap = await query("select 1 from leave_requests where staff_id=$1 and status in ('pending','approved') and from_date <= $3 and to_date >= $2", [sid, b.fromDate, b.toDate]);
  if (overlap.rowCount) throw new HttpError(409, 'You already have leave requested for some of those days.');
  const r = await query('insert into leave_requests (staff_id, from_date, to_date, reason) values ($1,$2,$3,$4) returning id', [sid, b.fromDate, b.toDate, b.reason]);
  const who = (await query('select full_name from staff where id=$1', [sid])).rows[0].full_name;
  await query(`insert into notifications (user_id, title, body, link) select distinct u.id, 'Leave request', $1, '/portal/leave' from users u join user_roles ur on ur.user_id=u.id
     join role_permissions rp on rp.role_id=ur.role_id join permissions p on p.id=rp.permission_id where p.code='leave.approve' and u.status='active' and u.id <> $2`, [`${who}: ${b.fromDate} to ${b.toDate}`, req.auth!.user.id]);
  await audit(req, 'leave.requested', 'leave', r.rows[0].id);
  res.status(201).json({ id: r.rows[0].id });
}));
opsRouter.post('/leave/:id/cancel', requirePermission('leave.apply'), asyncH(async (req, res) => {
  const sid = await requireStaffId(req);
  const r = await query("update leave_requests set status='cancelled' where id=$1 and staff_id=$2 and status='pending'", [idp(req.params.id), sid]);
  if (!r.rowCount) throw new HttpError(404, 'No pending request found.');
  res.json({ ok: true });
}));
opsRouter.post('/leave/:id/decision', requirePermission('leave.approve'), asyncH(async (req, res) => {
  const b = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(300).optional() }).parse(req.body);
  const lid = idp(req.params.id); const me = await myStaffId(req);
  const out = await tx(async (c) => {
    const l = (await c.query('select * from leave_requests where id=$1 for update', [lid])).rows[0];
    if (!l) throw new HttpError(404, 'Not found');
    if (l.status !== 'pending') throw new HttpError(409, 'This request has already been decided.');
    if (me && l.staff_id === me) throw new HttpError(403, 'You cannot decide your own leave request.');
    await c.query('update leave_requests set status=$2, decided_by=$3, decided_at=now(), decision_note=$4 where id=$1', [lid, b.decision, req.auth!.user.id, b.note ?? null]);
    if (b.decision === 'approved') {
      const from = new Date(l.from_date).toISOString().slice(0, 10), to = new Date(l.to_date).toISOString().slice(0, 10);
      for (const d of eachDate(from, to)) if (isoDow(d) !== 7) await c.query(
        `insert into staff_attendance (staff_id, date, status, note, marked_by) values ($1,$2,'on_leave','Approved leave',$3)
         on conflict (staff_id, date) do update set status='on_leave', note='Approved leave', marked_by=excluded.marked_by, updated_at=now()`, [l.staff_id, d, req.auth!.user.id]);
    }
    return l;
  });
  await notifyStaff(out.staff_id, `Leave ${b.decision}`, b.note ?? '', '/portal/leave');
  await audit(req, `leave.${b.decision}`, 'leave', lid);
  res.json({ ok: true });
}));

// ================= Vacant periods and substitutions =================
const VAC_SQL = `select ts.id as slot_id, p.id as period_id, p.number as period_number, p.name as period, to_char(p.starts_at,'HH24:MI') as starts_at, to_char(p.ends_at,'HH24:MI') as ends_at,
    c.name || ' ' || sec.name as section, sub.id as subject_id, sub.name as subject, st.id as absent_staff_id, st.full_name as absent_teacher, a.status as absence,
    sb.id as substitution_id, sb.substitute_staff_id, ss.full_name as substitute
  from timetable_slots ts join periods p on p.id=ts.period_id join sections sec on sec.id=ts.section_id join classes c on c.id=sec.class_id
  join subjects sub on sub.id=ts.subject_id join staff st on st.id=ts.staff_id
  join staff_attendance a on a.staff_id=ts.staff_id and a.date=$1 and a.status in ('absent','on_leave')
  left join substitutions sb on sb.slot_id=ts.id and sb.date=$1 left join staff ss on ss.id=sb.substitute_staff_id
  where ts.day=$2 and sec.academic_year_id = (select id from academic_years where is_current)`;

opsRouter.get('/substitutions/vacancies', requirePermission('substitutions.manage'), asyncH(async (req, res) => {
  const date = D.parse(req.query.date ?? today());
  const rows = (await query(`${VAC_SQL} order by p.number, c.level, sec.name`, [date, isoDow(date)])).rows;
  res.json({ date, rows, open: rows.filter((r) => !r.substitution_id).length });
}));

async function candidates(date: string, slotId: number) {
  const slot = (await query(
    `select ts.id, ts.period_id, ts.subject_id, ts.staff_id, ts.day, st.department_id from timetable_slots ts join staff st on st.id=ts.staff_id where ts.id=$1`, [slotId])).rows[0];
  if (!slot) throw new HttpError(404, 'Timetable entry not found');
  if (slot.day !== isoDow(date)) throw new HttpError(400, 'That timetable entry is not on this weekday.');
  const rows = (await query(
    `select s.id, s.full_name, s.designation, d.name as department,
            exists (select 1 from teacher_assignments ta where ta.staff_id=s.id and ta.subject_id=$3) as teaches_subject,
            (s.department_id is not null and s.department_id = $4) as same_department,
            (select count(*)::int from substitutions x where x.substitute_staff_id=s.id and x.date=$1) as covering_today
       from staff s left join departments d on d.id=s.department_id
      where s.kind='teacher' and s.status='active' and s.id <> $5
        and not exists (select 1 from timetable_slots t where t.staff_id=s.id and t.day=$6 and t.period_id=$2)
        and not exists (select 1 from staff_attendance a where a.staff_id=s.id and a.date=$1 and a.status in ('absent','on_leave'))
        and not exists (select 1 from substitutions x where x.substitute_staff_id=s.id and x.date=$1 and x.period_id=$2)
      order by teaches_subject desc, same_department desc, covering_today, s.full_name`, [date, slot.period_id, slot.subject_id, slot.department_id, slot.staff_id, slot.day])).rows;
  return { slot, rows };
}
opsRouter.get('/substitutions/candidates', requirePermission('substitutions.manage'), asyncH(async (req, res) => {
  const { rows } = await candidates(D.parse(req.query.date), idp(String(req.query.slotId)));
  res.json(rows);
}));
opsRouter.post('/substitutions', requirePermission('substitutions.manage'), asyncH(async (req, res) => {
  const b = z.object({ date: D, slotId: int, staffId: int, reason: z.string().max(200).optional() }).parse(req.body);
  if (b.date < today()) throw new HttpError(400, 'Substitutions cannot be arranged for past dates.');
  const out = await tx(async (c) => {
    const { slot, rows } = await candidates(b.date, b.slotId);
    const vacant = (await c.query(`select 1 from staff_attendance where staff_id=$1 and date=$2 and status in ('absent','on_leave')`, [slot.staff_id, b.date])).rowCount;
    if (!vacant) throw new HttpError(400, 'This period is not vacant: the teacher is not marked absent or on leave.');
    if (!rows.some((r: any) => r.id === b.staffId)) throw new HttpError(409, 'That teacher is not free in this period.');
    try { await c.query('insert into substitutions (date, slot_id, period_id, substitute_staff_id, reason, assigned_by) values ($1,$2,$3,$4,$5,$6)', [b.date, b.slotId, slot.period_id, b.staffId, b.reason ?? null, req.auth!.user.id]); }
    catch (e: any) { if (e.code === '23505') throw new HttpError(409, 'A substitute is already assigned to this period.'); throw e; }
    return (await c.query(`select c.name || ' ' || sec.name as section, p.name as period from timetable_slots ts join sections sec on sec.id=ts.section_id join classes c on c.id=sec.class_id join periods p on p.id=ts.period_id where ts.id=$1`, [b.slotId])).rows[0];
  });
  await notifyStaff(b.staffId, 'Substitution assigned', `${out.section}, ${out.period} on ${b.date}`, '/portal/timetable');
  await audit(req, 'substitution.assigned', 'timetable_slot', b.slotId, { date: b.date, staffId: b.staffId });
  res.status(201).json({ ok: true });
}));
opsRouter.delete('/substitutions/:id', requirePermission('substitutions.manage'), asyncH(async (req, res) => {
  const r = await query('delete from substitutions where id=$1 and date >= current_date', [idp(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'Not found, or already in the past.');
  await audit(req, 'substitution.removed', 'substitution', req.params.id);
  res.json({ ok: true });
}));
void isAdmin;
