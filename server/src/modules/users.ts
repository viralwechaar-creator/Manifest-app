import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db';
import { audit } from '../lib/audit';
import { generateTempPassword, hashPassword } from '../lib/password';
import { requirePermission } from '../middleware/auth';
import { asyncH, HttpError } from '../middleware/errors';

export const usersRouter = Router();
usersRouter.use(requirePermission('users.manage'));

usersRouter.get('/roles', asyncH(async (_req, res) => {
  res.json((await query('select code, name, description from roles order by id')).rows);
}));

usersRouter.get('/', asyncH(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const role = String(req.query.role ?? '');
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = 25;
  const where = ['true']; const p: unknown[] = [];
  if (q) { p.push(`%${q}%`); where.push(`(u.login_id ilike $${p.length} or u.display_name ilike $${p.length} or u.email ilike $${p.length})`); }
  if (role) { p.push(role); where.push(`exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.code = $${p.length})`); }
  const total = (await query(`select count(*)::int n from users u where ${where.join(' and ')}`, p)).rows[0].n;
  p.push(size, (page - 1) * size);
  const rows = (await query(
    `select u.id, u.login_id, u.display_name, u.email, u.status, u.mfa_enabled, u.last_login_at, u.created_at,
            coalesce(array_agg(r.code order by r.id) filter (where r.code is not null), '{}') as roles
       from users u left join user_roles ur on ur.user_id = u.id left join roles r on r.id = ur.role_id
      where ${where.join(' and ')} group by u.id order by u.created_at desc limit $${p.length - 1} offset $${p.length}`, p)).rows;
  res.json({ rows, total, page, size });
}));

const create = z.object({
  loginId: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._@-]+$/, 'Use letters, numbers and . _ @ - only'),
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  roles: z.array(z.string()).min(1),
});

function guardRoles(req: any, roles: string[]) {
  if (roles.includes('super_admin') && !req.auth.roles.includes('super_admin')) throw new HttpError(403, 'Only a Super Admin can grant the Super Admin role.');
}
async function roleIds(c: any, codes: string[]): Promise<number[]> {
  const r = await c.query('select id, code from roles where code = any($1)', [codes]);
  if (r.rows.length !== new Set(codes).size) throw new HttpError(400, 'Unknown role.');
  return r.rows.map((x: any) => x.id);
}

usersRouter.post('/', asyncH(async (req, res) => {
  const b = create.parse(req.body);
  guardRoles(req, b.roles);
  const temp = generateTempPassword();
  const hash = await hashPassword(temp);
  const id = await tx(async (c) => {
    const ids = await roleIds(c, b.roles);
    const u = await c.query(
      `insert into users (login_id, display_name, email, password_hash, must_change_password, created_by)
       values ($1,$2,$3,$4,true,$5) returning id`, [b.loginId, b.displayName, b.email || null, hash, req.auth!.user.id]);
    for (const rid of ids) await c.query('insert into user_roles values ($1,$2)', [u.rows[0].id, rid]);
    return u.rows[0].id as string;
  });
  await audit(req, 'user.created', 'user', id, { roles: b.roles });
  res.status(201).json({ id, temporaryPassword: temp });
}));

async function activeSuperAdmins(excludeId: string): Promise<number> {
  return (await query(
    `select count(*)::int n from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
      where r.code = 'super_admin' and u.status = 'active' and u.id <> $1`, [excludeId])).rows[0].n;
}
async function targetIsSuper(id: string): Promise<boolean> {
  return (await query(`select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1 and r.code = 'super_admin'`, [id])).rowCount! > 0;
}

usersRouter.patch('/:id', asyncH(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const b = z.object({
    displayName: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(200).optional().or(z.literal('')),
    status: z.enum(['active', 'suspended']).optional(),
    roles: z.array(z.string()).min(1).optional(),
  }).parse(req.body);
  if (!(await query('select 1 from users where id = $1', [id])).rowCount) throw new HttpError(404, 'User not found');
  const isSuper = await targetIsSuper(id);
  if (isSuper && !req.auth!.roles.includes('super_admin')) throw new HttpError(403, 'Only a Super Admin can change a Super Admin.');
  if (b.roles) guardRoles(req, b.roles);
  const losingSuper = isSuper && ((b.roles && !b.roles.includes('super_admin')) || b.status === 'suspended');
  if (losingSuper && (await activeSuperAdmins(id)) === 0) throw new HttpError(400, 'There must always be at least one active Super Admin.');
  if (id === req.auth!.user.id && b.status === 'suspended') throw new HttpError(400, 'You cannot suspend your own account.');

  await tx(async (c) => {
    if (b.displayName !== undefined) await c.query('update users set display_name=$2 where id=$1', [id, b.displayName]);
    if (b.email !== undefined) await c.query('update users set email=$2 where id=$1', [id, b.email || null]);
    if (b.status) {
      await c.query('update users set status=$2 where id=$1', [id, b.status]);
      if (b.status === 'suspended') await c.query('delete from sessions where user_id = $1', [id]);
    }
    if (b.roles) {
      const ids = await roleIds(c, b.roles);
      await c.query('delete from user_roles where user_id = $1', [id]);
      for (const rid of ids) await c.query('insert into user_roles values ($1,$2)', [id, rid]);
      await c.query('delete from sessions where user_id = $1 and token_hash <> $2', [id, req.auth!.tokenHash]);
    }
  });
  await audit(req, 'user.updated', 'user', id, { changed: Object.keys(b) });
  res.json({ ok: true });
}));

usersRouter.post('/:id/reset-password', asyncH(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  if (await targetIsSuper(id) && !req.auth!.roles.includes('super_admin')) throw new HttpError(403, 'Only a Super Admin can reset a Super Admin.');
  const temp = generateTempPassword();
  const r = await query('update users set password_hash=$2, must_change_password=true, failed_attempts=0, locked_until=null where id=$1 returning id', [id, await hashPassword(temp)]);
  if (!r.rowCount) throw new HttpError(404, 'User not found');
  await query('delete from sessions where user_id = $1', [id]);
  await audit(req, 'user.password_reset', 'user', id);
  res.json({ temporaryPassword: temp });
}));
