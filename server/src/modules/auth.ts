import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { query, tx } from '../db';
import { decrypt, encrypt, randomToken, sha256 } from '../lib/crypto';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from '../lib/password';
import { newSecret, otpauthUri, verifyTotp } from '../lib/totp';
import { audit } from '../lib/audit';
import { CSRF_COOKIE, requireAuth, SESSION_COOKIE } from '../middleware/auth';
import { asyncH, HttpError } from '../middleware/errors';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.LOGIN_RATE_LIMIT, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });
const MAX_FAILS = 5;
const LOCK_MIN = 15;

function setCookies(res: any, token: string, csrf: string) {
  const base = { secure: config.cookieSecure, sameSite: 'lax' as const, path: '/', maxAge: config.SESSION_TTL_HOURS * 3600_000 };
  res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true });
  res.cookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false });
}

const loginBody = z.object({
  loginId: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(200),
  otp: z.string().trim().max(10).optional(),
});

authRouter.post('/login', loginLimiter, asyncH(async (req, res) => {
  const body = loginBody.parse(req.body);
  // A parent can sign in with any linked child's student ID (stored as an alias of one account).
  const r = await query(
    `select * from (select u.* from users u where u.login_id = $1
                    union all select u.* from users u join login_aliases a on a.user_id = u.id where a.login_id = $1) x limit 1`, [body.loginId]);
  const u = r.rows[0];
  const ok = await verifyPassword(body.password, u?.password_hash ?? DUMMY_HASH);
  const generic = new HttpError(401, 'Incorrect login ID or password.');

  if (!u || u.status !== 'active') throw generic;
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(423, 'Account temporarily locked after repeated failures. Try again later.');
  if (!ok) {
    const fails = u.failed_attempts + 1;
    await query('update users set failed_attempts = $2, locked_until = $3 where id = $1',
      [u.id, fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60_000) : null]);
    await audit(req, 'login.failed', 'user', u.id, undefined, u.id);
    throw generic;
  }
  if (u.mfa_enabled) {
    if (!body.otp) return res.json({ mfaRequired: true });
    if (!verifyTotp(decrypt(u.mfa_secret_enc), body.otp)) {
      await audit(req, 'login.mfa_failed', 'user', u.id, undefined, u.id);
      throw new HttpError(401, 'Incorrect verification code.');
    }
  }
  const token = randomToken();
  const csrf = randomToken(24);
  await query('update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1', [u.id]);
  await query(
    `insert into sessions (token_hash, user_id, csrf_token, expires_at, user_agent, ip)
     values ($1,$2,$3, now() + ($4 || ' hours')::interval, $5, $6)`,
    [sha256(token), u.id, csrf, String(config.SESSION_TTL_HOURS), (req.get('user-agent') ?? '').slice(0, 200), req.ip],
  );
  await audit(req, 'login.success', 'user', u.id, undefined, u.id);
  setCookies(res, token, csrf);
  res.json({ ok: true });
}));

authRouter.post('/logout', asyncH(async (req, res) => {
  if (req.auth) {
    await query('delete from sessions where token_hash = $1', [req.auth.tokenHash]);
    await audit(req, 'logout', 'user', req.auth.user.id);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, (req, res) => {
  const a = req.auth!;
  res.json({ user: a.user, roles: a.roles, permissions: a.permissions, csrfToken: a.csrfToken });
});

authRouter.post('/change-password', requireAuth, asyncH(async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().max(200) }).parse(req.body);
  const problem = passwordProblem(body.newPassword);
  if (problem) throw new HttpError(400, problem, { newPassword: problem });
  const id = req.auth!.user.id;
  const u = (await query('select password_hash from users where id = $1', [id])).rows[0];
  if (!(await verifyPassword(body.currentPassword, u.password_hash))) throw new HttpError(400, 'Current password is incorrect.', { currentPassword: 'Incorrect password' });
  const hash = await hashPassword(body.newPassword);
  await tx(async (c) => {
    await c.query('update users set password_hash = $2, must_change_password = false where id = $1', [id, hash]);
    await c.query('delete from sessions where user_id = $1 and token_hash <> $2', [id, req.auth!.tokenHash]);
  });
  await audit(req, 'password.changed', 'user', id);
  res.json({ ok: true });
}));

// ---- Optional TOTP multi-factor authentication ----
authRouter.post('/mfa/setup', requireAuth, asyncH(async (req, res) => {
  if (req.auth!.user.mfaEnabled) throw new HttpError(400, 'Two-step verification is already on.');
  const secret = newSecret();
  await query('update users set mfa_secret_enc = $2 where id = $1', [req.auth!.user.id, encrypt(secret)]);
  res.json({ secret, uri: otpauthUri(secret, req.auth!.user.loginId, 'School Portal') });
}));

authRouter.post('/mfa/enable', requireAuth, asyncH(async (req, res) => {
  const { otp } = z.object({ otp: z.string().trim().length(6) }).parse(req.body);
  const u = (await query('select mfa_secret_enc from users where id = $1', [req.auth!.user.id])).rows[0];
  if (!u?.mfa_secret_enc) throw new HttpError(400, 'Start setup first.');
  if (!verifyTotp(decrypt(u.mfa_secret_enc), otp)) throw new HttpError(400, 'That code is not correct.', { otp: 'Incorrect code' });
  await query('update users set mfa_enabled = true where id = $1', [req.auth!.user.id]);
  await audit(req, 'mfa.enabled', 'user', req.auth!.user.id);
  res.json({ ok: true });
}));

authRouter.post('/mfa/disable', requireAuth, asyncH(async (req, res) => {
  const { password, otp } = z.object({ password: z.string().max(200), otp: z.string().trim().length(6) }).parse(req.body);
  const u = (await query('select password_hash, mfa_secret_enc, mfa_enabled from users where id = $1', [req.auth!.user.id])).rows[0];
  if (!u.mfa_enabled) throw new HttpError(400, 'Two-step verification is not on.');
  if (!(await verifyPassword(password, u.password_hash)) || !verifyTotp(decrypt(u.mfa_secret_enc), otp)) throw new HttpError(400, 'Password or code is incorrect.');
  await query('update users set mfa_enabled = false, mfa_secret_enc = null where id = $1', [req.auth!.user.id]);
  await audit(req, 'mfa.disabled', 'user', req.auth!.user.id);
  res.json({ ok: true });
}));
