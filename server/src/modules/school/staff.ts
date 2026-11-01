import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { generateTempPassword, hashPassword } from '../../lib/password';
import { requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';

export const staffRouter2 = Router();
const view = requirePermission('staff.view');
const manage = requirePermission('staff.manage');
const idp = (v: string) => z.coerce.number().int().positive().parse(v);

staffRouter2.get('/', view, asyncH(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const page = Math.max(1, Number(req.query.page) || 1); const size = 25;
  const where = ['true']; const p: unknown[] = [];
  if (q) { p.push(`%${q}%`); where.push(`(s.full_name ilike $${p.length} or s.staff_code ilike $${p.length} or s.designation ilike $${p.length})`); }
  for (const [k, col] of [['kind', 's.kind'], ['status', 's.status'], ['department_id', 's.department_id']] as const) {
    const v = req.query[k]; if (typeof v === 'string' && v) { p.push(v); where.push(`${col}::text = $${p.length}`); }
  }
  const total = (await query(`select count(*)::int n from staff s where ${where.join(' and ')}`, p)).rows[0].n;
  p.push(size, (page - 1) * size);
  const canSee = req.auth!.permissions.includes('staff.manage');
  const rows = (await query(
    `select s.id, s.staff_code, s.full_name, s.kind, s.designation, s.status, s.department_id, d.name as department,
            ${canSee ? 's.email, s.phone,' : ''} (s.user_id is not null) as has_login
       from staff s left join departments d on d.id = s.department_id where ${where.join(' and ')}
       order by s.full_name limit $${p.length - 1} offset $${p.length}`, p)).rows;
  res.json({ rows, total, page, size });
}));

staffRouter2.get('/options', requirePermission('dashboard.view'), asyncH(async (_req, res) => {
  res.json((await query("select id, full_name as label, kind from staff where status <> 'left' order by full_name")).rows);
}));

staffRouter2.get('/:id', view, asyncH(async (req, res) => {
  const sid = idp(req.params.id);
  const canSee = req.auth!.permissions.includes('staff.manage');
  const s = (await query(
    `select s.id, s.staff_code, s.full_name, s.kind, s.designation, s.status, s.department_id, s.joined_on, d.name as department,
            ${canSee ? 's.email, s.phone,' : ''} (select u.login_id from users u where u.id = s.user_id) as login_id
       from staff s left join departments d on d.id = s.department_id where s.id=$1`, [sid])).rows[0];
  if (!s) throw new HttpError(404, 'Not found');
  const assignments = (await query(
    `select ta.section_id, ta.subject_id, c.name || ' ' || sec.name as section, sub.name as subject
       from teacher_assignments ta join sections sec on sec.id=ta.section_id join classes c on c.id=sec.class_id join subjects sub on sub.id=ta.subject_id
      where ta.staff_id=$1 order by c.level, sec.name, sub.name`, [sid])).rows;
  const classTeacherOf = (await query('select sec.id, c.name || \' \' || sec.name as section from sections sec join classes c on c.id=sec.class_id where sec.class_teacher_id=$1', [sid])).rows;
  res.json({ ...s, assignments, classTeacherOf });
}));

const base = z.object({
  fullName: z.string().trim().min(1).max(120),
  kind: z.enum(['teacher', 'non_teaching']),
  designation: z.string().trim().min(1).max(80),
  departmentId: z.number().int().positive().nullable().optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  joinedOn: z.string().date().optional().or(z.literal('')),
});

async function nextStaffCode(c: { query: Function }): Promise<string> {
  const r = await c.query("select coalesce(max(substring(staff_code from '[0-9]+$')::int), 0) + 1 as n from staff");
  return 'S' + String(r.rows[0].n).padStart(4, '0');
}

staffRouter2.post('/', manage, asyncH(async (req, res) => {
  const b = base.extend({ login: z.object({ loginId: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._@-]+$/), role: z.string() }).optional() }).parse(req.body);
  if (b.login && b.login.role === 'super_admin' && !req.auth!.roles.includes('super_admin')) throw new HttpError(403, 'Only a Super Admin can grant that role.');
  let temp: string | null = null;
  const out = await tx(async (c) => {
    let userId: string | null = null;
    if (b.login) {
      temp = generateTempPassword();
      const role = (await c.query('select id from roles where code=$1', [b.login.role])).rows[0];
      if (!role) throw new HttpError(400, 'Unknown role.');
      const u = await c.query('insert into users (login_id, display_name, email, password_hash, must_change_password, created_by) values ($1::citext,$2,$3::citext,$4,true,$5) returning id',
        [b.login.loginId, b.fullName, b.email || null, await hashPassword(temp), req.auth!.user.id]);
      userId = u.rows[0].id;
      await c.query('insert into user_roles values ($1,$2)', [userId, role.id]);
    }
    const code = await nextStaffCode(c);
    const r = await c.query(
      `insert into staff (user_id, staff_code, full_name, kind, designation, department_id, email, phone, joined_on)
       values ($1,$2,$3,$4,$5,$6,$7::citext,$8,$9) returning id, staff_code`,
      [userId, code, b.fullName, b.kind, b.designation, b.departmentId ?? null, b.email || null, b.phone || null, b.joinedOn || null]);
    return r.rows[0];
  });
  await audit(req, 'staff.created', 'staff', out.id, { withLogin: !!b.login });
  res.status(201).json({ id: out.id, staffCode: out.staff_code, temporaryPassword: temp });
}));

staffRouter2.patch('/:id', manage, asyncH(async (req, res) => {
  const b = base.partial().extend({ status: z.enum(['active', 'on_leave', 'left']).optional() }).parse(req.body);
  const sid = idp(req.params.id);
  const cur = (await query('select user_id from staff where id=$1', [sid])).rows[0];
  if (!cur) throw new HttpError(404, 'Not found');
  await tx(async (c) => {
    await c.query(
      `update staff set full_name=coalesce($2,full_name), kind=coalesce($3,kind), designation=coalesce($4,designation),
         department_id = case when $5::boolean then $6 else department_id end,
         email = case when $7::boolean then $8::citext else email end, phone = case when $9::boolean then $10 else phone end,
         joined_on = case when $11::boolean then $12::date else joined_on end, status=coalesce($13,status) where id=$1`,
      [sid, b.fullName ?? null, b.kind ?? null, b.designation ?? null, 'departmentId' in b, b.departmentId ?? null,
       'email' in b, b.email || null, 'phone' in b, b.phone || null, 'joinedOn' in b, b.joinedOn || null, b.status ?? null]);
    if (b.status === 'left' && cur.user_id) { // leavers lose access immediately
      await c.query("update users set status='suspended' where id=$1", [cur.user_id]);
      await c.query('delete from sessions where user_id=$1', [cur.user_id]);
      await c.query('update sections set class_teacher_id=null where class_teacher_id=$1', [sid]);
      await c.query('update departments set head_staff_id=null where head_staff_id=$1', [sid]);
    }
  });
  await audit(req, 'staff.updated', 'staff', sid, { changed: Object.keys(b) });
  res.json({ ok: true });
}));

// Replace a teacher's teaching assignments (which class-section teaches which subject).
staffRouter2.put('/:id/assignments', manage, asyncH(async (req, res) => {
  const sid = idp(req.params.id);
  const { assignments } = z.object({ assignments: z.array(z.object({ sectionId: z.number().int().positive(), subjectId: z.number().int().positive() })).max(200) }).parse(req.body);
  const st = (await query('select kind from staff where id=$1', [sid])).rows[0];
  if (!st) throw new HttpError(404, 'Not found');
  if (st.kind !== 'teacher') throw new HttpError(400, 'Only teachers can have teaching assignments.');
  await tx(async (c) => {
    await c.query('delete from teacher_assignments where staff_id=$1', [sid]);
    for (const a of assignments) {
      // The subject must be part of the class's curriculum.
      const ok = await c.query('select 1 from sections s join class_subjects cs on cs.class_id=s.class_id where s.id=$1 and cs.subject_id=$2', [a.sectionId, a.subjectId]);
      if (!ok.rowCount) throw new HttpError(400, 'One of the subjects is not taught in that class. Add it to the class first.');
      await c.query('insert into teacher_assignments (staff_id, section_id, subject_id) values ($1,$2,$3) on conflict do nothing', [sid, a.sectionId, a.subjectId]);
    }
  });
  await audit(req, 'staff.assignments_set', 'staff', sid, { count: assignments.length });
  res.json({ ok: true });
}));
