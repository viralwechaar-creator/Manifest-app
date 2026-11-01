import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { audit } from '../lib/audit';
import { requirePermission } from '../middleware/auth';
import { asyncH, HttpError } from '../middleware/errors';

export const inboxRouter = Router();
inboxRouter.use(requirePermission('enquiries.manage'));

const KINDS = {
  enquiries: { table: 'admission_enquiries', statuses: ['new', 'contacted', 'closed'], search: ['student_name', 'parent_name', 'phone', 'email'], hasNotes: true },
  messages: { table: 'contact_messages', statuses: ['new', 'read', 'closed'], search: ['name', 'subject', 'email'], hasNotes: false },
} as const;
const kindOf = (k: string) => { const v = (KINDS as any)[k]; if (!v) throw new HttpError(404, 'Not found'); return v as (typeof KINDS)[keyof typeof KINDS]; };

inboxRouter.get('/:kind', asyncH(async (req, res) => {
  const k = kindOf(req.params.kind);
  const q = String(req.query.q ?? '').trim();
  const status = String(req.query.status ?? '');
  const page = Math.max(1, Number(req.query.page) || 1); const size = 20;
  const where = ['true']; const p: unknown[] = [];
  if (q) { p.push(`%${q}%`); where.push('(' + k.search.map((c) => `${c}::text ilike $${p.length}`).join(' or ') + ')'); }
  if (status) { if (!(k.statuses as readonly string[]).includes(status)) throw new HttpError(400, 'Bad status'); p.push(status); where.push(`status = $${p.length}`); }
  const total = (await query(`select count(*)::int n from ${k.table} where ${where.join(' and ')}`, p)).rows[0].n;
  p.push(size, (page - 1) * size);
  const rows = (await query(`select * from ${k.table} where ${where.join(' and ')} order by created_at desc limit $${p.length - 1} offset $${p.length}`, p)).rows;
  // Viewing personal data is itself an auditable event.
  await audit(req, 'inbox.viewed', req.params.kind, undefined, { count: rows.length });
  res.json({ rows, total, page, size, statuses: k.statuses });
}));

inboxRouter.patch('/:kind/:id', asyncH(async (req, res) => {
  const k = kindOf(req.params.kind);
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const b = z.object({ status: z.enum(k.statuses as unknown as [string, ...string[]]).optional(), notes: z.string().max(4000).optional() }).parse(req.body);
  if (b.notes !== undefined && !k.hasNotes) throw new HttpError(400, 'Notes are not supported here.');
  const sets: string[] = []; const p: unknown[] = [];
  if (b.status) { p.push(b.status); sets.push(`status = $${p.length}`); }
  if (b.notes !== undefined) { p.push(b.notes); sets.push(`notes = $${p.length}`); }
  if (!sets.length) return res.json({ ok: true });
  p.push(id);
  const r = await query(`update ${k.table} set ${sets.join(',')} where id = $${p.length}`, p);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'inbox.updated', req.params.kind, id, b.status ? { status: b.status } : undefined);
  res.json({ ok: true });
}));

inboxRouter.delete('/:kind/:id', asyncH(async (req, res) => {
  const k = kindOf(req.params.kind);
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const r = await query(`delete from ${k.table} where id = $1`, [id]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'inbox.deleted', req.params.kind, id);
  res.json({ ok: true });
}));
