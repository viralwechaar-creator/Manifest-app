import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';

export const academicsRouter = Router();
const read = requirePermission('dashboard.view');
const write = requirePermission('academics.manage');
const id = (v: string) => z.coerce.number().int().positive().parse(v);

// ---- Academic years ----
academicsRouter.get('/years', read, asyncH(async (_req, res) => {
  res.json((await query('select * from academic_years order by starts_on desc')).rows);
}));
const year = z.object({ label: z.string().trim().min(1).max(20), startsOn: z.string().date(), endsOn: z.string().date() });
academicsRouter.post('/years', write, asyncH(async (req, res) => {
  const b = year.parse(req.body);
  if (b.endsOn <= b.startsOn) throw new HttpError(400, 'The end date must be after the start date.', { endsOn: 'Must be after start' });
  const r = await query('insert into academic_years (label, starts_on, ends_on) values ($1,$2,$3) returning id', [b.label, b.startsOn, b.endsOn]);
  await audit(req, 'academic_year.created', 'academic_year', r.rows[0].id);
  res.status(201).json({ id: r.rows[0].id });
}));
academicsRouter.patch('/years/:id', write, asyncH(async (req, res) => {
  const b = year.partial().parse(req.body);
  const cur = (await query('select * from academic_years where id=$1', [id(req.params.id)])).rows[0];
  if (!cur) throw new HttpError(404, 'Not found');
  await query('update academic_years set label=coalesce($2,label), starts_on=coalesce($3,starts_on), ends_on=coalesce($4,ends_on) where id=$1', [cur.id, b.label ?? null, b.startsOn ?? null, b.endsOn ?? null]);
  await audit(req, 'academic_year.updated', 'academic_year', cur.id);
  res.json({ ok: true });
}));
academicsRouter.post('/years/:id/current', write, asyncH(async (req, res) => {
  const yid = id(req.params.id);
  await tx(async (c) => {
    if (!(await c.query('select 1 from academic_years where id=$1', [yid])).rowCount) throw new HttpError(404, 'Not found');
    await c.query('update academic_years set is_current=false where is_current');
    await c.query('update academic_years set is_current=true where id=$1', [yid]);
  });
  await audit(req, 'academic_year.set_current', 'academic_year', yid);
  res.json({ ok: true });
}));

// ---- Classes ----
academicsRouter.get('/classes', read, asyncH(async (_req, res) => {
  res.json((await query(
    `select c.*, coalesce((select array_agg(cs.subject_id order by cs.subject_id) from class_subjects cs where cs.class_id=c.id), '{}') as subject_ids
       from classes c order by c.level`)).rows);
}));
const cls = z.object({ name: z.string().trim().min(1).max(40), level: z.number().int().min(-5).max(20) });
academicsRouter.post('/classes', write, asyncH(async (req, res) => {
  const b = cls.parse(req.body);
  const r = await query('insert into classes (name, level) values ($1,$2) returning id', [b.name, b.level]);
  await audit(req, 'class.created', 'class', r.rows[0].id);
  res.status(201).json({ id: r.rows[0].id });
}));
academicsRouter.patch('/classes/:id', write, asyncH(async (req, res) => {
  const b = cls.partial().parse(req.body);
  const r = await query('update classes set name=coalesce($2,name), level=coalesce($3,level) where id=$1', [id(req.params.id), b.name ?? null, b.level ?? null]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'class.updated', 'class', req.params.id);
  res.json({ ok: true });
}));
academicsRouter.delete('/classes/:id', write, asyncH(async (req, res) => {
  const r = await query('delete from classes where id=$1', [id(req.params.id)]); // sections restrict deletion
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'class.deleted', 'class', req.params.id);
  res.json({ ok: true });
}));
academicsRouter.put('/classes/:id/subjects', write, asyncH(async (req, res) => {
  const cid = id(req.params.id);
  const { subjectIds } = z.object({ subjectIds: z.array(z.number().int().positive()).max(60) }).parse(req.body);
  await tx(async (c) => {
    await c.query('delete from class_subjects where class_id=$1', [cid]);
    for (const s of new Set(subjectIds)) await c.query('insert into class_subjects values ($1,$2)', [cid, s]);
  });
  await audit(req, 'class.subjects_set', 'class', cid, { count: subjectIds.length });
  res.json({ ok: true });
}));

// ---- Sections ----
academicsRouter.get('/sections', read, asyncH(async (req, res) => {
  const yr = req.query.year ? id(String(req.query.year)) : (await query('select id from academic_years where is_current')).rows[0]?.id ?? null;
  res.json((await query(
    `select s.id, s.name, s.class_id, c.name as class_name, c.level, s.academic_year_id, s.capacity, s.class_teacher_id, t.full_name as class_teacher,
            (select count(*)::int from students st where st.section_id = s.id and st.status='active') as students
       from sections s join classes c on c.id=s.class_id left join staff t on t.id=s.class_teacher_id
      where ($1::int is null or s.academic_year_id = $1) order by c.level, s.name`, [yr])).rows);
}));
const sec = z.object({ classId: z.number().int().positive(), academicYearId: z.number().int().positive(), name: z.string().trim().min(1).max(10), capacity: z.number().int().min(1).max(200).optional(), classTeacherId: z.number().int().positive().nullable().optional() });
academicsRouter.post('/sections', write, asyncH(async (req, res) => {
  const b = sec.parse(req.body);
  const r = await query('insert into sections (class_id, academic_year_id, name, capacity, class_teacher_id) values ($1,$2,$3,$4,$5) returning id', [b.classId, b.academicYearId, b.name, b.capacity ?? 40, b.classTeacherId ?? null]);
  await audit(req, 'section.created', 'section', r.rows[0].id);
  res.status(201).json({ id: r.rows[0].id });
}));
academicsRouter.patch('/sections/:id', write, asyncH(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(10).optional(), capacity: z.number().int().min(1).max(200).optional(), classTeacherId: z.number().int().positive().nullable().optional() }).parse(req.body);
  const sid = id(req.params.id);
  const cur = (await query('select capacity from sections where id=$1', [sid])).rows[0];
  if (!cur) throw new HttpError(404, 'Not found');
  if (b.capacity !== undefined) {
    const n = (await query("select count(*)::int n from students where section_id=$1 and status='active'", [sid])).rows[0].n;
    if (b.capacity < n) throw new HttpError(400, `This section already has ${n} students.`, { capacity: `At least ${n}` });
  }
  await query('update sections set name=coalesce($2,name), capacity=coalesce($3,capacity), class_teacher_id = case when $4::boolean then $5 else class_teacher_id end where id=$1',
    [sid, b.name ?? null, b.capacity ?? null, 'classTeacherId' in b, b.classTeacherId ?? null]);
  await audit(req, 'section.updated', 'section', sid);
  res.json({ ok: true });
}));
academicsRouter.delete('/sections/:id', write, asyncH(async (req, res) => {
  const sid = id(req.params.id);
  if ((await query('select 1 from students where section_id=$1 limit 1', [sid])).rowCount) throw new HttpError(409, 'This section still has students. Move them first.');
  const r = await query('delete from sections where id=$1', [sid]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'section.deleted', 'section', sid);
  res.json({ ok: true });
}));

// ---- Subjects ----
academicsRouter.get('/subjects', read, asyncH(async (_req, res) => {
  res.json((await query('select s.*, d.name as department from subjects s left join departments d on d.id=s.department_id order by s.name')).rows);
}));
const subj = z.object({ name: z.string().trim().min(1).max(80), code: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9-]+$/), departmentId: z.number().int().positive().nullable().optional() });
academicsRouter.post('/subjects', write, asyncH(async (req, res) => {
  const b = subj.parse(req.body);
  const r = await query('insert into subjects (name, code, department_id) values ($1,$2,$3) returning id', [b.name, b.code.toUpperCase(), b.departmentId ?? null]);
  await audit(req, 'subject.created', 'subject', r.rows[0].id);
  res.status(201).json({ id: r.rows[0].id });
}));
academicsRouter.patch('/subjects/:id', write, asyncH(async (req, res) => {
  const b = subj.partial().parse(req.body);
  const r = await query('update subjects set name=coalesce($2,name), code=coalesce($3,code), department_id = case when $4::boolean then $5 else department_id end where id=$1',
    [id(req.params.id), b.name ?? null, b.code?.toUpperCase() ?? null, 'departmentId' in b, b.departmentId ?? null]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'subject.updated', 'subject', req.params.id);
  res.json({ ok: true });
}));
academicsRouter.delete('/subjects/:id', write, asyncH(async (req, res) => {
  const r = await query('delete from subjects where id=$1', [id(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'subject.deleted', 'subject', req.params.id);
  res.json({ ok: true });
}));

// ---- Department head ----
academicsRouter.get('/departments', read, asyncH(async (_req, res) => {
  res.json((await query(
    `select d.id, d.name, d.head_staff_id, h.full_name as head,
            (select count(*)::int from staff s where s.department_id=d.id and s.status<>'left') as staff_count
       from departments d left join staff h on h.id=d.head_staff_id order by d.sort, d.name`)).rows);
}));
academicsRouter.put('/departments/:id/head', write, asyncH(async (req, res) => {
  const { staffId } = z.object({ staffId: z.number().int().positive().nullable() }).parse(req.body);
  const r = await query('update departments set head_staff_id=$2 where id=$1', [id(req.params.id), staffId]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'department.head_set', 'department', req.params.id, { staffId });
  res.json({ ok: true });
}));
