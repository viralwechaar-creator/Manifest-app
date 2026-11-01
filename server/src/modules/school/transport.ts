import { Router } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { query, tx } from '../../db';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { notifyFamilies } from './family';

export const transportRouter = Router();
const manage = requirePermission('transport.manage');
const view = (req: any, res: any, next: any) => (req.auth?.permissions.some((p: string) => p === 'transport.manage' || p === 'transport.view') ? next() : next(new HttpError(req.auth ? 403 : 401, 'You do not have permission to do this.')));
const idp = (v: string) => z.coerce.number().int().positive().parse(v);
const D = z.string().date().nullable().optional();
const T = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM').nullable().optional();

// ---- vehicles and drivers ----
transportRouter.get('/vehicles', view, asyncH(async (_req, res) => {
  res.json((await query(`select v.id, v.reg_no, v.kind, v.capacity, v.status, to_char(v.insurance_expiry,'YYYY-MM-DD') as insurance_expiry, to_char(v.fitness_expiry,'YYYY-MM-DD') as fitness_expiry,
    (select name from transport_routes r where r.vehicle_id=v.id limit 1) as route from vehicles v order by v.reg_no`)).rows);
}));
const vehicle = z.object({ regNo: z.string().trim().min(3).max(20), kind: z.string().trim().min(1).max(30).optional(), capacity: z.number().int().min(1).max(200), status: z.enum(['active', 'maintenance', 'retired']).optional(), insuranceExpiry: D, fitnessExpiry: D });
transportRouter.post('/vehicles', manage, asyncH(async (req, res) => {
  const b = vehicle.parse(req.body);
  const r = await query('insert into vehicles (reg_no, kind, capacity, status, insurance_expiry, fitness_expiry) values (upper($1),$2,$3,$4,$5,$6) returning id', [b.regNo, b.kind ?? 'Bus', b.capacity, b.status ?? 'active', b.insuranceExpiry ?? null, b.fitnessExpiry ?? null]);
  await audit(req, 'vehicle.created', 'vehicle', r.rows[0].id); res.status(201).json({ id: r.rows[0].id });
}));
transportRouter.patch('/vehicles/:id', manage, asyncH(async (req, res) => {
  const b = vehicle.partial().parse(req.body); const id = idp(req.params.id);
  if (b.capacity !== undefined) { const used = (await query('select count(*)::int n from student_transport st join transport_routes r on r.id=st.route_id where r.vehicle_id=$1 and st.ended_on is null', [id])).rows[0].n; if (b.capacity < used) throw new HttpError(400, `${used} students already travel on this vehicle.`, { capacity: `At least ${used}` }); }
  const r = await query(`update vehicles set reg_no=coalesce(upper($2),reg_no), kind=coalesce($3,kind), capacity=coalesce($4,capacity), status=coalesce($5,status), insurance_expiry = case when $6::boolean then $7::date else insurance_expiry end, fitness_expiry = case when $8::boolean then $9::date else fitness_expiry end where id=$1`,
    [id, b.regNo ?? null, b.kind ?? null, b.capacity ?? null, b.status ?? null, 'insuranceExpiry' in b, b.insuranceExpiry ?? null, 'fitnessExpiry' in b, b.fitnessExpiry ?? null]);
  if (!r.rowCount) throw new HttpError(404, 'Not found'); await audit(req, 'vehicle.updated', 'vehicle', id); res.json({ ok: true });
}));
transportRouter.get('/drivers', view, asyncH(async (req, res) => {
  const canSee = req.auth!.permissions.includes('transport.manage'); // licence and phone numbers are personal data
  res.json((await query(`select d.id, d.full_name, d.status, ${canSee ? "d.phone, d.license_no, to_char(d.license_expiry,'YYYY-MM-DD') as license_expiry," : ''} (select name from transport_routes r where r.driver_id=d.id limit 1) as route from drivers d order by d.full_name`)).rows);
}));
const driver = z.object({ fullName: z.string().trim().min(1).max(120), phone: z.string().trim().regex(/^[+0-9][0-9 ()-]{6,18}$/, 'Enter a valid phone number'), licenseNo: z.string().trim().min(3).max(30), licenseExpiry: D, status: z.enum(['active', 'inactive']).optional() });
transportRouter.post('/drivers', manage, asyncH(async (req, res) => {
  const b = driver.parse(req.body); const r = await query('insert into drivers (full_name, phone, license_no, license_expiry, status) values ($1,$2,$3,$4,$5) returning id', [b.fullName, b.phone, b.licenseNo, b.licenseExpiry ?? null, b.status ?? 'active']);
  await audit(req, 'driver.created', 'driver', r.rows[0].id); res.status(201).json({ id: r.rows[0].id });
}));
transportRouter.patch('/drivers/:id', manage, asyncH(async (req, res) => {
  const b = driver.partial().parse(req.body);
  const r = await query(`update drivers set full_name=coalesce($2,full_name), phone=coalesce($3,phone), license_no=coalesce($4,license_no), license_expiry = case when $5::boolean then $6::date else license_expiry end, status=coalesce($7,status) where id=$1`, [idp(req.params.id), b.fullName ?? null, b.phone ?? null, b.licenseNo ?? null, 'licenseExpiry' in b, b.licenseExpiry ?? null, b.status ?? null]);
  if (!r.rowCount) throw new HttpError(404, 'Not found'); res.json({ ok: true });
}));

// ---- routes and stops ----
transportRouter.get('/routes', view, asyncH(async (_req, res) => {
  const routes = (await query(`select r.id, r.name, r.vehicle_id, v.reg_no, v.capacity, r.driver_id, d.full_name as driver, r.attendant, r.monthly_fee::float as monthly_fee, r.active,
    (select count(*)::int from student_transport st where st.route_id=r.id and st.ended_on is null) as students from transport_routes r left join vehicles v on v.id=r.vehicle_id left join drivers d on d.id=r.driver_id order by r.name`)).rows;
  const stops = (await query("select id, route_id, name, sequence, to_char(pickup_time,'HH24:MI') as pickup_time, to_char(drop_time,'HH24:MI') as drop_time, (select count(*)::int from student_transport st where st.stop_id=transport_stops.id and st.ended_on is null) as students from transport_stops order by route_id, sequence")).rows;
  res.json(routes.map((r) => ({ ...r, stops: stops.filter((s) => s.route_id === r.id) })));
}));
const route = z.object({ name: z.string().trim().min(1).max(60), vehicleId: z.number().int().positive().nullable().optional(), driverId: z.number().int().positive().nullable().optional(), attendant: z.string().trim().max(120).nullable().optional(), monthlyFee: z.number().min(0).max(100000).optional(), active: z.boolean().optional() });
async function checkResources(c: { query: Function }, id: number | null, b: { vehicleId?: number | null; driverId?: number | null }) {
  if (b.vehicleId) { const v = (await c.query('select status from vehicles where id=$1', [b.vehicleId])).rows[0]; if (!v || v.status !== 'active') throw new HttpError(400, 'That vehicle is not available.'); if ((await c.query('select 1 from transport_routes where vehicle_id=$1 and ($2::int is null or id<>$2)', [b.vehicleId, id])).rowCount) throw new HttpError(409, 'That vehicle already runs another route.'); }
  if (b.driverId) { const d = (await c.query('select status from drivers where id=$1', [b.driverId])).rows[0]; if (!d || d.status !== 'active') throw new HttpError(400, 'That driver is not available.'); if ((await c.query('select 1 from transport_routes where driver_id=$1 and ($2::int is null or id<>$2)', [b.driverId, id])).rowCount) throw new HttpError(409, 'That driver already drives another route.'); }
}
transportRouter.post('/routes', manage, asyncH(async (req, res) => {
  const b = route.parse(req.body); await checkResources({ query }, null, b);
  const r = await query('insert into transport_routes (name, vehicle_id, driver_id, attendant, monthly_fee) values ($1,$2,$3,$4,$5) returning id', [b.name, b.vehicleId ?? null, b.driverId ?? null, b.attendant ?? null, b.monthlyFee ?? 0]);
  await audit(req, 'route.created', 'route', r.rows[0].id); res.status(201).json({ id: r.rows[0].id });
}));
transportRouter.patch('/routes/:id', manage, asyncH(async (req, res) => {
  const b = route.partial().parse(req.body); const id = idp(req.params.id); await checkResources({ query }, id, b);
  if (b.vehicleId) { const cap = (await query('select capacity from vehicles where id=$1', [b.vehicleId])).rows[0].capacity; const used = (await query('select count(*)::int n from student_transport where route_id=$1 and ended_on is null', [id])).rows[0].n; if (used > cap) throw new HttpError(400, `${used} students use this route, more than the vehicle’s ${cap} seats.`); }
  const r = await query(`update transport_routes set name=coalesce($2,name), vehicle_id = case when $3::boolean then $4::int else vehicle_id end, driver_id = case when $5::boolean then $6::int else driver_id end, attendant = case when $7::boolean then $8 else attendant end, monthly_fee=coalesce($9,monthly_fee), active=coalesce($10,active) where id=$1`,
    [id, b.name ?? null, 'vehicleId' in b, b.vehicleId ?? null, 'driverId' in b, b.driverId ?? null, 'attendant' in b, b.attendant ?? null, b.monthlyFee ?? null, b.active ?? null]);
  if (!r.rowCount) throw new HttpError(404, 'Not found'); await audit(req, 'route.updated', 'route', id); res.json({ ok: true });
}));
transportRouter.put('/routes/:id/stops', manage, asyncH(async (req, res) => {
  const id = idp(req.params.id); const { stops } = z.object({ stops: z.array(z.object({ id: z.number().int().positive().optional(), name: z.string().trim().min(1).max(80), pickupTime: T, dropTime: T })).max(60) }).parse(req.body);
  await tx(async (c) => {
    if (!(await c.query('select 1 from transport_routes where id=$1', [id])).rowCount) throw new HttpError(404, 'Not found');
    const keep = stops.filter((s) => s.id).map((s) => s.id);
    const gone = (await c.query('select id from transport_stops where route_id=$1 and id <> all($2::int[])', [id, keep])).rows.map((r) => r.id);
    if (gone.length && (await c.query('select 1 from student_transport where stop_id = any($1::int[]) and ended_on is null', [gone])).rowCount) throw new HttpError(409, 'A stop you removed still has students. Move them first.');
    if (gone.length) { try { await c.query('delete from transport_stops where id = any($1::int[])', [gone]); } catch (e: any) { if (e.code === '23503') throw new HttpError(409, 'A removed stop is used in student travel history. Keep it, or rename it.'); throw e; } }
    await c.query('update transport_stops set sequence = -id where route_id=$1', [id]); // free the sequence numbers before renumbering
    let seq = 1;
    for (const s of stops) { if (s.id) await c.query('update transport_stops set name=$2, sequence=$3, pickup_time=$4, drop_time=$5 where id=$1 and route_id=$6', [s.id, s.name, seq, s.pickupTime ?? null, s.dropTime ?? null, id]); else await c.query('insert into transport_stops (route_id, name, sequence, pickup_time, drop_time) values ($1,$2,$3,$4,$5)', [id, s.name, seq, s.pickupTime ?? null, s.dropTime ?? null]); seq++; }
  });
  await audit(req, 'route.stops_set', 'route', id, { count: stops.length }); res.json({ ok: true });
}));
transportRouter.delete('/routes/:id', manage, asyncH(async (req, res) => {
  const id = idp(req.params.id);
  if ((await query('select 1 from student_transport where route_id=$1 limit 1', [id])).rowCount) throw new HttpError(409, 'Students have travelled on this route. Mark it inactive instead.');
  const r = await query('delete from transport_routes where id=$1', [id]); if (!r.rowCount) throw new HttpError(404, 'Not found'); await audit(req, 'route.deleted', 'route', id); res.json({ ok: true });
}));

// ---- student assignments and the monthly transport fee ----
async function headId(c: PoolClient) { const h = (await c.query("select id from fee_heads where name='Transport'")).rows[0]; return h ? h.id : (await c.query("insert into fee_heads (name) values ('Transport') returning id")).rows[0].id; }
async function raiseTransportFees(c: PoolClient, studentId: number, fee: number) {
  if (fee <= 0) return 0;
  const y = (await c.query('select id, ends_on from academic_years where is_current')).rows[0]; if (!y) return 0;
  const h = await headId(c); const now = new Date(); const end = new Date(y.ends_on); let n = 0;
  for (let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const key = `transport-${d.toISOString().slice(0, 7)}`;
    if ((await c.query('select 1 from fee_charges where student_id=$1 and period_key=$2', [studentId, key])).rowCount) continue;
    await c.query('insert into fee_charges (student_id, item_id, head_id, academic_year_id, period_key, description, amount, due_on) values ($1,null,$2,$3,$4,$5,$6,$7)', [studentId, h, y.id, key, `Transport – ${d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`, fee, d.toISOString().slice(0, 10)]); n++;
  }
  return n;
}
async function endTransport(c: PoolClient, studentId: number) {
  await c.query('update student_transport set ended_on=current_date where student_id=$1 and ended_on is null', [studentId]);
  // Future transport fees that nobody has paid are withdrawn; anything already paid or due stays.
  const r = await c.query(`delete from fee_charges ch where ch.student_id=$1 and ch.period_key like 'transport-%' and ch.due_on > current_date and not exists (select 1 from payment_allocations a where a.charge_id=ch.id)`, [studentId]);
  return r.rowCount ?? 0;
}
/** Gives a student a seat on a route and raises the monthly fee, inside the caller's transaction. */
export async function assignTransport(c: PoolClient, b: { studentId: number; routeId: number; stopId: number; direction?: 'both' | 'pickup' | 'drop' }) {
  if (!(await c.query("select 1 from students where id=$1 and status='active' for update", [b.studentId])).rowCount) throw new HttpError(404, 'Active student not found');
  const r = (await c.query('select r.*, v.capacity from transport_routes r left join vehicles v on v.id=r.vehicle_id where r.id=$1 for update of r', [b.routeId])).rows[0];
  if (!r || !r.active) throw new HttpError(400, 'That route is not running.');
  if (!(await c.query('select 1 from transport_stops where id=$1 and route_id=$2', [b.stopId, b.routeId])).rowCount) throw new HttpError(400, 'That stop is not on this route.');
  const cur = (await c.query('select route_id from student_transport where student_id=$1 and ended_on is null', [b.studentId])).rows[0];
  if (cur) await endTransport(c, b.studentId);
  if (r.capacity) { const used = (await c.query('select count(*)::int n from student_transport where route_id=$1 and ended_on is null', [b.routeId])).rows[0].n; if (used >= r.capacity) throw new HttpError(409, `The vehicle on this route is full (${r.capacity} seats).`); }
  await c.query('insert into student_transport (student_id, route_id, stop_id, direction) values ($1,$2,$3,$4)', [b.studentId, b.routeId, b.stopId, b.direction ?? 'both']);
  return { fees: await raiseTransportFees(c, b.studentId, Number(r.monthly_fee)), route: r.name };
}

transportRouter.post('/assign', manage, asyncH(async (req, res) => {
  const b = z.object({ studentId: z.number().int().positive(), routeId: z.number().int().positive(), stopId: z.number().int().positive(), direction: z.enum(['both', 'pickup', 'drop']).optional() }).parse(req.body);
  const out = await tx((c) => assignTransport(c, b));
  await notifyFamilies('select id from students where id=$1', [b.studentId], 'Transport arranged', `Route ${out.route}. See Transport for stop and timings.`, '/family/transport');
  await audit(req, 'transport.assigned', 'student', b.studentId, { routeId: b.routeId }); res.status(201).json({ feesRaised: out.fees });
}));
transportRouter.post('/unassign/:studentId', manage, asyncH(async (req, res) => {
  const sid = idp(req.params.studentId);
  const n = await tx(async (c) => { if (!(await c.query('select 1 from student_transport where student_id=$1 and ended_on is null', [sid])).rowCount) throw new HttpError(404, 'This student does not use school transport.'); return endTransport(c, sid); });
  await audit(req, 'transport.unassigned', 'student', sid); res.json({ futureFeesRemoved: n });
}));
transportRouter.get('/routes/:id/students', manage, asyncH(async (req, res) => {
  res.json((await query(`select s.id, s.student_code, s.full_name, c.name || ' ' || sec.name as section, ts.name as stop, st.direction,
      (select g.phone from student_guardians sg join guardians g on g.id=sg.guardian_id where sg.student_id=s.id order by sg.is_primary desc limit 1) as parent_phone
    from student_transport st join students s on s.id=st.student_id join transport_stops ts on ts.id=st.stop_id left join sections sec on sec.id=s.section_id left join classes c on c.id=sec.class_id
   where st.route_id=$1 and st.ended_on is null order by ts.sequence, s.full_name`, [idp(req.params.id)])).rows);
}));
// A narrow lookup so transport staff can find a student without general access to student records.
transportRouter.get('/student-search', manage, asyncH(async (req, res) => {
  const q = String(req.query.q ?? '').trim(); if (q.length < 2) return res.json([]);
  res.json((await query(`select s.id, s.student_code, s.full_name, c.name || ' ' || sec.name as section from students s left join sections sec on sec.id=s.section_id left join classes c on c.id=sec.class_id where s.status='active' and (s.full_name ilike $1 or s.student_code ilike $1) order by s.full_name limit 8`, [`%${q}%`])).rows);
}));
transportRouter.get('/students/:id', view, asyncH(async (req, res) => {
  res.json((await query(`select st.route_id, r.name as route, ts.id as stop_id, ts.name as stop, st.direction from student_transport st join transport_routes r on r.id=st.route_id join transport_stops ts on ts.id=st.stop_id where st.student_id=$1 and st.ended_on is null`, [idp(req.params.id)])).rows[0] ?? null);
}));
transportRouter.post('/routes/:id/alert', manage, asyncH(async (req, res) => {
  const { message } = z.object({ message: z.string().trim().min(3).max(300) }).parse(req.body); const id = idp(req.params.id);
  const r = (await query('select name from transport_routes where id=$1', [id])).rows[0]; if (!r) throw new HttpError(404, 'Not found');
  await notifyFamilies('select student_id from student_transport where route_id=$1 and ended_on is null', [id], `Transport: ${r.name}`, message, '/family/transport');
  await audit(req, 'transport.alert_sent', 'route', id); res.json({ ok: true });
}));

/** What a family may see about their child's transport. */
export async function transportFor(studentId: number) {
  return (await query(`select r.name as route, ts.name as stop, to_char(ts.pickup_time,'HH24:MI') as pickup_time, to_char(ts.drop_time,'HH24:MI') as drop_time, st.direction, v.reg_no, d.full_name as driver, d.phone as driver_phone, r.attendant, r.monthly_fee::float as monthly_fee
    from student_transport st join transport_routes r on r.id=st.route_id join transport_stops ts on ts.id=st.stop_id left join vehicles v on v.id=r.vehicle_id left join drivers d on d.id=r.driver_id where st.student_id=$1 and st.ended_on is null`, [studentId])).rows[0] ?? null;
}
