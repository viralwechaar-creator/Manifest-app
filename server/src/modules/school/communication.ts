import { Request, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { childOf, familyOnly, isParent, linkedIds } from './family';
import { libraryFor } from './library';
import { transportFor } from './transport';
import { has, isAdmin, myStaffId, teachesSection } from './helpers';

const idp = (v: string) => z.coerce.number().int().positive().parse(v);
const body = z.string().trim().min(1, 'Please write a message').max(2000);
const msgLimit = rateLimit({ windowMs: 60 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.auth?.user.id ?? req.ip ?? 'x', message: { error: 'You are sending messages very quickly. Please wait a little.' }, validate: { keyGeneratorIpFallback: false } });
/** Where a person should land: staff in the staff portal, families in the family portal. */
const homeLink = async (userId: string, staff: string, family: string) => ((await query('select 1 from staff where user_id=$1', [userId])).rowCount ? staff : family);
const note = async (userId: string, title: string, text: string, link: string) => { await query('insert into notifications (user_id, title, body, link) values ($1,$2,$3,$4)', [userId, title, text.slice(0, 120), link]); };

// ======================= Messaging: shared thread logic =======================
const THREAD_SQL = `select t.id, t.subject, t.last_message_at, t.student_id, s.full_name as student, pu.display_name as parent, su.display_name as teacher, t.parent_user_id, t.staff_user_id,
   (select count(*)::int from messages m where m.thread_id=t.id and m.sender_id <> $1 and m.created_at > coalesce(case when t.parent_user_id=$1 then t.parent_read_at else t.staff_read_at end, 'epoch')) as unread,
   (select left(body, 90) from messages m where m.thread_id=t.id order by m.created_at desc limit 1) as preview
  from threads t join students s on s.id=t.student_id join users pu on pu.id=t.parent_user_id join users su on su.id=t.staff_user_id`;
async function mine(threadId: number, userId: string) {
  const t = (await query('select * from threads where id=$1 and (parent_user_id=$2 or staff_user_id=$2)', [threadId, userId])).rows[0];
  if (!t) throw new HttpError(404, 'Conversation not found'); // not a participant = not found
  return t;
}
async function openThread(req: Request, threadId: number) {
  const uid = req.auth!.user.id; const t = await mine(threadId, uid);
  await query(`update threads set ${t.parent_user_id === uid ? 'parent_read_at' : 'staff_read_at'} = now() where id=$1`, [threadId]);
  const msgs = (await query('select m.id, m.body, m.created_at, m.sender_id = $2 as mine, u.display_name as sender from messages m join users u on u.id=m.sender_id where m.thread_id=$1 order by m.created_at', [threadId, uid])).rows;
  const info = (await query(`${THREAD_SQL} where t.id=$2`, [uid, threadId])).rows[0];
  return { thread: { id: info.id, subject: info.subject, student: info.student, parent: info.parent, teacher: info.teacher }, messages: msgs };
}
async function addMessage(req: Request, threadId: number, text: string, link: string) {
  const uid = req.auth!.user.id; const t = await mine(threadId, uid);
  await tx(async (c) => { await c.query('insert into messages (thread_id, sender_id, body) values ($1,$2,$3)', [threadId, uid, text]); await c.query(`update threads set last_message_at=now(), ${t.parent_user_id === uid ? 'parent_read_at' : 'staff_read_at'}=now() where id=$1`, [threadId]); });
  await note(t.parent_user_id === uid ? t.staff_user_id : t.parent_user_id, 'New message', text, link);
}

// ---------- staff side ----------
export const staffMessages = Router();
staffMessages.use(requirePermission('messages.use'));
staffMessages.get('/threads', asyncH(async (req, res) => { res.json((await query(`${THREAD_SQL} where t.staff_user_id=$1 order by t.last_message_at desc limit 100`, [req.auth!.user.id])).rows); }));
staffMessages.get('/threads/:id', asyncH(async (req, res) => { res.json(await openThread(req, idp(req.params.id))); }));
staffMessages.post('/threads/:id/messages', msgLimit, asyncH(async (req, res) => { await addMessage(req, idp(req.params.id), body.parse(req.body.body), '/portal/messages'); res.status(201).json({ ok: true }); }));
staffMessages.post('/threads', msgLimit, asyncH(async (req, res) => {
  const b = z.object({ studentId: z.number().int().positive(), subject: z.string().trim().min(1).max(120), body }).parse(req.body);
  const st = (await query('select section_id from students where id=$1', [b.studentId])).rows[0];
  if (!st) throw new HttpError(404, 'Student not found');
  if (!(isAdmin(req) || has(req, 'students.view_all'))) { const sid = await myStaffId(req); if (!sid || !st.section_id || !(await teachesSection(sid, st.section_id))) throw new HttpError(404, 'Student not found'); } // only your own students
  const parent = (await query(`select g.user_id from student_guardians sg join guardians g on g.id=sg.guardian_id where sg.student_id=$1 and g.user_id is not null order by sg.is_primary desc limit 1`, [b.studentId])).rows[0];
  if (!parent) throw new HttpError(409, 'This student’s parent does not have a portal login yet, so they cannot receive messages.');
  const id = await tx(async (c) => { const r = await c.query('insert into threads (student_id, parent_user_id, staff_user_id, subject, created_by, staff_read_at) values ($1,$2,$3,$4,$5,now()) returning id', [b.studentId, parent.user_id, req.auth!.user.id, b.subject, req.auth!.user.id]); await c.query('insert into messages (thread_id, sender_id, body) values ($1,$2,$3)', [r.rows[0].id, req.auth!.user.id, b.body]); return r.rows[0].id as number; });
  await note(parent.user_id, 'New message from school', `${b.subject}: ${b.body}`, '/family/messages');
  await audit(req, 'message.thread_started', 'student', b.studentId); res.status(201).json({ id });
}));

// ---------- family side ----------
export const familyExtra = Router();
familyExtra.use(requireAuth, familyOnly);
const parentOnly = (req: Request) => { if (!isParent(req)) throw new HttpError(403, 'Only a parent can do this.'); };
familyExtra.get('/children/:id/teachers', asyncH(async (req, res) => {
  const id = await childOf(req);
  res.json((await query(
    `select distinct on (t.user_id) t.user_id, t.full_name, case when sec.class_teacher_id = t.id then 'Class teacher' else (select string_agg(distinct sub.name, ', ') from teacher_assignments ta2 join subjects sub on sub.id=ta2.subject_id where ta2.staff_id=t.id and ta2.section_id=sec.id) end as role
       from students s join sections sec on sec.id=s.section_id join staff t on t.status='active' and t.user_id is not null and (t.id = sec.class_teacher_id or t.id in (select staff_id from teacher_assignments where section_id=sec.id))
      where s.id=$1 order by t.user_id`, [id])).rows);
}));
familyExtra.get('/messages', asyncH(async (req, res) => { parentOnly(req); res.json((await query(`${THREAD_SQL} where t.parent_user_id=$1 order by t.last_message_at desc limit 100`, [req.auth!.user.id])).rows); }));
familyExtra.get('/messages/:id', asyncH(async (req, res) => { parentOnly(req); res.json(await openThread(req, idp(req.params.id))); }));
familyExtra.post('/messages/:id', msgLimit, asyncH(async (req, res) => { parentOnly(req); await addMessage(req, idp(req.params.id), body.parse(req.body.body), '/portal/messages'); res.status(201).json({ ok: true }); }));
familyExtra.post('/messages', msgLimit, asyncH(async (req, res) => {
  parentOnly(req);
  const b = z.object({ studentId: z.number().int().positive(), teacherUserId: z.string().uuid(), subject: z.string().trim().min(1).max(120), body }).parse(req.body);
  if (!(await linkedIds(req)).includes(b.studentId)) throw new HttpError(404, 'Not found');
  const ok = await query(`select 1 from students s join sections sec on sec.id=s.section_id join staff t on t.user_id=$2 and t.status='active' and (t.id=sec.class_teacher_id or t.id in (select staff_id from teacher_assignments where section_id=sec.id)) where s.id=$1`, [b.studentId, b.teacherUserId]);
  if (!ok.rowCount) throw new HttpError(400, 'You can message only your child’s own teachers.');
  const id = await tx(async (c) => { const r = await c.query('insert into threads (student_id, parent_user_id, staff_user_id, subject, created_by, parent_read_at) values ($1,$2,$3,$4,$5,now()) returning id', [b.studentId, req.auth!.user.id, b.teacherUserId, b.subject, req.auth!.user.id]); await c.query('insert into messages (thread_id, sender_id, body) values ($1,$2,$3)', [r.rows[0].id, req.auth!.user.id, b.body]); return r.rows[0].id as number; });
  await note(b.teacherUserId, 'New message from a parent', `${b.subject}: ${b.body}`, '/portal/messages');
  res.status(201).json({ id });
}));

familyExtra.get('/children/:id/transport', asyncH(async (req, res) => { res.json(await transportFor(await childOf(req))); }));
familyExtra.get('/children/:id/library', asyncH(async (req, res) => { res.json(await libraryFor(await childOf(req))); }));

// ======================= Complaints =======================
const CATS = ['academic', 'transport', 'fees', 'safety', 'facilities', 'staff_conduct', 'student_conduct', 'other'] as const;
async function newRef() {
  const y = new Date().getUTCFullYear();
  const n = (await query('insert into complaint_counters (year, last_number) values ($1,1) on conflict (year) do update set last_number = complaint_counters.last_number + 1 returning last_number', [y])).rows[0].last_number;
  return `CMP-${y}-${String(n).padStart(4, '0')}`;
}
async function createComplaint(req: Request, b: { studentId?: number | null; category: (typeof CATS)[number]; subject: string; body: string }) {
  const confidential = b.category === 'staff_conduct';
  const ref = await newRef();
  const r = await query('insert into complaints (ref, submitted_by, student_id, category, subject, body, confidential) values ($1,$2,$3,$4,$5,$6,$7) returning id', [ref, req.auth!.user.id, b.studentId ?? null, b.category, b.subject, b.body, confidential]);
  await query(`insert into notifications (user_id, title, body, link) select distinct u.id, 'New complaint', $1, '/portal/complaints' from users u join user_roles ur on ur.user_id=u.id join role_permissions rp on rp.role_id=ur.role_id join permissions p on p.id=rp.permission_id
    where u.status='active' and u.id <> $2 and (p.code = case when $3::boolean then 'complaints.confidential' else 'complaints.handle' end)`, [`${ref}: ${b.subject}`, req.auth!.user.id, confidential]);
  await audit(req, 'complaint.submitted', 'complaint', r.rows[0].id, { category: b.category });
  return { id: r.rows[0].id as number, ref };
}
const complaintBody = z.object({ studentId: z.number().int().positive().nullable().optional(), category: z.enum(CATS), subject: z.string().trim().min(3, 'Please give a short subject').max(140), body: z.string().trim().min(10, 'Please describe the concern').max(4000) });
const mineView = async (req: Request, id: number) => {
  const c = (await query('select id, ref, category, subject, body, status, resolution, created_at, resolved_at from complaints where id=$1 and submitted_by=$2', [id, req.auth!.user.id])).rows[0];
  if (!c) throw new HttpError(404, 'Not found');
  const updates = (await query('select u.note, u.created_at, case when u.author_id=$2 then \'You\' else \'School\' end as who from complaint_updates u where u.complaint_id=$1 and not u.internal order by u.created_at', [id, req.auth!.user.id])).rows;
  return { ...c, updates };
};
familyExtra.get('/complaints', asyncH(async (req, res) => { res.json((await query('select id, ref, category, subject, status, created_at from complaints where submitted_by=$1 order by created_at desc limit 100', [req.auth!.user.id])).rows); }));
familyExtra.get('/complaints/:id', asyncH(async (req, res) => { res.json(await mineView(req, idp(req.params.id))); }));
familyExtra.post('/complaints', msgLimit, asyncH(async (req, res) => {
  parentOnly(req); const b = complaintBody.parse(req.body);
  if (b.studentId && !(await linkedIds(req)).includes(b.studentId)) throw new HttpError(404, 'Not found');
  if (b.category === 'student_conduct') throw new HttpError(400, 'Please choose another category.', { category: 'Not available' });
  res.status(201).json(await createComplaint(req, b));
}));
familyExtra.post('/complaints/:id/reply', msgLimit, asyncH(async (req, res) => {
  const id = idp(req.params.id); const c = (await query('select status, assigned_to from complaints where id=$1 and submitted_by=$2', [id, req.auth!.user.id])).rows[0];
  if (!c) throw new HttpError(404, 'Not found'); if (c.status === 'closed') throw new HttpError(409, 'This concern is closed. Please raise a new one.');
  const text = body.parse(req.body.note); await query('insert into complaint_updates (complaint_id, author_id, note) values ($1,$2,$3)', [id, req.auth!.user.id, text]);
  if (c.assigned_to) await note(c.assigned_to, 'Complaint updated', text, '/portal/complaints'); res.status(201).json({ ok: true });
}));

// ---- staff: raise your own concerns, and the handling desk ----
export const staffComplaints = Router();
staffComplaints.post('/', requirePermission('complaints.submit'), msgLimit, asyncH(async (req, res) => {
  const b = complaintBody.parse(req.body);
  if (b.studentId && !(isAdmin(req) || has(req, 'students.view_all'))) { // teachers raise concerns only about students they teach
    const st = (await query('select section_id from students where id=$1', [b.studentId])).rows[0]; const sid = await myStaffId(req);
    if (!st || !sid || !st.section_id || !(await teachesSection(sid, st.section_id))) throw new HttpError(404, 'Student not found');
  }
  res.status(201).json(await createComplaint(req, b));
}));
staffComplaints.get('/mine', requirePermission('complaints.submit'), asyncH(async (req, res) => { res.json((await query('select id, ref, category, subject, status, created_at from complaints where submitted_by=$1 order by created_at desc limit 100', [req.auth!.user.id])).rows); }));
staffComplaints.get('/mine/:id', requirePermission('complaints.submit'), asyncH(async (req, res) => { res.json(await mineView(req, idp(req.params.id))); }));

const handle = requirePermission('complaints.handle');
const seeConf = (req: Request) => has(req, 'complaints.confidential');
staffComplaints.get('/', handle, asyncH(async (req, res) => {
  const p: unknown[] = [seeConf(req)]; const where = ['($1::boolean or not c.confidential)'];
  for (const [k, col] of [['status', 'c.status'], ['category', 'c.category']] as const) { const v = req.query[k]; if (typeof v === 'string' && v) { p.push(v); where.push(`${col}=$${p.length}`); } }
  const q = String(req.query.q ?? '').trim(); if (q) { p.push(`%${q}%`); where.push(`(c.subject ilike $${p.length} or c.ref ilike $${p.length})`); }
  res.json((await query(`select c.id, c.ref, c.category, c.subject, c.status, c.confidential, c.created_at, u.display_name as by, a.display_name as assigned, s.full_name as student from complaints c join users u on u.id=c.submitted_by left join users a on a.id=c.assigned_to left join students s on s.id=c.student_id where ${where.join(' and ')} order by (c.status in ('open','in_progress')) desc, c.created_at desc limit 200`, p)).rows);
}));
staffComplaints.get('/handlers', handle, asyncH(async (_req, res) => { res.json((await query(`select distinct u.id, u.display_name from users u join user_roles ur on ur.user_id=u.id join role_permissions rp on rp.role_id=ur.role_id join permissions p on p.id=rp.permission_id where p.code='complaints.handle' and u.status='active' order by 2`)).rows); }));
staffComplaints.get('/:id', handle, asyncH(async (req, res) => {
  const id = idp(req.params.id);
  const c = (await query(`select c.*, u.display_name as by, a.display_name as assigned, s.full_name as student, s.student_code from complaints c join users u on u.id=c.submitted_by left join users a on a.id=c.assigned_to left join students s on s.id=c.student_id where c.id=$1 and ($2::boolean or not c.confidential)`, [id, seeConf(req)])).rows[0];
  if (!c) throw new HttpError(404, 'Not found');
  const updates = (await query('select u.id, u.note, u.internal, u.created_at, a.display_name as author from complaint_updates u left join users a on a.id=u.author_id where u.complaint_id=$1 order by u.created_at', [id])).rows;
  if (c.confidential) await audit(req, 'complaint.confidential_viewed', 'complaint', id);
  res.json({ ...c, updates });
}));
staffComplaints.patch('/:id', handle, asyncH(async (req, res) => {
  const id = idp(req.params.id);
  const b = z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(), assignedTo: z.string().uuid().nullable().optional(), resolution: z.string().trim().max(2000).optional() }).parse(req.body);
  const c = (await query('select * from complaints where id=$1 and ($2::boolean or not confidential)', [id, seeConf(req)])).rows[0];
  if (!c) throw new HttpError(404, 'Not found');
  if (b.assignedTo) { const ok = await query(`select 1 from users u join user_roles ur on ur.user_id=u.id join role_permissions rp on rp.role_id=ur.role_id join permissions p on p.id=rp.permission_id where u.id=$1 and u.status='active' and p.code = $2`, [b.assignedTo, c.confidential ? 'complaints.confidential' : 'complaints.handle']); if (!ok.rowCount) throw new HttpError(400, 'That person cannot handle this complaint.'); }
  if ((b.status === 'resolved' || b.status === 'closed') && !(b.resolution ?? c.resolution)) throw new HttpError(400, 'Please write what was done to resolve it.', { resolution: 'Required' });
  await query(`update complaints set status=coalesce($2,status), assigned_to = case when $3::boolean then $4::uuid else assigned_to end, resolution=coalesce($5,resolution), resolved_at = case when $2 in ('resolved','closed') and resolved_at is null then now() else resolved_at end where id=$1`, [id, b.status ?? null, 'assignedTo' in b, b.assignedTo ?? null, b.resolution ?? null]);
  if (b.status && b.status !== c.status) await note(c.submitted_by, `Your concern is ${b.status.replace('_', ' ')}`, b.resolution ?? c.subject, await homeLink(c.submitted_by, '/portal/complaints', '/family/complaints'));
  if (b.assignedTo && b.assignedTo !== c.assigned_to) await note(b.assignedTo, 'Complaint assigned to you', c.subject, '/portal/complaints');
  await audit(req, 'complaint.updated', 'complaint', id, { status: b.status }); res.json({ ok: true });
}));
staffComplaints.post('/:id/updates', handle, asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = z.object({ note: body, internal: z.boolean() }).parse(req.body);
  const c = (await query('select submitted_by, status from complaints where id=$1 and ($2::boolean or not confidential)', [id, seeConf(req)])).rows[0]; if (!c) throw new HttpError(404, 'Not found');
  await query('insert into complaint_updates (complaint_id, author_id, note, internal) values ($1,$2,$3,$4)', [id, req.auth!.user.id, b.note, b.internal]);
  if (!b.internal) await note(c.submitted_by, 'Update on your concern', b.note, await homeLink(c.submitted_by, '/portal/complaints', '/family/complaints'));
  res.status(201).json({ ok: true });
}));
