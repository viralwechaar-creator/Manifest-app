import { Request, Router } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { nextStudentCode } from './studentId';

export const studentsRouter = Router();
const view = requirePermission('students.view');
const manage = requirePermission('students.manage');
const idp = (v: string) => z.coerce.number().int().positive().parse(v);

/** SQL fragment limiting rows to what the signed-in user may see. Teachers see only their own sections. */
function scope(req: Request, p: unknown[], alias = 's'): string {
  if (req.auth!.permissions.includes('students.view_all')) return 'true';
  p.push(req.auth!.user.id);
  const n = p.length;
  return `${alias}.section_id in (
     select sec.id from sections sec join staff st on st.user_id = $${n}::uuid where sec.class_teacher_id = st.id
     union select ta.section_id from teacher_assignments ta join staff st on st.user_id = $${n}::uuid where ta.staff_id = st.id)`;
}

studentsRouter.get('/', view, asyncH(async (req, res) => {
  const p: unknown[] = []; const where = [scope(req, p)];
  const q = String(req.query.q ?? '').trim();
  if (q) { p.push(`%${q}%`); where.push(`(s.full_name ilike $${p.length} or s.student_code ilike $${p.length})`); }
  for (const [k, col] of [['status', 's.status'], ['section_id', 's.section_id'], ['class_id', 'sec.class_id']] as const) {
    const v = req.query[k]; if (typeof v === 'string' && v) { p.push(v); where.push(`${col}::text = $${p.length}`); }
  }
  const page = Math.max(1, Number(req.query.page) || 1); const size = 25;
  const from = 'students s left join sections sec on sec.id = s.section_id left join classes c on c.id = sec.class_id';
  const total = (await query(`select count(*)::int n from ${from} where ${where.join(' and ')}`, p)).rows[0].n;
  p.push(size, (page - 1) * size);
  const rows = (await query(
    `select s.id, s.student_code, s.full_name, s.gender, s.status, s.section_id, c.name as class_name, sec.name as section_name
       from ${from} where ${where.join(' and ')} order by c.level nulls last, sec.name, s.full_name limit $${p.length - 1} offset $${p.length}`, p)).rows;
  res.json({ rows, total, page, size });
}));

studentsRouter.get('/:id', view, asyncH(async (req, res) => {
  const sid = idp(req.params.id);
  const p: unknown[] = []; const sc = scope(req, p); p.push(sid);
  const s = (await query(
    `select s.id, s.student_code, s.full_name, s.date_of_birth, s.gender, s.admission_date, s.status, s.section_id,
            s.address, s.health_notes, c.name as class_name, sec.name as section_name, sec.class_id
       from students s left join sections sec on sec.id=s.section_id left join classes c on c.id=sec.class_id
      where ${sc} and s.id = $${p.length}`, p)).rows[0];
  if (!s) throw new HttpError(404, 'Student not found'); // same answer whether it exists or is out of scope (no IDOR hints)
  const sensitive = req.auth!.permissions.includes('students.sensitive');
  const out: any = { ...s };
  if (!sensitive) { delete out.address; delete out.health_notes; }
  else await audit(req, 'student.sensitive_viewed', 'student', sid);
  out.guardians = sensitive ? (await query(
    `select g.id, g.full_name, g.phone, g.email, sg.relation, sg.is_primary from student_guardians sg join guardians g on g.id=sg.guardian_id where sg.student_id=$1 order by sg.is_primary desc, g.full_name`, [sid])).rows
    : (await query(`select g.id, g.full_name, sg.relation, sg.is_primary from student_guardians sg join guardians g on g.id=sg.guardian_id where sg.student_id=$1`, [sid])).rows;
  out.history = (await query(
    `select e.academic_year_id, ay.label as year, c.name || ' ' || sec.name as section, e.started_on, e.ended_on, e.outcome
       from enrolments e join academic_years ay on ay.id=e.academic_year_id join sections sec on sec.id=e.section_id join classes c on c.id=sec.class_id
      where e.student_id=$1 order by ay.starts_on desc`, [sid])).rows;
  out.statusLog = (await query(
    `select l.old_status, l.new_status, l.reason, l.changed_at, u.display_name as by from student_status_log l left join users u on u.id=l.changed_by where l.student_id=$1 order by l.changed_at desc`, [sid])).rows;
  res.json(out);
}));

const guardian = z.object({
  fullName: z.string().trim().min(1).max(120), relation: z.string().trim().min(1).max(30),
  phone: z.string().trim().regex(/^[+0-9][0-9 ()-]{6,18}$/, 'Enter a valid phone number'),
  email: z.string().trim().email().max(200).optional().or(z.literal('')), isPrimary: z.boolean().optional(),
});
const studentBody = z.object({
  fullName: z.string().trim().min(1).max(120), dateOfBirth: z.string().date(), gender: z.enum(['female', 'male', 'other']),
  sectionId: z.number().int().positive().nullable().optional(), admissionDate: z.string().date().optional(),
  address: z.string().trim().max(400).optional().or(z.literal('')), healthNotes: z.string().trim().max(1000).optional().or(z.literal('')),
});

async function placeInSection(c: PoolClient, studentId: number, sectionId: number) {
  const sec = (await c.query(
    `select s.id, s.academic_year_id, s.capacity, (select count(*)::int from students st where st.section_id=s.id and st.status='active' and st.id<>$2) as used from sections s where s.id=$1 for update`, [sectionId, studentId])).rows[0];
  if (!sec) throw new HttpError(400, 'That section does not exist.');
  if (sec.used >= sec.capacity) throw new HttpError(409, 'That section is full.');
  await c.query('update enrolments set ended_on = current_date where student_id=$1 and ended_on is null and academic_year_id=$2 and section_id<>$3', [studentId, sec.academic_year_id, sectionId]);
  await c.query('delete from enrolments where student_id=$1 and academic_year_id=$2 and section_id<>$3', [studentId, sec.academic_year_id, sectionId]);
  await c.query('insert into enrolments (student_id, section_id, academic_year_id) values ($1,$2,$3) on conflict (student_id, academic_year_id) do nothing', [studentId, sectionId, sec.academic_year_id]);
  await c.query('update students set section_id=$2 where id=$1', [studentId, sectionId]);
}

/** Shared by direct registration now and by the admission workflow in a later phase. Issues the student ID. */
export async function registerStudent(c: PoolClient, b: z.infer<typeof studentBody> & { guardians: z.infer<typeof guardian>[] }) {
  const year = Number((b.admissionDate ?? new Date().toISOString()).slice(0, 4));
  const code = await nextStudentCode(c, year);
  const r = await c.query(
    `insert into students (student_code, full_name, date_of_birth, gender, admission_date, address, health_notes)
     values ($1,$2,$3,$4,coalesce($5::date, current_date),$6,$7) returning id`,
    [code, b.fullName, b.dateOfBirth, b.gender, b.admissionDate ?? null, b.address || null, b.healthNotes || null]);
  const sid = r.rows[0].id as number;
  if (b.sectionId) await placeInSection(c, sid, b.sectionId);
  let any = false;
  for (const g of b.guardians) {
    // Siblings share one guardian record (matched by phone) so one parent account can show several children.
    let gid = (await c.query('select id from guardians where phone=$1 order by id limit 1', [g.phone])).rows[0]?.id;
    if (!gid) gid = (await c.query('insert into guardians (full_name, phone, email) values ($1,$2,$3::citext) returning id', [g.fullName, g.phone, g.email || null])).rows[0].id;
    await c.query('insert into student_guardians (student_id, guardian_id, relation, is_primary) values ($1,$2,$3,$4) on conflict do nothing', [sid, gid, g.relation, !!g.isPrimary || !any]);
    any = true;
  }
  await c.query("insert into student_status_log (student_id, new_status, reason) values ($1,'active','Registered')", [sid]);
  return { id: sid, studentCode: code };
}

studentsRouter.post('/', manage, asyncH(async (req, res) => {
  const b = studentBody.extend({ guardians: z.array(guardian).min(1, 'Add at least one parent or guardian').max(4) }).parse(req.body);
  const out = await tx((c) => registerStudent(c, b));
  await audit(req, 'student.registered', 'student', out.id);
  res.status(201).json(out);
}));

studentsRouter.patch('/:id', manage, asyncH(async (req, res) => {
  const sid = idp(req.params.id);
  const b = studentBody.partial().parse(req.body);
  await tx(async (c) => {
    const cur = (await c.query('select section_id from students where id=$1 for update', [sid])).rows[0];
    if (!cur) throw new HttpError(404, 'Student not found');
    await c.query(
      `update students set full_name=coalesce($2,full_name), date_of_birth=coalesce($3,date_of_birth), gender=coalesce($4,gender),
         address = case when $5::boolean then $6 else address end, health_notes = case when $7::boolean then $8 else health_notes end where id=$1`,
      [sid, b.fullName ?? null, b.dateOfBirth ?? null, b.gender ?? null, 'address' in b, b.address || null, 'healthNotes' in b, b.healthNotes || null]);
    if (b.sectionId && b.sectionId !== cur.section_id) await placeInSection(c, sid, b.sectionId);
  });
  await audit(req, 'student.updated', 'student', sid, { changed: Object.keys(b) });
  res.json({ ok: true });
}));

studentsRouter.put('/:id/guardians', manage, asyncH(async (req, res) => {
  const sid = idp(req.params.id);
  const { guardians } = z.object({ guardians: z.array(guardian).min(1).max(4) }).parse(req.body);
  await tx(async (c) => {
    if (!(await c.query('select 1 from students where id=$1', [sid])).rowCount) throw new HttpError(404, 'Student not found');
    await c.query('delete from student_guardians where student_id=$1', [sid]);
    let first = true;
    for (const g of guardians) {
      let gid = (await c.query('select id from guardians where phone=$1 order by id limit 1', [g.phone])).rows[0]?.id;
      if (gid) await c.query('update guardians set full_name=$2, email=$3::citext where id=$1', [gid, g.fullName, g.email || null]);
      else gid = (await c.query('insert into guardians (full_name, phone, email) values ($1,$2,$3::citext) returning id', [g.fullName, g.phone, g.email || null])).rows[0].id;
      await c.query('insert into student_guardians values ($1,$2,$3,$4) on conflict do nothing', [sid, gid, g.relation, !!g.isPrimary || first]);
      first = false;
    }
    await c.query('delete from guardians g where not exists (select 1 from student_guardians sg where sg.guardian_id=g.id) and g.user_id is null');
  });
  await audit(req, 'student.guardians_updated', 'student', sid);
  res.json({ ok: true });
}));

studentsRouter.post('/:id/status', manage, asyncH(async (req, res) => {
  const sid = idp(req.params.id);
  const b = z.object({ status: z.enum(['active', 'transferred', 'withdrawn', 'alumni', 'suspended']), reason: z.string().trim().min(3, 'Please give a reason').max(300) }).parse(req.body);
  await tx(async (c) => {
    const cur = (await c.query('select status from students where id=$1 for update', [sid])).rows[0];
    if (!cur) throw new HttpError(404, 'Student not found');
    if (cur.status === b.status) throw new HttpError(400, 'The student already has that status.');
    await c.query('update students set status=$2 where id=$1', [sid, b.status]);
    await c.query('insert into student_status_log (student_id, old_status, new_status, reason, changed_by) values ($1,$2,$3,$4,$5)', [sid, cur.status, b.status, b.reason, req.auth!.user.id]);
    if (['transferred', 'withdrawn', 'alumni'].includes(b.status)) {
      const outcome = b.status === 'alumni' ? 'completed' : b.status;
      await c.query('update enrolments set ended_on=current_date, outcome=$2 where student_id=$1 and ended_on is null', [sid, outcome]);
    }
  });
  await audit(req, 'student.status_changed', 'student', sid, { status: b.status });
  res.json({ ok: true });
}));

// Class promotion: moves students into a section of a later academic year and keeps their history.
studentsRouter.post('/promote', manage, asyncH(async (req, res) => {
  const b = z.object({ studentIds: z.array(z.number().int().positive()).min(1).max(300), targetSectionId: z.number().int().positive() }).parse(req.body);
  const moved = await tx(async (c) => {
    const target = (await c.query('select academic_year_id from sections where id=$1', [b.targetSectionId])).rows[0];
    if (!target) throw new HttpError(400, 'Choose a section to promote into.');
    let n = 0;
    for (const sid of new Set(b.studentIds)) {
      const cur = (await c.query(`select s.id, s.status, sec.academic_year_id from students s join sections sec on sec.id=s.section_id where s.id=$1 for update of s`, [sid])).rows[0];
      if (!cur || cur.status !== 'active') throw new HttpError(400, 'Only active students with a class can be promoted.');
      if (cur.academic_year_id === target.academic_year_id) throw new HttpError(400, 'Promotion moves students into a different academic year. To change section within a year, edit the student.');
      await c.query("update enrolments set ended_on=current_date, outcome='promoted' where student_id=$1 and ended_on is null", [sid]);
      await placeInSection(c, sid, b.targetSectionId);
      n++;
    }
    return n;
  });
  await audit(req, 'students.promoted', 'section', b.targetSectionId, { count: moved });
  res.json({ promoted: moved });
}));
