import { Request, Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { notifyUsers } from '../../lib/delivery';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { childOf, familyOnly, isParent } from './family';
import { requireStaffId } from './helpers';

const idp = (v: string) => z.coerce.number().int().positive().parse(v);
const IST = "at time zone 'Asia/Kolkata'";
const fmt = (d: Date) => d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

// ================= Teacher side =================
export const meetingsRouter = Router();
const manage = requirePermission('meetings.manage');

meetingsRouter.get('/slots', manage, asyncH(async (req, res) => {
  const sid = await requireStaffId(req);
  res.json((await query(
    `select m.id, m.starts_at, to_char(m.starts_at ${IST}, 'YYYY-MM-DD') as date, to_char(m.starts_at ${IST}, 'HH24:MI') as time, m.minutes, m.mode, m.location, m.status,
            b.id as booking_id, b.status as booking_status, b.agenda, b.teacher_notes, s.full_name as student, s.student_code, u.display_name as parent
       from meeting_slots m left join meeting_bookings b on b.slot_id=m.id and b.status in ('booked','completed') left join students s on s.id=b.student_id left join users u on u.id=b.booked_by
      where m.staff_id=$1 and m.starts_at >= now() - interval '14 days' order by m.starts_at`, [sid])).rows);
}));
const slotBody = z.object({
  startsAt: z.string().datetime({ offset: true }),
  minutes: z.number().int().min(5).max(120).default(15),
  count: z.number().int().min(1).max(24).default(1),
  mode: z.enum(['in_person', 'phone', 'video']).default('in_person'),
  location: z.string().trim().max(160).optional(),
});
meetingsRouter.post('/slots', manage, asyncH(async (req, res) => {
  const sid = await requireStaffId(req); const b = slotBody.parse(req.body);
  const start = new Date(b.startsAt);
  if (start.getTime() < Date.now()) throw new HttpError(400, 'Choose a time in the future.');
  if (start.getTime() > Date.now() + 120 * 86400000) throw new HttpError(400, 'Meetings can be offered up to 120 days ahead.');
  let created = 0;
  await tx(async (c) => {
    for (let i = 0; i < b.count; i++) {
      const at = new Date(start.getTime() + i * b.minutes * 60000);
      created += (await c.query('insert into meeting_slots (staff_id, starts_at, minutes, mode, location) values ($1,$2,$3,$4,$5) on conflict (staff_id, starts_at) do nothing', [sid, at.toISOString(), b.minutes, b.mode, b.location ?? null])).rowCount ?? 0;
    }
  });
  await audit(req, 'meetings.slots_created', 'staff', sid, { created });
  res.status(201).json({ created });
}));
meetingsRouter.delete('/slots/:id', manage, asyncH(async (req, res) => {
  const sid = await requireStaffId(req); const id = idp(req.params.id);
  const slot = (await query('select starts_at from meeting_slots where id=$1 and staff_id=$2 and status=$3', [id, sid, 'open'])).rows[0];
  if (!slot) throw new HttpError(404, 'Not found');
  const booked = (await query("update meeting_bookings set status='cancelled', cancelled_at=now() where slot_id=$1 and status='booked' returning booked_by", [id])).rows;
  await query("update meeting_slots set status='cancelled' where id=$1", [id]);
  await notifyUsers(booked.map((r) => r.booked_by), 'Meeting cancelled', `The teacher cancelled the meeting on ${fmt(new Date(slot.starts_at))}. Please book another time.`, '/family/meetings', 'messages');
  res.json({ ok: true, notified: booked.length });
}));
meetingsRouter.patch('/bookings/:id', manage, asyncH(async (req, res) => {
  const sid = await requireStaffId(req); const id = idp(req.params.id);
  const b = z.object({ status: z.literal('completed').optional(), notes: z.string().trim().max(1000).optional() }).parse(req.body);
  const r = await query(`update meeting_bookings b set status=coalesce($3,b.status), teacher_notes=coalesce($4,b.teacher_notes) from meeting_slots m where b.id=$1 and m.id=b.slot_id and m.staff_id=$2 and b.status in ('booked','completed') returning b.id`, [id, sid, b.status ?? null, b.notes ?? null]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));

// ================= Family side =================
export const familyMeetings = Router();
familyMeetings.use(requireAuth, familyOnly);
const parentOnly = (req: Request) => { if (!isParent(req)) throw new HttpError(403, 'Only a parent can book meetings.'); };

/** Open times from this child's own teachers (class teacher and subject teachers), plus this child's bookings. */
familyMeetings.get('/children/:id/meetings', asyncH(async (req, res) => {
  const id = await childOf(req);
  const teachers = `select t.id from students s join sections sec on sec.id=s.section_id join staff t on (t.id=sec.class_teacher_id or t.id in (select staff_id from teacher_assignments where section_id=sec.id)) where s.id=$1`;
  res.json({
    open: (await query(
      `select m.id, m.starts_at, to_char(m.starts_at ${IST}, 'YYYY-MM-DD') as date, to_char(m.starts_at ${IST}, 'HH24:MI') as time, m.minutes, m.mode, m.location, t.full_name as teacher
         from meeting_slots m join staff t on t.id=m.staff_id
        where m.status='open' and m.starts_at > now() + interval '1 hour' and m.staff_id in (${teachers})
          and not exists (select 1 from meeting_bookings b where b.slot_id=m.id and b.status='booked') order by m.starts_at limit 200`, [id])).rows,
    mine: (await query(
      `select b.id, b.status, b.agenda, m.starts_at, to_char(m.starts_at ${IST}, 'YYYY-MM-DD') as date, to_char(m.starts_at ${IST}, 'HH24:MI') as time, m.minutes, m.mode, m.location, t.full_name as teacher
         from meeting_bookings b join meeting_slots m on m.id=b.slot_id join staff t on t.id=m.staff_id
        where b.student_id=$1 and b.status in ('booked','completed') order by m.starts_at desc limit 30`, [id])).rows,
  });
}));
familyMeetings.post('/children/:id/meetings', asyncH(async (req, res) => {
  parentOnly(req); const id = await childOf(req);
  const b = z.object({ slotId: z.number().int().positive(), agenda: z.string().trim().max(300).optional() }).parse(req.body);
  const slot = (await query(
    `select m.id, m.starts_at, m.staff_id, t.user_id as teacher_user, t.full_name as teacher from meeting_slots m join staff t on t.id=m.staff_id
      where m.id=$1 and m.status='open' and m.starts_at > now() + interval '1 hour'
        and m.staff_id in (select t2.id from students s join sections sec on sec.id=s.section_id join staff t2 on (t2.id=sec.class_teacher_id or t2.id in (select staff_id from teacher_assignments where section_id=sec.id)) where s.id=$2)`, [b.slotId, id])).rows[0];
  if (!slot) throw new HttpError(404, 'That time is no longer available.');
  if ((await query(`select 1 from meeting_bookings b join meeting_slots m on m.id=b.slot_id where b.student_id=$1 and b.status='booked' and m.staff_id=$2 and m.starts_at > now()`, [id, slot.staff_id])).rowCount) throw new HttpError(409, 'You already have an upcoming meeting with this teacher. Cancel it first to choose another time.');
  try {
    await query('insert into meeting_bookings (slot_id, student_id, booked_by, agenda) values ($1,$2,$3,$4)', [b.slotId, id, req.auth!.user.id, b.agenda ?? null]);
  } catch (e: any) {
    if (e?.code === '23505') throw new HttpError(409, 'Someone just booked that time. Please choose another.'); // two parents racing for one slot: exactly one wins
    throw e;
  }
  const kid = (await query('select full_name from students where id=$1', [id])).rows[0].full_name;
  if (slot.teacher_user) await notifyUsers([slot.teacher_user], 'Parent meeting booked', `${kid}'s parent booked ${fmt(new Date(slot.starts_at))}${b.agenda ? `: ${b.agenda}` : ''}.`, '/portal/meetings', 'messages');
  res.status(201).json({ ok: true, teacher: slot.teacher, startsAt: slot.starts_at });
}));
familyMeetings.delete('/children/:id/meetings/:bid', asyncH(async (req, res) => {
  parentOnly(req); const id = await childOf(req);
  const r = await query(
    `update meeting_bookings b set status='cancelled', cancelled_at=now() from meeting_slots m where b.id=$1 and b.student_id=$2 and b.status='booked' and m.id=b.slot_id returning m.starts_at, (select user_id from staff where id=m.staff_id) as teacher_user`, [idp(req.params.bid), id]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  if (r.rows[0].teacher_user) await notifyUsers([r.rows[0].teacher_user], 'Parent meeting cancelled', `A parent cancelled the meeting on ${fmt(new Date(r.rows[0].starts_at))}. The time is open again.`, '/portal/meetings', 'messages');
  res.json({ ok: true });
}));
