import { Request, Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { notifyUsers } from '../../lib/delivery';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { childOf, familyOnly, isParent, notifyFamilies } from './family';
import { has } from './helpers';

const idp = (v: string) => z.coerce.number().int().positive().parse(v);
const phone = z.string().trim().regex(/^(\+91[\s-]?)?[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number (starting 6 to 9)');
const text = (max: number) => z.string().trim().min(1).max(max);
const normPhone = (v: string) => v.replace(/^\+91[\s-]?/, '').replace(/\D/g, '');
const today = () => new Date().toISOString().slice(0, 10);

// ======================================= Staff side =======================================
export const safetyRouter = Router();

const contactBody = z.object({ fullName: text(120), relation: text(40), phone, priority: z.number().int().min(1).max(9).default(1), notes: z.string().trim().max(300).optional() });

/** Emergency contacts are sensitive: only staff who may see sensitive student details can read them. */
safetyRouter.get('/students/:id/emergency-contacts', requirePermission('students.sensitive'), asyncH(async (req, res) => {
  const id = idp(req.params.id);
  await audit(req, 'student.emergency_contacts_viewed', 'student', id);
  res.json((await query('select id, full_name, relation, phone, priority, notes from emergency_contacts where student_id=$1 order by priority, id', [id])).rows);
}));
safetyRouter.post('/students/:id/emergency-contacts', requirePermission('students.manage'), asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = contactBody.parse(req.body);
  if (!(await query('select 1 from students where id=$1', [id])).rowCount) throw new HttpError(404, 'Student not found');
  if ((await query('select count(*)::int n from emergency_contacts where student_id=$1', [id])).rows[0].n >= 6) throw new HttpError(409, 'A student can have up to 6 emergency contacts.');
  const r = await query('insert into emergency_contacts (student_id, full_name, relation, phone, priority, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id', [id, b.fullName, b.relation, normPhone(b.phone), b.priority, b.notes ?? null, req.auth!.user.id]);
  await audit(req, 'student.emergency_contact_added', 'student', id);
  res.status(201).json({ id: r.rows[0].id });
}));
safetyRouter.delete('/students/:id/emergency-contacts/:cid', requirePermission('students.manage'), asyncH(async (req, res) => {
  const r = await query('delete from emergency_contacts where id=$1 and student_id=$2', [idp(req.params.cid), idp(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'student.emergency_contact_removed', 'student', idp(req.params.id));
  res.json({ ok: true });
}));

// ---- authorised pickups ----
const pickupBody = z.object({ fullName: text(120), relation: text(40), phone, idHint: z.string().trim().max(80).optional(), validUntil: z.string().date().optional() });
const noLongIdNumber = (v?: string) => { if (v && /\d{9,}/.test(v.replace(/\s|-/g, ''))) throw new HttpError(400, 'Do not enter a full ID number. Write only a hint, such as "Driving licence ending 4821".'); };

safetyRouter.get('/pickups', requirePermission('safety.pickups.manage'), asyncH(async (req, res) => {
  const status = String(req.query.status ?? 'pending');
  res.json((await query(
    `select p.id, p.full_name, p.relation, p.phone, p.id_hint, p.status, to_char(p.valid_until,'YYYY-MM-DD') as valid_until, to_char(p.created_at,'YYYY-MM-DD') as requested_on,
            s.id as student_id, s.full_name as student, s.student_code
       from authorized_pickups p join students s on s.id = p.student_id where ($1 = 'all' or p.status = $1) order by p.created_at desc limit 200`, [status])).rows);
}));
safetyRouter.post('/students/:id/pickups', requirePermission('safety.pickups.manage'), asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = pickupBody.parse(req.body); noLongIdNumber(b.idHint);
  if (!(await query('select 1 from students where id=$1', [id])).rowCount) throw new HttpError(404, 'Student not found');
  const r = await query(`insert into authorized_pickups (student_id, full_name, relation, phone, id_hint, valid_until, status, requested_by, decided_by, decided_at) values ($1,$2,$3,$4,$5,$6,'approved',$7,$7,now()) returning id`,
    [id, b.fullName, b.relation, normPhone(b.phone), b.idHint ?? null, b.validUntil ?? null, req.auth!.user.id]);
  await audit(req, 'pickup.added', 'student', id, { pickupId: r.rows[0].id });
  res.status(201).json({ id: r.rows[0].id });
}));
safetyRouter.post('/pickups/:id/decision', requirePermission('safety.pickups.manage'), asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = z.object({ decision: z.enum(['approved', 'rejected', 'revoked']), validUntil: z.string().date().optional() }).parse(req.body);
  const p = (await query('select student_id, full_name, status from authorized_pickups where id=$1', [id])).rows[0];
  if (!p) throw new HttpError(404, 'Not found');
  if (b.decision === 'approved' && p.status !== 'pending') throw new HttpError(409, 'Only a pending request can be approved.');
  if (b.decision === 'revoked' && p.status !== 'approved') throw new HttpError(409, 'Only an approved person can be revoked.');
  await query('update authorized_pickups set status=$2, decided_by=$3, decided_at=now(), valid_until=coalesce($4, valid_until) where id=$1', [id, b.decision, req.auth!.user.id, b.validUntil ?? null]);
  await audit(req, 'pickup.' + b.decision, 'student', p.student_id, { pickupId: id });
  await notifyFamilies('select id from students where id=$1', [p.student_id], b.decision === 'approved' ? 'Pickup person approved' : b.decision === 'rejected' ? 'Pickup request not approved' : 'Pickup person removed', `${p.full_name}: ${b.decision}.`, '/family/safety', 'safety');
  res.json({ ok: true });
}));

// ---- the gate desk ----
safetyRouter.get('/gate/students', requirePermission('safety.gate'), asyncH(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json([]);
  res.json((await query(
    `select s.id, s.student_code, s.full_name, c.name || ' ' || sec.name as section from students s left join sections sec on sec.id=s.section_id left join classes c on c.id=sec.class_id
      where s.status='active' and (s.full_name ilike $1 or s.student_code ilike $1) order by s.full_name limit 15`, [`%${q}%`])).rows);
}));
/** Who may collect this child right now: guardians and approved, unexpired pickup persons. */
safetyRouter.get('/gate/students/:id/collectors', requirePermission('safety.gate'), asyncH(async (req, res) => {
  const id = idp(req.params.id);
  res.json({
    guardians: (await query('select g.id, g.full_name, sg.relation from student_guardians sg join guardians g on g.id=sg.guardian_id where sg.student_id=$1 order by sg.is_primary desc, g.full_name', [id])).rows,
    pickups: (await query(`select id, full_name, relation, phone, id_hint from authorized_pickups where student_id=$1 and status='approved' and (valid_until is null or valid_until >= current_date) order by full_name`, [id])).rows,
  });
}));
safetyRouter.get('/gate', requirePermission('safety.gate'), asyncH(async (req, res) => {
  const date = z.string().date().catch(today()).parse(req.query.date ?? today());
  res.json((await query(
    `select e.id, e.kind, to_char(e.at at time zone 'Asia/Kolkata', 'HH24:MI') as time, e.picked_up_by, e.reason, s.full_name as student, s.student_code, c.name || ' ' || sec.name as section, u.display_name as recorded_by
       from gate_events e join students s on s.id=e.student_id left join sections sec on sec.id=s.section_id left join classes c on c.id=sec.class_id left join users u on u.id=e.recorded_by
      where (e.at at time zone 'Asia/Kolkata')::date = $1::date order by e.at desc`, [date])).rows);
}));
const gateBody = z.object({ studentId: z.number().int().positive(), kind: z.enum(['late_arrival', 'early_departure', 'pickup']), guardianId: z.number().int().positive().optional(), pickupId: z.number().int().positive().optional(), reason: z.string().trim().max(200).optional() });
safetyRouter.post('/gate', requirePermission('safety.gate'), asyncH(async (req, res) => {
  const b = gateBody.parse(req.body);
  const s = (await query("select id, full_name from students where id=$1 and status='active'", [b.studentId])).rows[0];
  if (!s) throw new HttpError(404, 'Student not found');
  let pickedUpBy: string | null = null; let pickupId: number | null = null;
  if (b.kind !== 'late_arrival') {
    // A child may only leave with a guardian or a person the family authorised and the school approved.
    if (b.guardianId) {
      const g = (await query('select g.full_name from student_guardians sg join guardians g on g.id=sg.guardian_id where sg.student_id=$1 and g.id=$2', [b.studentId, b.guardianId])).rows[0];
      if (!g) throw new HttpError(400, 'That person is not a guardian of this student.'); pickedUpBy = g.full_name;
    } else if (b.pickupId) {
      const p = (await query(`select id, full_name from authorized_pickups where id=$1 and student_id=$2 and status='approved' and (valid_until is null or valid_until >= current_date)`, [b.pickupId, b.studentId])).rows[0];
      if (!p) throw new HttpError(400, 'That person is not an approved pickup person for this student (or the approval has expired).'); pickedUpBy = p.full_name; pickupId = p.id;
    } else throw new HttpError(400, 'Choose who is collecting the student: a guardian or an approved pickup person.');
  }
  const r = await query('insert into gate_events (student_id, kind, pickup_id, picked_up_by, reason, recorded_by) values ($1,$2,$3,$4,$5,$6) returning id', [b.studentId, b.kind, pickupId, pickedUpBy, b.reason ?? null, req.auth!.user.id]);
  const label = b.kind === 'late_arrival' ? 'arrived late' : b.kind === 'early_departure' ? 'left school early' : 'was collected';
  const time = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  await notifyFamilies('select id from students where id=$1', [b.studentId], b.kind === 'late_arrival' ? 'Arrived late' : 'Left school', `${s.full_name} ${label} at ${time}${pickedUpBy ? ` with ${pickedUpBy}` : ''}.`, '/family/safety', 'safety');
  await audit(req, 'gate.' + b.kind, 'student', b.studentId);
  res.status(201).json({ id: r.rows[0].id });
}));

// ---- incidents ----
const manageIncidents = (req: Request) => has(req, 'incidents.manage');
const incidentBody = z.object({
  kind: z.enum(['bullying', 'harassment', 'injury', 'safety', 'behaviour', 'health', 'other']),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  location: z.string().trim().max(120).optional(),
  description: text(4000),
  confidential: z.boolean().optional(),
  students: z.array(z.object({ id: z.number().int().positive(), role: z.enum(['affected', 'involved', 'witness']) })).max(20).default([]),
});
/** Narrow search (name, ID, class only) so any staff member can name the students in a report. */
safetyRouter.get('/incidents/student-search', requirePermission('incidents.report'), asyncH(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json([]);
  res.json((await query(`select s.id, s.student_code, s.full_name, c.name || ' ' || sec.name as section from students s left join sections sec on sec.id=s.section_id left join classes c on c.id=sec.class_id where s.status='active' and (s.full_name ilike $1 or s.student_code ilike $1) order by s.full_name limit 12`, [`%${q}%`])).rows);
}));
safetyRouter.get('/incidents', requirePermission('incidents.report'), asyncH(async (req, res) => {
  const all = manageIncidents(req); const status = String(req.query.status ?? '');
  res.json((await query(
    `select i.id, i.code, i.kind, i.severity, i.status, i.confidential, to_char(i.occurred_at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') as occurred_at, left(i.description, 140) as summary, ru.display_name as reported_by, au.display_name as assigned_to,
            (select count(*)::int from incident_students x where x.incident_id=i.id) as students
       from incidents i left join users ru on ru.id=i.reported_by left join users au on au.id=i.assigned_to
      where ($1::boolean or i.reported_by=$2) and ($3 = '' or i.status=$3) order by case i.status when 'open' then 0 when 'investigating' then 1 else 2 end, i.created_at desc limit 200`, [all, req.auth!.user.id, status])).rows);
}));
safetyRouter.get('/incidents/:id', requirePermission('incidents.report'), asyncH(async (req, res) => {
  const id = idp(req.params.id); const all = manageIncidents(req);
  const i = (await query(
    `select i.*, to_char(i.occurred_at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') as occurred_str, ru.display_name as reported_by_name, au.display_name as assigned_to_name
       from incidents i left join users ru on ru.id=i.reported_by left join users au on au.id=i.assigned_to where i.id=$1 and ($2::boolean or i.reported_by=$3)`, [id, all, req.auth!.user.id])).rows[0];
  if (!i) throw new HttpError(404, 'Not found'); // the same answer whether it exists or belongs to someone else
  if (i.confidential) await audit(req, 'incident.viewed', 'incident', id);
  res.json({
    ...i,
    students: (await query('select s.id, s.full_name, s.student_code, x.role from incident_students x join students s on s.id=x.student_id where x.incident_id=$1 order by x.role, s.full_name', [id])).rows,
    notes: all ? (await query("select n.id, n.note, to_char(n.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') as at, u.display_name as author from incident_notes n left join users u on u.id=n.author_id where n.incident_id=$1 order by n.created_at", [id])).rows : [],
  });
}));
safetyRouter.post('/incidents', requirePermission('incidents.report'), asyncH(async (req, res) => {
  const b = incidentBody.parse(req.body);
  const confidential = b.kind === 'bullying' || b.kind === 'harassment' ? true : b.confidential ?? true;
  const id = await tx(async (c) => {
    const r = await c.query('insert into incidents (kind, severity, occurred_at, location, description, confidential, reported_by) values ($1,$2,coalesce($3::timestamptz, now()),$4,$5,$6,$7) returning id, code', [b.kind, b.severity, b.occurredAt ?? null, b.location ?? null, b.description, confidential, req.auth!.user.id]);
    for (const s of b.students) {
      if (!(await c.query('select 1 from students where id=$1', [s.id])).rowCount) throw new HttpError(400, 'One of the students was not found.');
      await c.query('insert into incident_students (incident_id, student_id, role) values ($1,$2,$3) on conflict do nothing', [r.rows[0].id, s.id, s.role]);
    }
    return r.rows[0] as { id: number; code: string };
  });
  const handlers = (await query("select distinct u.id from users u join user_roles ur on ur.user_id=u.id join role_permissions rp on rp.role_id=ur.role_id join permissions p on p.id=rp.permission_id where p.code='incidents.manage' and u.status='active' and u.id <> $1", [req.auth!.user.id])).rows.map((r) => r.id as string);
  await notifyUsers(handlers, `New incident ${id.code}`, `${b.kind} (${b.severity} severity) reported.`, '/portal/safety/incidents', 'safety');
  await audit(req, 'incident.reported', 'incident', id.id);
  res.status(201).json(id);
}));
safetyRouter.patch('/incidents/:id', requirePermission('incidents.manage'), asyncH(async (req, res) => {
  const id = idp(req.params.id);
  const b = z.object({ status: z.enum(['open', 'investigating', 'resolved', 'closed']).optional(), severity: z.enum(['low', 'medium', 'high']).optional(), assignedTo: z.string().uuid().nullable().optional(), resolution: z.string().trim().max(4000).optional() }).parse(req.body);
  if ((b.status === 'resolved' || b.status === 'closed') && !(b.resolution ?? (await query('select resolution from incidents where id=$1', [id])).rows[0]?.resolution)) throw new HttpError(400, 'Write how the incident was resolved before closing it.');
  const r = await query(`update incidents set status=coalesce($2,status), severity=coalesce($3,severity), assigned_to = case when $4::boolean then $5::uuid else assigned_to end, resolution=coalesce($6,resolution), updated_at=now() where id=$1 returning id`,
    [id, b.status ?? null, b.severity ?? null, 'assignedTo' in b, b.assignedTo ?? null, b.resolution ?? null]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'incident.updated', 'incident', id, b);
  res.json({ ok: true });
}));
safetyRouter.post('/incidents/:id/notes', requirePermission('incidents.manage'), asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = z.object({ note: text(2000) }).parse(req.body);
  if (!(await query('select 1 from incidents where id=$1', [id])).rowCount) throw new HttpError(404, 'Not found');
  await query('insert into incident_notes (incident_id, author_id, note) values ($1,$2,$3)', [id, req.auth!.user.id, b.note]);
  res.status(201).json({ ok: true });
}));
/** The school decides whether and what to tell a family. Nothing about other children is ever included automatically. */
safetyRouter.post('/incidents/:id/notify-family', requirePermission('incidents.manage'), asyncH(async (req, res) => {
  const id = idp(req.params.id); const b = z.object({ studentId: z.number().int().positive(), message: text(600) }).parse(req.body);
  if (!(await query('select 1 from incident_students where incident_id=$1 and student_id=$2', [id, b.studentId])).rowCount) throw new HttpError(400, 'That student is not part of this incident.');
  await notifyFamilies('select id from students where id=$1', [b.studentId], 'A message from the school', b.message, '/family/safety', 'safety');
  await audit(req, 'incident.family_notified', 'incident', id, { studentId: b.studentId });
  res.json({ ok: true });
}));

// ======================================= Family side =======================================
export const familySafety = Router();
familySafety.use(requireAuth, familyOnly);
const parentOnly = (req: Request) => { if (!isParent(req)) throw new HttpError(403, 'Only a parent can change this.'); };

familySafety.get('/children/:id/safety', asyncH(async (req, res) => {
  const id = await childOf(req);
  res.json({
    emergencyContacts: (await query('select id, full_name, relation, phone, priority, notes from emergency_contacts where student_id=$1 order by priority, id', [id])).rows,
    pickups: (await query(`select id, full_name, relation, phone, id_hint, status, to_char(valid_until,'YYYY-MM-DD') as valid_until from authorized_pickups where student_id=$1 and status in ('pending','approved') order by created_at desc`, [id])).rows,
    gate: (await query(`select kind, to_char(at at time zone 'Asia/Kolkata','YYYY-MM-DD') as date, to_char(at at time zone 'Asia/Kolkata','HH24:MI') as time, picked_up_by from gate_events where student_id=$1 order by at desc limit 15`, [id])).rows,
  });
}));
familySafety.post('/children/:id/emergency-contacts', asyncH(async (req, res) => {
  parentOnly(req); const id = await childOf(req); const b = contactBody.parse(req.body);
  if ((await query('select count(*)::int n from emergency_contacts where student_id=$1', [id])).rows[0].n >= 6) throw new HttpError(409, 'You can add up to 6 emergency contacts.');
  const r = await query('insert into emergency_contacts (student_id, full_name, relation, phone, priority, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id', [id, b.fullName, b.relation, normPhone(b.phone), b.priority, b.notes ?? null, req.auth!.user.id]);
  res.status(201).json({ id: r.rows[0].id });
}));
familySafety.delete('/children/:id/emergency-contacts/:cid', asyncH(async (req, res) => {
  parentOnly(req); const id = await childOf(req);
  if (!(await query('delete from emergency_contacts where id=$1 and student_id=$2', [idp(req.params.cid), id])).rowCount) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));
familySafety.post('/children/:id/pickups', asyncH(async (req, res) => {
  parentOnly(req); const id = await childOf(req); const b = pickupBody.parse(req.body); noLongIdNumber(b.idHint);
  if ((await query("select count(*)::int n from authorized_pickups where student_id=$1 and status in ('pending','approved')", [id])).rows[0].n >= 8) throw new HttpError(409, 'You can have up to 8 pickup persons. Remove one first.');
  const r = await query('insert into authorized_pickups (student_id, full_name, relation, phone, id_hint, valid_until, requested_by) values ($1,$2,$3,$4,$5,$6,$7) returning id', [id, b.fullName, b.relation, normPhone(b.phone), b.idHint ?? null, b.validUntil ?? null, req.auth!.user.id]);
  const approvers = (await query("select distinct u.id from users u join user_roles ur on ur.user_id=u.id join role_permissions rp on rp.role_id=ur.role_id join permissions p on p.id=rp.permission_id where p.code='safety.pickups.manage' and u.status='active'")).rows.map((x) => x.id as string);
  await notifyUsers(approvers, 'Pickup request to review', `${b.fullName} was added as a pickup person.`, '/portal/safety/pickups', 'safety');
  res.status(201).json({ id: r.rows[0].id, status: 'pending' });
}));
familySafety.delete('/children/:id/pickups/:pid', asyncH(async (req, res) => {
  parentOnly(req); const id = await childOf(req);
  const r = await query("update authorized_pickups set status='revoked', decided_at=now() where id=$1 and student_id=$2 and status in ('pending','approved') returning id", [idp(req.params.pid), id]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));
