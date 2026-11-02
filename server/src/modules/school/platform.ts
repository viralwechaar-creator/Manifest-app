import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db';
import { audit } from '../../lib/audit';
import { deliveryConfigured, processOutbox } from '../../lib/delivery';
import { config } from '../../config';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';

const idp = (v: string) => z.coerce.number().int().positive().parse(v);

// ============ Notification preferences (any signed-in person, for themselves only) ============
export const prefsRouter = Router();
prefsRouter.use(requireAuth);
export const MUTABLE = ['fees', 'attendance', 'academics', 'transport', 'messages', 'general'] as const;
prefsRouter.get('/', asyncH(async (req, res) => {
  const p = (await query('select email, sms, whatsapp, muted_categories from notification_prefs where user_id=$1', [req.auth!.user.id])).rows[0] ?? { email: true, sms: false, whatsapp: false, muted_categories: [] };
  res.json({ ...p, categories: MUTABLE, providerConfigured: deliveryConfigured() });
}));
prefsRouter.put('/', asyncH(async (req, res) => {
  const b = z.object({ email: z.boolean(), sms: z.boolean(), whatsapp: z.boolean(), mutedCategories: z.array(z.enum(MUTABLE)).max(MUTABLE.length) }).parse(req.body);
  await query(
    `insert into notification_prefs (user_id, email, sms, whatsapp, muted_categories, updated_at) values ($1,$2,$3,$4,$5,now())
     on conflict (user_id) do update set email=$2, sms=$3, whatsapp=$4, muted_categories=$5, updated_at=now()`, [req.auth!.user.id, b.email, b.sms, b.whatsapp, b.mutedCategories]);
  await audit(req, 'notification_prefs.updated', 'user', req.auth!.user.id);
  res.json({ ok: true }); // safety messages are always delivered; they are not in the list that can be muted
}));

// ============ Delivery log for administrators ============
export const outboxRouter = Router();
const manage = requirePermission('notifications.manage');
outboxRouter.get('/', manage, asyncH(async (req, res) => {
  const status = String(req.query.status ?? '');
  res.json({
    provider: config.NOTIFY_PROVIDER, configured: deliveryConfigured(),
    counts: (await query('select status, count(*)::int as n from outbox group by 1')).rows,
    rows: (await query(
      `select o.id, o.channel, o.to_address, o.category, o.status, o.attempts, o.last_error, to_char(o.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') as created, to_char(o.sent_at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') as sent, u.display_name as person
         from outbox o left join users u on u.id=o.user_id where ($1 = '' or o.status=$1) order by o.id desc limit 150`, [status])).rows
      .map((r) => ({ ...r, to_address: r.channel === 'email' ? r.to_address.replace(/^(.).*(@.*)$/, '$1***$2') : r.to_address.replace(/^(.*)(\d{3})$/, '******$2') })), // mask contact details in the log
  });
}));
outboxRouter.post('/:id/retry', manage, asyncH(async (req, res) => {
  const r = await query("update outbox set status='queued', attempts=0, next_attempt_at=now(), last_error=null where id=$1 and status='failed' returning id", [idp(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'Only a failed message can be retried.');
  res.json({ ok: true });
}));
outboxRouter.post('/process', manage, asyncH(async (req, res) => {
  if (!deliveryConfigured()) throw new HttpError(409, 'No delivery provider is configured yet. See docs/NOTIFICATIONS.md.');
  const r = await processOutbox(100); await audit(req, 'outbox.processed', 'outbox', undefined, r); res.json(r);
}));

// ============ Privacy: a student's personal data, on request (DPDP access) ============
export const privacyRouter = Router();
privacyRouter.get('/students/:id/export', requirePermission('privacy.export'), asyncH(async (req, res) => {
  const id = idp(req.params.id);
  const student = (await query(`select s.id, s.student_code, s.full_name, to_char(s.date_of_birth,'YYYY-MM-DD') as date_of_birth, s.gender, to_char(s.admission_date,'YYYY-MM-DD') as admission_date, s.status, s.address, s.health_notes, c.name || ' ' || sec.name as class_section from students s left join sections sec on sec.id=s.section_id left join classes c on c.id=sec.class_id where s.id=$1`, [id])).rows[0];
  if (!student) throw new HttpError(404, 'Student not found');
  const q = async (sql: string) => (await query(sql, [id])).rows;
  const data = {
    exportedAt: new Date().toISOString(), note: 'Personal data held about this student. Financial records are included because they are linked to the student.',
    student,
    guardians: await q("select g.full_name, g.phone, g.email, sg.relation, sg.is_primary from student_guardians sg join guardians g on g.id=sg.guardian_id where sg.student_id=$1"),
    emergencyContacts: await q('select full_name, relation, phone, priority, notes from emergency_contacts where student_id=$1'),
    authorizedPickups: await q("select full_name, relation, phone, id_hint, status, to_char(valid_until,'YYYY-MM-DD') as valid_until from authorized_pickups where student_id=$1"),
    classHistory: await q("select ay.label as year, c.name || ' ' || sec.name as class_section, to_char(e.started_on,'YYYY-MM-DD') as started_on, to_char(e.ended_on,'YYYY-MM-DD') as ended_on, e.outcome from enrolments e join academic_years ay on ay.id=e.academic_year_id join sections sec on sec.id=e.section_id join classes c on c.id=sec.class_id where e.student_id=$1 order by ay.starts_on"),
    statusLog: await q("select to_char(changed_at,'YYYY-MM-DD HH24:MI') as at, new_status, reason from student_status_log where student_id=$1 order by changed_at"),
    attendance: await q("select to_char(date,'YYYY-MM-DD') as date, status from student_attendance where student_id=$1 order by date"),
    marks: await q("select e.name as exam, sub.name as subject, m.marks::float as marks, m.absent, x.max_marks::float as max_marks from marks m join exam_subjects x on x.id=m.exam_subject_id join exams e on e.id=x.exam_id join subjects sub on sub.id=x.subject_id where m.student_id=$1 order by e.created_at, sub.name"),
    remarks: await q("select to_char(created_at,'YYYY-MM-DD') as date, kind, text as remark, visible_to_parent from student_remarks where student_id=$1 order by created_at"),
    activities: await q("select kind, title, level, to_char(occurred_on,'YYYY-MM-DD') as occurred_on, result, description from student_activities where student_id=$1 order by occurred_on"),
    observations: await q("select category, note, shared_with_family, to_char(created_at,'YYYY-MM-DD') as date from student_observations where student_id=$1 order by created_at"),
    gateEvents: await q("select kind, to_char(at,'YYYY-MM-DD HH24:MI') as at, picked_up_by, reason from gate_events where student_id=$1 order by at"),
    leaveRequests: await q("select to_char(from_date,'YYYY-MM-DD') as from_date, to_char(to_date,'YYYY-MM-DD') as to_date, reason, status from student_leave_requests where student_id=$1 order by from_date"),
    feeCharges: await q("select c.description, c.amount::float as amount, to_char(c.due_on,'YYYY-MM-DD') as due_on from fee_charges c where c.student_id=$1 order by c.due_on"),
    payments: await q("select to_char(p.paid_on,'YYYY-MM-DD') as paid_on, p.amount::float as amount, p.mode, p.receipt_no, p.status from payments p where p.student_id=$1 order by p.paid_on"),
    transport: await q("select r.name as route, st.name as stop, t.direction from student_transport t join transport_routes r on r.id=t.route_id join transport_stops st on st.id=t.stop_id where t.student_id=$1 and t.ended_on is null"),
  };
  await audit(req, 'privacy.student_export', 'student', id);
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="student-${student.student_code}-data.json"`, 'Cache-Control': 'private, no-store' });
  res.send(JSON.stringify(data, null, 2));
}));
