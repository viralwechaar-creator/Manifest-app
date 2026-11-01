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
  const trend = can.includes('enquiries.manage')
    ? (await query(`select to_char(d, 'YYYY-MM-DD') as day, count(e.id)::int as count
                      from generate_series(current_date - 29, current_date, '1 day') d
                      left join admission_enquiries e on e.created_at::date = d::date group by d order by d`)).rows
    : [];
  res.json({ counts: out, enquiryTrend: trend });
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
