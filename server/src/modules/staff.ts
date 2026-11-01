import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { asyncH } from '../middleware/errors';

export const staffRouter = Router();

staffRouter.get('/dashboard', requirePermission('dashboard.view'), asyncH(async (req, res) => {
  const can = req.auth!.permissions;
  const out: Record<string, number> = {};
  const one = async (k: string, sql: string) => { out[k] = (await query(sql)).rows[0].n; };
  if (can.includes('enquiries.manage')) {
    await one('newEnquiries', "select count(*)::int n from admission_enquiries where status='new'");
    await one('newMessages', "select count(*)::int n from contact_messages where status='new'");
    await one('enquiriesThisMonth', "select count(*)::int n from admission_enquiries where created_at >= date_trunc('month', now())");
  }
  if (can.includes('cms.manage')) {
    await one('publishedNews', "select count(*)::int n from news where published");
    await one('upcomingEvents', "select count(*)::int n from events where published and starts_at >= now()");
    await one('galleryPhotos', "select count(*)::int n from gallery_items where published");
  }
  if (can.includes('users.manage')) await one('activeUsers', "select count(*)::int n from users where status='active'");
  if (can.includes('substitutions.manage')) {
    out.openVacancies = (await query(
      `select count(*)::int n from timetable_slots ts join sections sec on sec.id=ts.section_id
        join staff_attendance a on a.staff_id=ts.staff_id and a.date=current_date and a.status in ('absent','on_leave')
        where ts.day = extract(isodow from current_date)::int and sec.academic_year_id=(select id from academic_years where is_current)
          and not exists (select 1 from substitutions sb where sb.slot_id=ts.id and sb.date=current_date)`)).rows[0].n;
  }
  if (can.includes('leave.approve')) out.pendingLeave = (await query("select count(*)::int n from leave_requests where status='pending'")).rows[0].n;
  if (can.includes('attendance.staff.view')) out.staffAbsentToday = (await query("select count(*)::int n from staff_attendance where date=current_date and status in ('absent','on_leave')")).rows[0].n;
  if (can.includes('attendance.students.view_all')) {
    const r = (await query("select count(*) filter (where status in ('present','late'))::int p, count(*)::int n from student_attendance where date=current_date")).rows[0];
    if (r.n > 0) out.studentsPresentPct = Math.round((100 * r.p) / r.n);
  }
  if (can.includes('fees.view')) {
    out.collectedThisMonth = Math.round((await query("select coalesce(sum(amount),0)::float t from payments where status='valid' and paid_on >= date_trunc('month', current_date)")).rows[0].t);
    if (can.includes('fees.collect')) out.paymentsToConfirm = (await query("select count(*)::int n from payment_claims where status='pending'")).rows[0].n;
  }
  if (can.includes('refunds.approve')) out.refundsToApprove = (await query("select count(*)::int n from refunds where status='requested'")).rows[0].n;
  if (can.includes('admissions.review') || can.includes('admissions.view')) out.openApplications = (await query("select count(*)::int n from applications where status in ('submitted','under_review','documents_pending','verified','approved')")).rows[0].n;
  if (can.includes('complaints.handle')) out.openComplaints = (await query("select count(*)::int n from complaints where status in ('open','in_progress') and (not confidential or $1::boolean)", [can.includes('complaints.confidential')])).rows[0].n;
  if (can.includes('messages.use')) out.unreadMessages = (await query("select count(*)::int n from threads t join messages m on m.thread_id=t.id where t.staff_user_id=$1 and m.sender_id <> $1 and m.created_at > coalesce(t.staff_read_at,'epoch')", [req.auth!.user.id])).rows[0].n;
  if (can.includes('library.manage')) { out.booksOut = (await query('select count(*)::int n from loans where returned_on is null')).rows[0].n; out.booksOverdue = (await query('select count(*)::int n from loans where returned_on is null and due_on < current_date')).rows[0].n; }
  if (can.includes('transport.manage') || can.includes('transport.view')) out.studentsOnTransport = (await query('select count(*)::int n from student_transport where ended_on is null')).rows[0].n;
  if (can.includes('hr.manage')) out.newJobApplications = (await query("select count(*)::int n from job_applications where status='new'")).rows[0].n;
  if (can.includes('payroll.approve')) out.payrollToApprove = (await query("select count(*)::int n from payroll_runs where status='draft'")).rows[0].n;
  const school: any = {};
  if (can.includes('students.view_all')) {
    school.studentsByStatus = (await query("select status, count(*)::int n from students group by status order by n desc")).rows;
    school.studentsByClass = (await query(
      `select c.id as class_id, c.name, count(s.id)::int as n
         from classes c left join sections sec on sec.class_id=c.id and sec.academic_year_id = (select id from academic_years where is_current)
         left join students s on s.section_id=sec.id and s.status='active' group by c.id order by c.level`)).rows;
    school.gender = (await query("select gender, count(*)::int n from students where status='active' group by gender")).rows;
    school.sectionLoad = (await query(
      `select c.name || ' ' || sec.name as label, sec.id, sec.capacity, count(s.id)::int as n
         from sections sec join classes c on c.id=sec.class_id left join students s on s.section_id=sec.id and s.status='active'
        where sec.academic_year_id = (select id from academic_years where is_current) group by sec.id, c.name, c.level order by c.level, sec.name`)).rows;
    out.totalStudents = (await query("select count(*)::int n from students where status='active'")).rows[0].n;
    out.newAdmissionsThisMonth = (await query("select count(*)::int n from students where created_at >= date_trunc('month', now())")).rows[0].n;
  }
  if (can.includes('staff.view')) {
    out.totalStaff = (await query("select count(*)::int n from staff where status <> 'left'")).rows[0].n;
    out.teachers = (await query("select count(*)::int n from staff where kind='teacher' and status <> 'left'")).rows[0].n;
    out.staffOnLeave = (await query("select count(*)::int n from staff where status='on_leave'")).rows[0].n;
    school.staffByDepartment = (await query(
      `select coalesce(d.name, 'No department') as name, d.id, count(s.id)::int n from staff s left join departments d on d.id=s.department_id
        where s.status <> 'left' group by d.id, d.name order by n desc`)).rows;
  }
  const recent = can.includes('audit.view')
    ? (await query(`select a.at, a.action, a.entity, u.display_name as user_name from audit_logs a left join users u on u.id=a.user_id order by a.at desc limit 8`)).rows : [];
  const trend = can.includes('enquiries.manage')
    ? (await query(`select to_char(d, 'YYYY-MM-DD') as day, count(e.id)::int as count
                      from generate_series(current_date - 29, current_date, '1 day') d
                      left join admission_enquiries e on e.created_at::date = d::date group by d order by d`)).rows
    : [];
  res.json({ counts: out, enquiryTrend: trend, school, recent });
}));

staffRouter.get('/audit', requirePermission('audit.view'), asyncH(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const page = Math.max(1, Number(req.query.page) || 1); const size = 30;
  const where = ['true']; const p: unknown[] = [];
  if (q) { p.push(`%${q}%`); where.push(`(a.action ilike $${p.length} or a.entity ilike $${p.length} or u.display_name ilike $${p.length})`); }
  const total = (await query(`select count(*)::int n from audit_logs a left join users u on u.id=a.user_id where ${where.join(' and ')}`, p)).rows[0].n;
  p.push(size, (page - 1) * size);
  const rows = (await query(
    `select a.id, a.at, a.action, a.entity, a.entity_id, a.ip, a.details, u.display_name as user_name
       from audit_logs a left join users u on u.id = a.user_id where ${where.join(' and ')}
       order by a.at desc limit $${p.length - 1} offset $${p.length}`, p)).rows;
  res.json({ rows, total, page, size });
}));

// Notifications belong to the signed-in user only.
staffRouter.get('/notifications', requireAuth, asyncH(async (req, res) => {
  const rows = (await query('select id, title, body, link, read_at, created_at from notifications where user_id = $1 order by created_at desc limit 30', [req.auth!.user.id])).rows;
  const unread = (await query('select count(*)::int n from notifications where user_id = $1 and read_at is null', [req.auth!.user.id])).rows[0].n;
  res.json({ rows, unread });
}));

staffRouter.post('/notifications/read', requireAuth, asyncH(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.coerce.number().int()).max(100).optional() }).parse(req.body ?? {});
  await query(`update notifications set read_at = now() where user_id = $1 and read_at is null and ($2::bigint[] is null or id = any($2))`, [req.auth!.user.id, ids ?? null]);
  res.json({ ok: true });
}));
