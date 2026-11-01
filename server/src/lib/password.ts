import crypto from 'crypto';

const N = 32768, R = 8, P = 1, KEYLEN = 64;
const opts = { N, r: R, p: P, maxmem: 128 * 1024 * 1024 };

function scrypt(pw: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) => crypto.scrypt(pw, salt, KEYLEN, opts, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const key = await scrypt(pw, salt);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Used to keep login timing similar when the account does not exist.
export const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(KEYLEN).toString('base64')}`;

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters.';
  if (pw.length > 128) return 'Password is too long.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers.';
  if (/^(.)\1+$/.test(pw)) return 'Password is too simple.';
  return null;
}

export function generateTempPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(14);
  let out = '';
  for (const x of b) out += chars[x % chars.length];
  return out + '7';
}
