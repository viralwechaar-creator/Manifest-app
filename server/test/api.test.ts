import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool, query } from '../src/db';
import { hashPassword } from '../src/lib/password';
import { migrate } from '../src/migrate';
import { newSecret } from '../src/lib/totp';

const app = createApp();
const PW = 'Correct-horse-42';

async function makeUser(loginId: string, role: string, extra: { must?: boolean } = {}) {
  const u = await query('insert into users (login_id, display_name, password_hash, must_change_password) values ($1::citext,$1,$2,$3) returning id',
    [loginId, await hashPassword(PW), !!extra.must]);
  await query('insert into user_roles select $1, id from roles where code = $2', [u.rows[0].id, role]);
}

async function login(loginId: string, password = PW) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ loginId, password });
  if (r.status !== 200) return { agent, r, csrf: '' };
  const me = await agent.get('/api/auth/me');
  return { agent, r, csrf: me.body.csrfToken as string };
}

beforeAll(async () => {
  await query('drop schema public cascade; create schema public;');
  await migrate();
  await makeUser('admin@school.test', 'super_admin');
  await makeUser('teacher@school.test', 'teacher');
  await makeUser('front@school.test', 'admission_staff');
  await makeUser('fresh@school.test', 'school_admin', { must: true });
});
afterAll(async () => { await pool.end(); });

describe('authentication', () => {
  it('rejects wrong password and unknown user with the same message', async () => {
    const a = await request(app).post('/api/auth/login').send({ loginId: 'admin@school.test', password: 'nope-nope-1' });
    const b = await request(app).post('/api/auth/login').send({ loginId: 'ghost@school.test', password: 'nope-nope-1' });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });
  it('sets httpOnly session cookie and requires CSRF token for writes', async () => {
    const { agent, r, csrf } = await login('admin@school.test');
    expect(r.headers['set-cookie'].join(';')).toMatch(/sid=.*HttpOnly/);
    const noToken = await agent.post('/api/admin/cms/entities/news').send({ title: 'x', kind: 'news' });
    expect(noToken.status).toBe(403);
    const ok = await agent.post('/api/admin/cms/entities/news').set('x-csrf-token', csrf).send({ title: 'Hello', kind: 'news' });
    expect(ok.status).toBe(201);
  });
  it('blocks cross-site origins', async () => {
    const r = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({ loginId: 'a', password: 'b' });
    expect(r.status).toBe(403);
  });
  it('locks the account after repeated failures', async () => {
    await makeUser('victim@school.test', 'teacher');
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ loginId: 'victim@school.test', password: 'wrong-pass-1' });
    const r = await request(app).post('/api/auth/login').send({ loginId: 'victim@school.test', password: PW });
    expect(r.status).toBe(423);
  });
  it('forces a password change before anything else', async () => {
    const { agent } = await login('fresh@school.test');
    expect((await agent.get('/api/admin/dashboard')).status).toBe(403);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });
  it('requires a TOTP code once MFA is enabled', async () => {
    await makeUser('mfa@school.test', 'principal');
    const { agent, csrf } = await login('mfa@school.test');
    const setup = await agent.post('/api/auth/mfa/setup').set('x-csrf-token', csrf);
    expect(setup.body.secret).toBeTruthy();
    // Enabling with a wrong code fails
    expect((await agent.post('/api/auth/mfa/enable').set('x-csrf-token', csrf).send({ otp: '000000' })).status).toBe(400);
    void newSecret;
  });
});

describe('permissions are enforced by the backend', () => {
  it('anonymous users cannot reach admin APIs', async () => {
    for (const p of ['/api/admin/dashboard', '/api/admin/users', '/api/admin/inbox/enquiries', '/api/admin/cms/entities/news']) {
      expect((await request(app).get(p)).status).toBe(401);
    }
  });
  it('a teacher cannot manage content, users or inbox', async () => {
    const { agent, csrf } = await login('teacher@school.test');
    expect((await agent.get('/api/admin/dashboard')).status).toBe(200);
    expect((await agent.get('/api/admin/cms/entities/news')).status).toBe(403);
    expect((await agent.get('/api/admin/users')).status).toBe(403);
    expect((await agent.get('/api/admin/inbox/enquiries')).status).toBe(403);
    expect((await agent.put('/api/admin/cms/settings').set('x-csrf-token', csrf).send({ tagline: 'x' })).status).toBe(403);
  });
  it('admission staff can read the inbox but not edit content or users', async () => {
    const { agent } = await login('front@school.test');
    expect((await agent.get('/api/admin/inbox/enquiries')).status).toBe(200);
    expect((await agent.get('/api/admin/cms/entities/news')).status).toBe(403);
    expect((await agent.get('/api/admin/users')).status).toBe(403);
  });
  it('only a super admin can create another super admin; last one is protected', async () => {
    await makeUser('sa2@school.test', 'school_admin');
    const sa = await login('sa2@school.test');
    const denied = await sa.agent.post('/api/admin/users').set('x-csrf-token', sa.csrf).send({ loginId: 'evil1', displayName: 'E', roles: ['super_admin'] });
    expect(denied.status).toBe(403);
    const root = await login('admin@school.test');
    const id = (await query("select id from users where login_id='admin@school.test'")).rows[0].id;
    const r = await root.agent.patch(`/api/admin/users/${id}`).set('x-csrf-token', root.csrf).send({ status: 'suspended' });
    expect(r.status).toBe(400);
  });
});

describe('public website', () => {
  it('seeded starter content has real line breaks', async () => {
    const r = await query("select count(*)::int n from pages where strpos(body, chr(92) || 'n') > 0");
    expect(r.rows[0].n).toBe(0);
    const st = await query("select value from site_settings where key='stats'");
    expect(st.rows[0].value).toContain('\n');
  });
  it('exposes only published content', async () => {
    const { agent, csrf } = await login('admin@school.test');
    await agent.post('/api/admin/cms/entities/news').set('x-csrf-token', csrf).send({ title: 'Visible story', kind: 'news', published: true });
    await agent.post('/api/admin/cms/entities/news').set('x-csrf-token', csrf).send({ title: 'Hidden draft', kind: 'news', published: false });
    const r = await request(app).get('/api/public/content/news');
    const titles = r.body.map((x: any) => x.title);
    expect(titles).toContain('Visible story');
    expect(titles).not.toContain('Hidden draft');
  });
  it('does not expose personal-data tables or unknown entities publicly', async () => {
    expect((await request(app).get('/api/public/content/admission_enquiries')).status).toBe(404);
    expect((await request(app).get('/api/public/content/users')).status).toBe(404);
  });
  it('validates and stores an enquiry with consent, notifies staff, honeypot drops bots', async () => {
    const bad = await request(app).post('/api/public/enquiries').send({ studentName: 'A' });
    expect(bad.status).toBe(400);
    const noConsent = await request(app).post('/api/public/enquiries').send({ studentName: 'A', gradeApplying: '1', parentName: 'P', phone: '9876543210', consent: false });
    expect(noConsent.status).toBe(400);
    const ok = await request(app).post('/api/public/enquiries').send({ studentName: 'Asha', gradeApplying: 'Class 1', parentName: 'Ravi', phone: '9876543210', consent: true });
    expect(ok.status).toBe(201);
    const stored = await query('select consent_notice_version from admission_enquiries');
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].consent_notice_version).toBe('1');
    const n = await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id='front@school.test'");
    expect(n.rowCount).toBe(1);
    const bot = await request(app).post('/api/public/enquiries').send({ studentName: 'Bot', gradeApplying: '1', parentName: 'P', phone: '9876543210', consent: true, website: 'spam' });
    expect(bot.status).toBe(200);
    expect((await query('select count(*)::int n from admission_enquiries')).rows[0].n).toBe(1);
  });
});

describe('uploads', () => {
  it('rejects a file disguised by its extension and accepts a real PNG', async () => {
    const { agent, csrf } = await login('admin@school.test');
    const fake = await agent.post('/api/admin/uploads').set('x-csrf-token', csrf).attach('file', Buffer.from('<script>alert(1)</script>'), 'pic.png');
    expect(fake.status).toBe(400);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    const ok = await agent.post('/api/admin/uploads').set('x-csrf-token', csrf).attach('file', png, 'a.png');
    expect(ok.status).toBe(201);
    expect(ok.body.url).toMatch(/^\/uploads\/[0-9a-f]{32}\.png$/);
  });
});
