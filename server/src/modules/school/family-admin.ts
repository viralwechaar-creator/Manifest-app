import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { issueParentAccount, issueStudentAccount, notifyFamilies } from './family';
import { eachDate, has, isAdmin, isClassTeacher, isoDow, myStaffId, requireStaffId, teachesSection, today } from './helpers';

export const familyAdminRouter = Router();
const idp = (v: string) => z.coerce.number().int().positive().parse(v);

// ---------- Logins for parents and students ----------
familyAdminRouter.post('/students/:id/parent-login', requirePermission('family_accounts.manage'), asyncH(async (req, res) => {
  const b = z.object({ guardianId: z.number().int().positive().optional() }).parse(req.body ?? {});
  const out = await tx((c) => issueParentAccount(c, idp(req.params.id), b.guardianId));
  await audit(req, 'family.parent_login_issued', 'student', req.params.id, { newAccount: !out.existingAccount });
  res.status(201).json(out);
}));
familyAdminRouter.post('/students/:id/student-login', requirePermission('family_accounts.manage'), asyncH(async (req, res) => {
  const out = await tx((c) => issueStudentAccount(c, idp(req.params.id)));
  await audit(req, 'family.student_login_issued', 'student', req.params.id);
  res.status(201).json(out);
}));
familyAdminRouter.get('/students/:id/accounts', requirePermission('family_accounts.manage'), asyncH(async (req, res) => {
  const id = idp(req.params.id);
  res.json({
    guardians: (await query(`select g.id, g.full_name, sg.relation, sg.is_primary, u.login_id, u.status, u.last_login_at from student_guardians sg join guardians g on g.id=sg.guardian_id left join users u on u.id=g.user_id where sg.student_id=$1 order by sg.is_primary desc`, [id])).rows,
    student: (await query('select u.login_id, u.status, u.last_login_at from students s join users u on u.id=s.user_id where s.id=$1', [id])).rows[0] ?? null,
  });
}));

// ---------- Notices ----------
const notice = z.object({
  title: z.string().trim().min(1).max(140), body: z.string().trim().min(1).max(4000),
  audience: z.enum(['everyone', 'parents', 'students', 'staff', 'section']), sectionId: z.number().int().positive().nullable().optional(), expiresOn: z.string().date().nullable().optional(),
});
familyAdminRouter.get('/notices', requirePermission('notices.manage'), asyncH(async (_req, res) => {
  res.json((await query(`select n.*, c.name || ' ' || sec.name as section, u.display_name as author from notices n left join sections sec on sec.id=n.section_id left join classes c on c.id=sec.class_id left join users u on u.id=n.created_by order by n.published_at desc limit 100`)).rows);
}));
familyAdminRouter.post('/notices', requirePermission('notices.manage'), asyncH(async (req, res) => {
  const b = notice.parse(req.body);
  if (b.audience === 'section' && !b.sectionId) throw new HttpError(400, 'Choose a class section.', { sectionId: 'Required' });
  const r = await query('insert into notices (title, body, audience, section_id, expires_on, created_by) values ($1,$2,$3,$4,$5,$6) returning id',
    [b.title, b.body, b.audience, b.audience === 'section' ? b.sectionId : null, b.expiresOn ?? null, req.auth!.user.id]);
  const link = '/family/notices';
  if (b.audience === 'everyone' || b.audience === 'parents') await notifyFamilies("select s.id from students s join student_guardians sg on sg.student_id=s.id where s.status='active'", [], b.title, b.body.slice(0, 120), link);
  if (b.audience === 'everyone' || b.audience === 'students') await notifyFamilies("select id from students where status='active' and user_id is not null", [], b.title, b.body.slice(0, 120), link);
  if (b.audience === 'section') await notifyFamilies("select id from students where status='active' and section_id=$1", [b.sectionId], b.title, b.body.slice(0, 120), link);
  if (b.audience === 'everyone' || b.audience === 'staff') await query(`insert into notifications (user_id, title, body, link) select u.id, $1, $2, '/portal' from users u join staff s on s.user_id=u.id where s.status <> 'left' and u.status='active'`, [b.title, b.body.slice(0, 120)]);
  await audit(req, 'notice.published', 'notice', r.rows[0].id, { audience: b.audience });
  res.status(201).json({ id: r.rows[0].id });
}));
familyAdminRouter.delete('/notices/:id', requirePermission('notices.manage'), asyncH(async (req, res) => {
  const r = await query('delete from notices where id=$1', [idp(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'notice.deleted', 'notice', req.params.id);
  res.json({ ok: true });
}));

// ---------- Remarks about students ----------
async function canRemark(req: any, studentId: number) {
  const st = (await query('select section_id from students where id=$1', [studentId])).rows[0];
  if (!st) throw new HttpError(404, 'Student not found');
  if (isAdmin(req) || has(req, 'students.view_all')) return st;
  const sid = await myStaffId(req);
  if (!sid || !st.section_id || !(await teachesSection(sid, st.section_id))) throw new HttpError(404, 'Student not found');
  return st;
}
familyAdminRouter.get('/students/:id/remarks', requirePermission('students.view'), asyncH(async (req, res) => {
  const id = idp(req.params.id); await canRemark(req, id);
  res.json((await query('select r.id, r.kind, r.text, r.visible_to_parent, r.created_at, st.full_name as teacher from student_remarks r join staff st on st.id=r.staff_id where r.student_id=$1 order by r.created_at desc limit 100', [id])).rows);
}));
familyAdminRouter.post('/students/:id/remarks', requirePermission('remarks.write'), asyncH(async (req, res) => {
  const id = idp(req.params.id); await canRemark(req, id);
  const b = z.object({ kind: z.enum(['praise', 'concern', 'note']), text: z.string().trim().min(3, 'Please write a remark').max(600), visibleToParent: z.boolean() }).parse(req.body);
  const sid = await requireStaffId(req);
  const r = await query('insert into student_remarks (student_id, staff_id, kind, text, visible_to_parent) values ($1,$2,$3,$4,$5) returning id', [id, sid, b.kind, b.text, b.visibleToParent]);
  if (b.visibleToParent) await notifyFamilies('select id from students where id=$1', [id], 'New remark from a teacher', b.text.slice(0, 100), '/family/remarks');
  await audit(req, 'remark.added', 'student', id);
  res.status(201).json({ id: r.rows[0].id });
}));
familyAdminRouter.delete('/remarks/:id', requirePermission('remarks.write'), asyncH(async (req, res) => {
  const sid = await myStaffId(req);
  const r = await query('delete from student_remarks where id=$1 and ($2::boolean or staff_id=$3)', [idp(req.params.id), isAdmin(req), sid ?? 0]);
  if (!r.rowCount) throw new HttpError(404, 'Not found, or written by another teacher.');
  res.json({ ok: true });
}));

// ---------- Student leave decisions (class teacher or admin) ----------
familyAdminRouter.get('/student-leave', requirePermission('student_leave.decide'), asyncH(async (req, res) => {
  const p: unknown[] = []; const where = ['true'];
  if (!isAdmin(req) && !has(req, 'students.view_all')) { p.push((await myStaffId(req)) ?? 0); where.push(`sec.class_teacher_id=$${p.length}`); }
  if (req.query.status) { p.push(String(req.query.status)); where.push(`l.status=$${p.length}`); }
  res.json((await query(
    `select l.id, l.from_date, l.to_date, l.reason, l.status, l.decision_note, l.created_at, s.full_name, s.student_code, c.name || ' ' || sec.name as section
       from student_leave_requests l join students s on s.id=l.student_id join sections sec on sec.id=s.section_id join classes c on c.id=sec.class_id
      where ${where.join(' and ')} order by (l.status='pending') desc, l.created_at desc limit 200`, p)).rows);
}));
familyAdminRouter.post('/student-leave/:id/decision', requirePermission('student_leave.decide'), asyncH(async (req, res) => {
  const b = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(300).optional() }).parse(req.body);
  const lid = idp(req.params.id);
  const l = await tx(async (c) => {
    const row = (await c.query('select l.*, s.section_id from student_leave_requests l join students s on s.id=l.student_id where l.id=$1 for update of l', [lid])).rows[0];
    if (!row) throw new HttpError(404, 'Not found');
    if (row.status !== 'pending') throw new HttpError(409, 'This request has already been decided.');
    if (!isAdmin(req) && !has(req, 'students.view_all')) {
      const sid = await myStaffId(req);
      if (!sid || !(await isClassTeacher(sid, row.section_id))) throw new HttpError(404, 'Not found');
    }
    await c.query('update student_leave_requests set status=$2, decided_by=$3, decided_at=now(), decision_note=$4 where id=$1', [lid, b.decision, req.auth!.user.id, b.note ?? null]);
    if (b.decision === 'approved') {
      const from = new Date(row.from_date).toISOString().slice(0, 10), to = new Date(row.to_date).toISOString().slice(0, 10);
      for (const d of eachDate(from, to)) if (d <= today() && isoDow(d) !== 7) await c.query(
        `insert into student_attendance (student_id, date, section_id, status, marked_by) values ($1,$2,$3,'excused',$4)
         on conflict (student_id, date) do update set status='excused', marked_by=excluded.marked_by, updated_at=now()`, [row.student_id, d, row.section_id, req.auth!.user.id]);
    }
    return row;
  });
  await notifyFamilies('select id from students where id=$1', [l.student_id], `Leave ${b.decision}`, b.note ?? '', '/family/leave');
  await audit(req, `student_leave.${b.decision}`, 'student', l.student_id);
  res.json({ ok: true });
}));
