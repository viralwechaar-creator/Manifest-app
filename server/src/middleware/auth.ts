import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { query } from '../db';
import { sha256 } from '../lib/crypto';
import { HttpError } from './errors';

export const SESSION_COOKIE = 'sid';
export const CSRF_COOKIE = 'csrf';

/** Attaches req.auth when a valid, unexpired, non-idle session cookie is present. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || typeof token !== 'string') return next();
    const tokenHash = sha256(token);
    const s = await query(
      `select s.csrf_token, s.last_seen_at, u.id, u.login_id, u.display_name, u.must_change_password, u.mfa_enabled
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now() and u.status = 'active'`,
      [tokenHash],
    );
    const row = s.rows[0];
    if (!row) return next();
    if (Date.now() - new Date(row.last_seen_at).getTime() > config.SESSION_IDLE_MINUTES * 60_000) {
      await query('delete from sessions where token_hash = $1', [tokenHash]);
      return next();
    }
    await query('update sessions set last_seen_at = now() where token_hash = $1 and last_seen_at < now() - interval \'1 minute\'', [tokenHash]);
    const perms = await query(
      `select r.code as role, p.code as permission
         from user_roles ur join roles r on r.id = ur.role_id
         left join role_permissions rp on rp.role_id = r.id
         left join permissions p on p.id = rp.permission_id
        where ur.user_id = $1`,
      [row.id],
    );
    req.auth = {
      user: { id: row.id, loginId: row.login_id, displayName: row.display_name, mustChangePassword: row.must_change_password, mfaEnabled: row.mfa_enabled },
      roles: [...new Set<string>(perms.rows.map((r) => r.role))],
      permissions: [...new Set<string>(perms.rows.map((r) => r.permission).filter(Boolean))],
      csrfToken: row.csrf_token,
      tokenHash,
    };
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new HttpError(401, 'Please sign in.'));
  next();
}

/** Backend permission check. Super admins hold every permission via role mapping, not a bypass. */
export const requirePermission = (...codes: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(new HttpError(401, 'Please sign in.'));
  if (req.auth.user.mustChangePassword) return next(new HttpError(403, 'You must change your password first.'));
  if (!codes.every((c) => req.auth!.permissions.includes(c))) return next(new HttpError(403, 'You do not have permission to do this.'));
  next();
};

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF defence: Origin must match, and signed-in mutations need the per-session token header. */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    const allowed = new URL(config.PUBLIC_ORIGIN).origin;
    const sameHost = (() => { try { return new URL(origin).host === req.get('host'); } catch { return false; } })();
    if (origin !== allowed && !sameHost) return next(new HttpError(403, 'Cross-site request blocked.'));
  }
  if (req.auth) {
    const sent = req.get('x-csrf-token');
    if (!sent || sent !== req.auth.csrfToken) return next(new HttpError(403, 'Security token missing or invalid. Refresh the page.'));
  }
  next();
}
