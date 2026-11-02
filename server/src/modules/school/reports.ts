import { Router } from 'express';
import { query } from '../../db';
import { requirePermission } from '../../middleware/auth';
import { asyncH } from '../../middleware/errors';

/** School-wide reports. Every number comes from stored records; nothing is estimated. */
export const reportsRouter = Router();
const view = requirePermission('reports.view');
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

reportsRouter.get('/workload', view, asyncH(async (_req, res) => {
  const rows = (await query(
    `select t.id, t.full_name, t.staff_code, t.designation,
            (select count(*)::int from timetable_slots x where x.staff_id=t.id) as periods_per_week,
            (select count(distinct x.section_id)::int from timetable_slots x where x.staff_id=t.id) as sections,
            (select count(*)::int from assignments a where a.staff_id=t.id and a.created_at >= now() - interval '30 days') as homework_set_30d,
            (select count(*)::int from substitutions s where s.substitute_staff_id=t.id and s.date >= current_date - 30) as substitutions_30d,
            (select count(*)::int from lesson_plans l where l.staff_id=t.id and l.planned_on >= current_date - 30 and l.planned_on <= current_date) as lessons_planned_30d,
            (select count(*)::int from sections s where s.class_teacher_id=t.id) as class_teacher_of
       from staff t where t.status='active' and t.kind='teacher' order by periods_per_week desc, t.full_name`)).rows;
  const total = rows.reduce((a, r) => a + r.periods_per_week, 0);
  res.json({ rows, averagePeriodsPerWeek: rows.length ? Math.round((total / rows.length) * 10) / 10 : 0, teachers: rows.length });
}));

reportsRouter.get('/enrolment', view, asyncH(async (_req, res) => {
  const strength = (await query(
    `select c.name as class, sec.name as section, sec.capacity, count(s.id) filter (where s.status='active')::int as students
       from sections sec join classes c on c.id=sec.class_id join academic_years ay on ay.id=sec.academic_year_id and ay.is_current
       left join students s on s.section_id=sec.id group by c.name, c.level, sec.name, sec.capacity order by c.level, sec.name`)).rows.map((r) => ({ ...r, fillPct: pct(r.students, r.capacity) }));
  const byYear = (await query(
    `select ay.label as year, count(*)::int as enrolled,
            count(*) filter (where e.outcome='promoted')::int as promoted, count(*) filter (where e.outcome='repeated')::int as repeated, count(*) filter (where e.outcome='completed')::int as completed,
            count(*) filter (where e.outcome='transferred')::int as transferred, count(*) filter (where e.outcome='withdrawn')::int as withdrawn
       from enrolments e join academic_years ay on ay.id=e.academic_year_id group by ay.label, ay.starts_on order by ay.starts_on desc limit 6`)).rows
    .map((r) => ({ ...r, retentionPct: pct(r.promoted + r.repeated + r.completed, r.promoted + r.repeated + r.completed + r.transferred + r.withdrawn) }));
  const admissions = (await query(
    `select to_char(date_trunc('month', admission_date), 'YYYY-MM') as month, count(*)::int as n from students where admission_date >= date_trunc('month', current_date) - interval '11 months' group by 1 order by 1`)).rows;
  const leavers = (await query(
    `select to_char(date_trunc('month', changed_at), 'YYYY-MM') as month, count(*)::int as n from student_status_log where new_status in ('transferred','withdrawn') and changed_at >= date_trunc('month', current_date) - interval '11 months' group by 1 order by 1`)).rows;
  res.json({ strength, byYear, admissions, leavers, totals: { active: strength.reduce((a, r) => a + r.students, 0), capacity: strength.reduce((a, r) => a + r.capacity, 0) } });
}));

reportsRouter.get('/transport', view, asyncH(async (_req, res) => {
  const routes = (await query(
    `select r.id, r.name, v.reg_no, v.capacity, (select count(*)::int from transport_stops st where st.route_id=r.id) as stops,
            (select count(*)::int from student_transport t join students s on s.id=t.student_id where t.route_id=r.id and t.ended_on is null and s.status='active') as students
       from transport_routes r left join vehicles v on v.id=r.vehicle_id order by r.name`)).rows.map((r) => ({ ...r, utilisationPct: r.capacity ? pct(r.students, r.capacity) : null, overCapacity: r.capacity ? r.students > r.capacity : false }));
  const expiring = (await query(
    `select reg_no, 'Insurance' as what, to_char(insurance_expiry,'YYYY-MM-DD') as on_date from vehicles where status='active' and insurance_expiry is not null and insurance_expiry <= current_date + 30
     union all select reg_no, 'Fitness', to_char(fitness_expiry,'YYYY-MM-DD') from vehicles where status='active' and fitness_expiry is not null and fitness_expiry <= current_date + 30 order by 3`)).rows;
  const on = (await query(`select count(distinct t.student_id)::int n from student_transport t join students s on s.id=t.student_id where t.ended_on is null and s.status='active'`)).rows[0].n;
  const active = (await query("select count(*)::int n from students where status='active'")).rows[0].n;
  res.json({ routes, expiring, studentsOnTransport: on, activeStudents: active });
}));

reportsRouter.get('/safety', view, asyncH(async (_req, res) => {
  res.json({
    incidentsByKind: (await query("select kind, count(*)::int as n from incidents where created_at >= now() - interval '90 days' group by 1 order by 2 desc")).rows,
    incidentsByStatus: (await query("select status, count(*)::int as n from incidents group by 1")).rows,
    openHigh: (await query("select count(*)::int n from incidents where status in ('open','investigating') and severity='high'")).rows[0].n,
    gateByWeek: (await query(`select to_char(date_trunc('week', at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD') as week, kind, count(*)::int as n from gate_events where at >= now() - interval '8 weeks' group by 1,2 order by 1`)).rows,
    pendingPickups: (await query("select count(*)::int n from authorized_pickups where status='pending'")).rows[0].n,
  });
}));
