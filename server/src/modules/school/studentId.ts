import { PoolClient } from 'pg';
import { HttpError } from '../../middleware/errors';

/** Format tokens: {YYYY} = admission year, {NNNN} = running number (as many N as digits wanted). */
export function validateFormat(f: string): string | null {
  if (!/^[A-Za-z0-9\-_/{}]{3,30}$/.test(f)) return 'Use only letters, numbers, - _ / and the {YYYY} / {NNNN} tokens.';
  if ((f.match(/\{N{3,8}\}/g) ?? []).length !== 1) return 'Include exactly one running number such as {NNNN} (3 to 8 N).';
  const stripped = f.replace(/\{YYYY\}/g, '').replace(/\{N+\}/g, '');
  if (/[{}]/.test(stripped)) return 'Only {YYYY} and {NNNN} may appear inside braces.';
  return null;
}

export function formatStudentId(format: string, year: number, n: number): string {
  return format.replace(/\{YYYY\}/g, String(year)).replace(/\{(N+)\}/g, (_m, ns: string) => String(n).padStart(ns.length, '0'));
}

/** Allocates the next student ID inside the caller's transaction (safe under concurrent admissions). */
export async function nextStudentCode(c: PoolClient, year: number): Promise<string> {
  const fmt = (await c.query("select value from site_settings where key = 'student_id_format'")).rows[0]?.value || '{YYYY}-{NNNN}';
  const bad = validateFormat(fmt);
  if (bad) throw new HttpError(500, 'The student ID format in Site settings is invalid. Please correct it.');
  const r = await c.query(
    `insert into student_id_counters (year, last_number) values ($1, 1)
     on conflict (year) do update set last_number = student_id_counters.last_number + 1 returning last_number`, [year]);
  return formatStudentId(fmt, year, r.rows[0].last_number);
}
