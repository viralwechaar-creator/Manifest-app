import { Request } from 'express';
import { query } from '../../db';
import { HttpError } from '../../middleware/errors';

export const has = (req: Request, p: string) => !!req.auth?.permissions.includes(p);
/** School admins / super admins are the only holders of academics.manage: used as "may act on any class". */
export const isAdmin = (req: Request) => has(req, 'academics.manage');

export async function myStaffId(req: Request): Promise<number | null> {
  const r = await query("select id from staff where user_id = $1 and status <> 'left'", [req.auth!.user.id]);
  return r.rows[0]?.id ?? null;
}
export async function requireStaffId(req: Request): Promise<number> {
  const id = await myStaffId(req);
  if (!id) throw new HttpError(403, 'Your account is not linked to a staff record.');
  return id;
}
export async function isClassTeacher(staffId: number, sectionId: number) {
  return (await query('select 1 from sections where id=$1 and class_teacher_id=$2', [sectionId, staffId])).rowCount! > 0;
}
export async function teachesSection(staffId: number, sectionId: number, subjectId?: number) {
  if (subjectId) return (await query('select 1 from teacher_assignments where staff_id=$1 and section_id=$2 and subject_id=$3', [staffId, sectionId, subjectId])).rowCount! > 0;
  return (await query('select 1 from teacher_assignments where staff_id=$1 and section_id=$2 union select 1 from sections where id=$2 and class_teacher_id=$1', [staffId, sectionId])).rowCount! > 0;
}
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const today = () => isoDate(new Date());
/** ISO weekday (1 = Monday ... 7 = Sunday) of a YYYY-MM-DD date, independent of timezone. */
export const isoDow = (date: string) => { const d = new Date(date + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
export function* eachDate(from: string, to: string) {
  const end = new Date(to + 'T00:00:00Z');
  for (let d = new Date(from + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) yield isoDate(d);
}
