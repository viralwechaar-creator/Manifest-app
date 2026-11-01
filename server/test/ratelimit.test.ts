import request from 'supertest';
import { afterAll, expect, it, vi } from 'vitest';

it('blocks repeated sign-in attempts from one address', async () => {
  vi.stubEnv('LOGIN_RATE_LIMIT', '3'); vi.resetModules();
  const { query, pool } = await import('../src/db'); const { migrate } = await import('../src/migrate');
  await query('drop schema public cascade; create schema public;'); await migrate();
  const { createApp } = await import('../src/app'); const app = createApp();
  const attempt = () => request(app).post('/api/auth/login').send({ loginId: 'nobody', password: 'wrong-password-1' });
  for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
  const blocked = await attempt(); expect(blocked.status).toBe(429); expect(blocked.body.error).toContain('Too many');
  await pool.end();
});
afterAll(() => vi.unstubAllEnvs());
