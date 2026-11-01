import { Request } from 'express';
import { query } from '../db';

export async function audit(req: Request | null, action: string, entity?: string, entityId?: string | number, details?: object, userId?: string) {
  await query(
    'insert into audit_logs (user_id, action, entity, entity_id, ip, details) values ($1,$2,$3,$4,$5,$6)',
    [userId ?? req?.auth?.user.id ?? null, action, entity ?? null, entityId?.toString() ?? null, req?.ip ?? null, details ? JSON.stringify(details) : null],
  );
}

export async function notifyPermission(permission: string, title: string, body: string, link: string) {
  await query(
    `insert into notifications (user_id, title, body, link)
     select distinct u.id, $2, $3, $4 from users u
       join user_roles ur on ur.user_id = u.id
       join role_permissions rp on rp.role_id = ur.role_id
       join permissions p on p.id = rp.permission_id
     where p.code = $1 and u.status = 'active'`,
    [permission, title, body, link],
  );
}
