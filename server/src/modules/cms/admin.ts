import { Request, Router } from 'express';
import { query } from '../../db';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { asyncH, HttpError } from '../../middleware/errors';
import { Entity, entityByKey, ENTITIES, schemaFor, SETTINGS_FIELDS, zodFor } from './entities';
import { z } from 'zod';

export const cmsRouter = Router();

// Describes every editable entity so the admin UI can build its forms from one source of truth.
cmsRouter.get('/schema', requirePermission('dashboard.view'), (req, res) => {
  const can = req.auth!.permissions;
  res.json({
    entities: can.includes('cms.manage') ? ENTITIES.map(({ key, label, group, pk, fixed, fields, list, filters }) => ({ key, label, group, pk, fixed: !!fixed, fields, list, filters: filters ?? [] })) : [],
    settings: can.includes('settings.manage') ? SETTINGS_FIELDS : [],
  });
});

function getEntity(req: Request): Entity {
  const e = entityByKey(req.params.entity);
  if (!e) throw new HttpError(404, 'Unknown content type');
  return e;
}
function pkValue(e: Entity, raw: string) {
  if (e.pk === 'slug') {
    if (!/^[a-z0-9-]{1,60}$/.test(raw)) throw new HttpError(404, 'Not found');
    return raw;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Not found');
  return n;
}
// Columns that are NOT NULL with a database default: an empty value means "use the default / leave as is".
const HAS_DEFAULT = new Set(['sort', 'published', 'pinned', 'published_at', 'subjects']);

function clean(e: Entity, body: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const f of e.fields) {
    if (f.readonly || !(f.name in body)) continue;
    let v = body[f.name];
    if (v === '' && !f.required) v = null;
    if (v === null && HAS_DEFAULT.has(f.name)) continue;
    out[f.name] = v;
  }
  return out;
}

const cms = requirePermission('cms.manage');

cmsRouter.get('/entities/:entity', cms, asyncH(async (req, res) => {
  const e = getEntity(req);
  const q = String(req.query.q ?? '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = 20;
  const where = ['true']; const p: unknown[] = [];
  if (q) { p.push(`%${q}%`); where.push('(' + e.search.map((c) => `${c}::text ilike $${p.length}`).join(' or ') + ')'); }
  for (const f of e.filters ?? []) {
    const v = req.query[f];
    if (typeof v === 'string' && v !== '') { p.push(v); where.push(`${f}::text = $${p.length}`); }
  }
  const total = (await query(`select count(*)::int n from ${e.table} where ${where.join(' and ')}`, p)).rows[0].n;
  p.push(size, (page - 1) * size);
  const rows = (await query(`select * from ${e.table} where ${where.join(' and ')} order by ${e.adminOrder} limit $${p.length - 1} offset $${p.length}`, p)).rows;
  res.json({ rows, total, page, size });
}));

// Options for 'ref' dropdowns.
cmsRouter.get('/options/:entity', cms, asyncH(async (req, res) => {
  const e = getEntity(req);
  const label = e.fields.find((f) => f.name === 'title' || f.name === 'name')?.name ?? 'id';
  res.json((await query(`select ${e.pk} as id, ${label} as label from ${e.table} order by ${label}`)).rows);
}));

cmsRouter.get('/entities/:entity/:id', cms, asyncH(async (req, res) => {
  const e = getEntity(req);
  const r = await query(`select * from ${e.table} where ${e.pk} = $1`, [pkValue(e, req.params.id)]);
  if (!r.rows[0]) throw new HttpError(404, 'Not found');
  res.json(r.rows[0]);
}));

cmsRouter.post('/entities/:entity', cms, asyncH(async (req, res) => {
  const e = getEntity(req);
  if (e.fixed) throw new HttpError(405, 'This content cannot be created.');
  const data = clean(e, schemaFor(e, false).parse(req.body));
  const cols = Object.keys(data);
  const r = await query(
    `insert into ${e.table} (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning ${e.pk}`,
    cols.map((c) => data[c]));
  await audit(req, 'content.created', e.key, r.rows[0][e.pk]);
  res.status(201).json({ id: r.rows[0][e.pk] });
}));

cmsRouter.patch('/entities/:entity/:id', cms, asyncH(async (req, res) => {
  const e = getEntity(req);
  const id = pkValue(e, req.params.id);
  const data = clean(e, schemaFor(e, true).parse(req.body));
  const cols = Object.keys(data);
  if (!cols.length) return res.json({ ok: true });
  const r = await query(
    `update ${e.table} set ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} where ${e.pk} = $${cols.length + 1} returning ${e.pk}`,
    [...cols.map((c) => data[c]), id]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'content.updated', e.key, id, { fields: cols });
  res.json({ ok: true });
}));

cmsRouter.delete('/entities/:entity/:id', cms, asyncH(async (req, res) => {
  const e = getEntity(req);
  if (e.fixed) throw new HttpError(405, 'This content cannot be deleted. Hide it instead.');
  const id = pkValue(e, req.params.id);
  const r = await query(`delete from ${e.table} where ${e.pk} = $1`, [id]);
  if (!r.rowCount) throw new HttpError(404, 'Not found');
  await audit(req, 'content.deleted', e.key, id);
  res.json({ ok: true });
}));

// ---- Site settings ----
cmsRouter.get('/settings', requirePermission('settings.manage'), asyncH(async (_req, res) => {
  const rows = (await query('select key, value from site_settings')).rows;
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}));

cmsRouter.put('/settings', requirePermission('settings.manage'), asyncH(async (req, res) => {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of SETTINGS_FIELDS) shape[f.name] = zodFor({ ...f, required: false }).transform((v: any) => (v == null ? '' : String(v))).optional();
  const data = z.object(shape).strict().parse(req.body) as Record<string, string>;
  if (data.school_name !== undefined && !data.school_name.trim()) throw new HttpError(400, 'School name is required.', { school_name: 'Required' });
  if (data.enquiry_retention_days !== undefined && !/^\d{1,5}$/.test(data.enquiry_retention_days)) throw new HttpError(400, 'Enter a whole number of days.', { enquiry_retention_days: 'Whole number' });
  for (const [k, v] of Object.entries(data)) {
    await query(
      `insert into site_settings (key, value, updated_by) values ($1,$2,$3)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
      [k, v, req.auth!.user.id]);
  }
  await audit(req, 'settings.updated', 'settings', undefined, { keys: Object.keys(data) });
  res.json({ ok: true });
}));
