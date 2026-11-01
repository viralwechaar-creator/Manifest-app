import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, listRoutes } from '../src/app';
import { pool, query } from '../src/db';
import { hashPassword } from '../src/lib/password';
import { migrate } from '../src/migrate';

const app = createApp(); const PW = 'Correct-horse-42';
const routes = listRoutes(app).filter((r) => r.path.startsWith('/api'));
const PUBLIC = [/^\/api\/public(\/|$)/, /^\/api\/apply(\/|$)/, /^\/api\/health$/, /^\/api\/auth\/(login|logout)$/];
const protectedRoutes = routes.filter((r) => !PUBLIC.some((p) => p.test(r.path)));
const fill = (p: string) => p.replace(/:[A-Za-z]+/g, '1').replace(/\/+$/, '');
const call = (a: any, r: { method: string; path: string }, h: Record<string, string> = {}) => (a as any)[r.method.toLowerCase()](fill(r.path)).set(h).send(r.method === 'GET' || r.method === 'DELETE' ? undefined : {});
async function session(login: string, role: string) {
  const u = await query('insert into users (login_id, display_name, password_hash) values ($1::citext,$1,$2) returning id', [login, await hashPassword(PW)]);
  await query('insert into user_roles select $1, id from roles where code=$2', [u.rows[0].id, role]);
  const a = request.agent(app); await a.post('/api/auth/login').send({ loginId: login, password: PW });
  return { a, h: { 'x-csrf-token': (await a.get('/api/auth/me')).body.csrfToken as string } };
}
beforeAll(async () => { await query('drop schema public cascade; create schema public;'); await migrate(); });
afterAll(async () => { await pool.end(); });

describe('route guards (every route, automatically)', () => {
  it('finds a realistic number of routes', () => { expect(protectedRoutes.length).toBeGreaterThan(150); });
  it('refuses every protected route to someone who is not signed in', async () => {
    const bad: string[] = [];
    for (const r of protectedRoutes) { const res = await call(request(app), r); if (res.status !== 401) bad.push(`${r.method} ${r.path} -> ${res.status}`); }
    expect(bad).toEqual([]);
  });
  it('refuses every staff route to a family account, apart from its own notifications', async () => {
    const parent = await session('parent-x', 'parent'); const bad: string[] = [];
    const OK = [/^GET \/api\/admin\/notifications$/, /^POST \/api\/admin\/notifications\/read$/];
    for (const r of protectedRoutes.filter((x) => x.path.startsWith('/api/admin'))) {
      const res = await call(parent.a, r, r.method === 'GET' ? {} : parent.h);
      const allowed = OK.some((p) => p.test(`${r.method} ${r.path}`));
      if (allowed ? res.status !== 200 : ![401, 403, 404].includes(res.status)) bad.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });
  it('refuses every family route to a staff account', async () => {
    const teacher = await session('teacher-x', 'teacher'); const bad: string[] = [];
    for (const r of protectedRoutes.filter((x) => x.path.startsWith('/api/family'))) { const res = await call(teacher.a, r, r.method === 'GET' ? {} : teacher.h); if (res.status !== 403) bad.push(`${r.method} ${r.path} -> ${res.status}`); }
    expect(bad).toEqual([]);
  });
  it('gives a staff member with no special rights nothing beyond their own basics', async () => {
    const acc = await session('librarian-x', 'librarian'); const leaked: string[] = [];
    // A librarian may use library, complaints (to raise), own pay/documents and the schema/dashboard basics, nothing else.
    const MAY = [/^\/api\/admin\/school\/(library|complaints\/mine|exams\/[^/]+\/subjects)/, /^\/api\/admin\/(library|dashboard|notifications|complaints|hr\/me|hr\/payslips|hr\/staff\/[^/]+\/documents|cms\/schema|school\/leave|school\/timetable\/my|school\/staff\/options|school\/(classes|sections|years|subjects|departments|periods)$|school\/fees\/heads)/];
    for (const r of protectedRoutes.filter((x) => x.path.startsWith('/api/admin') && x.method === 'GET')) { const res = await call(acc.a, r); if (res.status === 200 && !MAY.some((p) => p.test(fill(r.path)))) leaked.push(`${r.path} -> 200`); }
    expect(leaked).toEqual([]);
  });
});

describe('transport-level protections', () => {
  it('sends security headers and never reveals the framework', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-powered-by']).toBeUndefined(); expect(r.headers['x-content-type-options']).toBe('nosniff'); expect(r.headers['content-security-policy']).toContain("default-src 'self'"); expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['strict-transport-security']).toBeTruthy(); expect(r.headers['x-frame-options'] ?? r.headers['content-security-policy']).toBeTruthy();
  });
  it('rejects oversized or malformed bodies without crashing', async () => {
    expect((await request(app).post('/api/auth/login').set('content-type', 'application/json').send('{"loginId":')).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ loginId: 'x'.repeat(500000), password: 'y' })).status).toBe(413);
  });
  it('does not leak internals in errors', async () => {
    const r = await request(app).get('/api/admin/school/students/not-a-number'); expect([401, 403, 404]).toContain(r.status); expect(JSON.stringify(r.body)).not.toMatch(/stack|node_modules|select |pg/i);
  });
  it('treats SQL-looking input as plain text', async () => {
    const p = await session('adm-x', 'school_admin');
    const r = await p.a.get(`/api/admin/school/students?q=${encodeURIComponent("'; drop table students; --")}`); expect(r.status).toBe(200); expect(r.body.rows).toEqual([]);
    expect((await query("select to_regclass('students') as t")).rows[0].t).toBe('students');
  });
  it('stores user-supplied text unchanged but renders nothing as HTML (API returns data, not markup)', async () => {
    const p = await session('adm-y', 'school_admin');
    await p.a.post('/api/admin/cms/entities/news').set(p.h).send({ title: '<img src=x onerror=alert(1)>', kind: 'news' });
    const r = await request(app).get('/api/public/content/news'); expect(r.headers['content-type']).toContain('application/json'); expect(r.body[0].title).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('file uploads and file serving', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  it('needs a signed-in user with website rights', async () => {
    expect((await request(app).post('/api/admin/uploads').attach('file', png, 'a.png')).status).toBe(401);
    const t = await session('teach-up', 'teacher');
    expect([401, 403]).toContain((await t.a.post('/api/admin/uploads').set(t.h).attach('file', png, 'a.png')).status);
  });
  it('refuses files over 10 MB and images over 5 MB', async () => {
    const a = await session('adm-up', 'school_admin');
    const huge = Buffer.concat([png, Buffer.alloc(11 * 1024 * 1024)]);
    expect((await a.a.post('/api/admin/uploads').set(a.h).attach('file', huge, 'big.png')).status).toBe(413);
    const big = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]);
    expect((await a.a.post('/api/admin/uploads').set(a.h).attach('file', big, 'big.png')).status).toBe(400);
  });
  it('ignores the file name the user gives and stores under a random name', async () => {
    const a = await session('adm-up2', 'school_admin');
    const r = await a.a.post('/api/admin/uploads').set(a.h).attach('file', png, '../../etc/passwd.png');
    expect(r.status).toBe(201); expect(r.body.url).toMatch(/^\/uploads\/[0-9a-f]{32}\.png$/);
  });
  it('does not serve anything outside the uploads folder', async () => {
    for (const u of ['/uploads/../package.json', '/uploads/%2e%2e/package.json', '/uploads/..%2f..%2fserver/.env', '/uploads/private/x.pdf']) {
      const r = await request(app).get(u); expect(r.status === 404 || r.status === 400 || r.status === 403, `${u} -> ${r.status}`).toBe(true);
      expect(r.text).not.toMatch(/"name"|DATABASE_URL|SESSION/);
    }
  });
});
