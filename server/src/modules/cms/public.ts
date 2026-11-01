import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../../db';
import { notifyPermission } from '../../lib/audit';
import { asyncH, HttpError } from '../../middleware/errors';
import { entityByKey } from './entities';

export const publicRouter = Router();

publicRouter.use((_req, res, next) => { res.set('Cache-Control', 'public, max-age=30'); next(); });

publicRouter.get('/settings', asyncH(async (_req, res) => {
  const rows = (await query('select key, value from site_settings')).rows;
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}));

// Only specific, published content types are ever exposed here; no personal data lives in them.
publicRouter.get('/content/:entity', asyncH(async (req, res) => {
  const e = entityByKey(req.params.entity);
  if (!e) throw new HttpError(404, 'Not found');
  const where = ['published = true']; const p: unknown[] = [];
  if (e.publicWhere) where.push(e.publicWhere);
  for (const f of e.filters ?? []) {
    const v = req.query[f];
    if (typeof v === 'string' && v !== '') { p.push(v); where.push(`${f}::text = $${p.length}`); }
  }
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  if (q && e.search.length) { p.push(`%${q}%`); where.push('(' + e.search.map((c) => `${c}::text ilike $${p.length}`).join(' or ') + ')'); }
  if (typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}/.test(req.query.from) && e.key === 'events') { p.push(req.query.from); where.push(`starts_at >= $${p.length}`); }
  if (typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}/.test(req.query.to) && e.key === 'events') { p.push(req.query.to); where.push(`starts_at < $${p.length}`); }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  p.push(limit);
  const cols = e.key === 'news' && req.query.list ? 'id, title, kind, summary, image_url, pinned, published_at' : '*';
  const rows = (await query(`select ${cols} from ${e.table} where ${where.join(' and ')} order by ${e.publicOrder} limit $${p.length}`, p)).rows;
  res.json(rows.map(({ published, created_at, updated_at, ...rest }) => rest));
}));

publicRouter.get('/content/:entity/:id', asyncH(async (req, res) => {
  const e = entityByKey(req.params.entity);
  if (!e) throw new HttpError(404, 'Not found');
  const id = e.pk === 'slug' ? req.params.id : Number(req.params.id);
  if (e.pk === 'id' && (!Number.isInteger(id) || (id as number) < 1)) throw new HttpError(404, 'Not found');
  const where = [`${e.pk} = $1`, 'published = true']; if (e.publicWhere) where.push(e.publicWhere);
  const r = await query(`select * from ${e.table} where ${where.join(' and ')}`, [id]);
  if (!r.rows[0]) throw new HttpError(404, 'Not found');
  const { published, created_at, updated_at, ...rest } = r.rows[0];
  res.json(rest);
}));

// ---- Public forms ----
const formLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many submissions. Please try again later.' } });
const phone = z.string().trim().regex(/^[+0-9][0-9 ()-]{6,18}$/, 'Enter a valid phone number');
const optEmail = z.string().trim().email('Enter a valid email').max(200).optional().or(z.literal(''));

async function notice() {
  const r = await query("select key, value from site_settings where key in ('privacy_notice_version','privacy_notice_text')");
  const m = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  return { version: m.privacy_notice_version || '1' };
}

publicRouter.post('/enquiries', formLimiter, asyncH(async (req, res) => {
  const b = z.object({
    studentName: z.string().trim().min(1).max(120),
    gradeApplying: z.string().trim().min(1).max(40),
    parentName: z.string().trim().min(1).max(120),
    phone, email: optEmail,
    message: z.string().trim().max(2000).optional(),
    consent: z.literal(true, { message: 'Please confirm to continue' }),
    website: z.string().max(0).optional(), // honeypot: real users never fill this
  }).safeParse(req.body);
  if (!b.success) {
    if ((req.body as any)?.website) return res.json({ ok: true }); // silently drop bots
    throw b.error;
  }
  const d = b.data; const n = await notice();
  const r = await query(
    `insert into admission_enquiries (student_name, grade_applying, parent_name, phone, email, message, consent_purpose, consent_notice_version)
     values ($1,$2,$3,$4,$5,$6,'Respond to an admission enquiry',$7) returning id`,
    [d.studentName, d.gradeApplying, d.parentName, d.phone, d.email || null, d.message || null, n.version]);
  await notifyPermission('enquiries.manage', 'New admission enquiry', `Enquiry for ${d.gradeApplying}`, `/portal/inbox/enquiries?open=${r.rows[0].id}`);
  res.status(201).json({ ok: true });
}));

publicRouter.post('/contact', formLimiter, asyncH(async (req, res) => {
  const b = z.object({
    name: z.string().trim().min(1).max(120), email: optEmail, phone: phone.optional().or(z.literal('')),
    subject: z.string().trim().min(1).max(160), message: z.string().trim().min(1).max(4000),
    consent: z.literal(true, { message: 'Please confirm to continue' }),
    website: z.string().max(0).optional(),
  }).safeParse(req.body);
  if (!b.success) {
    if ((req.body as any)?.website) return res.json({ ok: true });
    throw b.error;
  }
  const d = b.data;
  if (!d.email && !d.phone) throw new HttpError(400, 'Please give an email or phone number so we can reply.', { email: 'Email or phone needed' });
  const n = await notice();
  const r = await query(
    `insert into contact_messages (name, email, phone, subject, message, consent_purpose, consent_notice_version)
     values ($1,$2,$3,$4,$5,'Respond to a message sent through the contact form',$6) returning id`,
    [d.name, d.email || null, d.phone || null, d.subject, d.message, n.version]);
  await notifyPermission('enquiries.manage', 'New contact message', d.subject, `/portal/inbox/messages?open=${r.rows[0].id}`);
  res.status(201).json({ ok: true });
}));
