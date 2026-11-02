import http from 'http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { pool, query } from '../src/db';
import { processOutbox } from '../src/lib/delivery';
import { hashPassword } from '../src/lib/password';
import { migrate } from '../src/migrate';

const app = createApp();
const PW = 'Correct-horse-42'; const NEWPW = 'Fresh-Parent-2026';
const ids: Record<string, any> = {}; const temps: Record<string, string> = {};
const FUT = (days: number, hour = 10) => { const d = new Date(Date.now() + days * 86400000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function mkUser(loginId: string, role: string, extra: string[] = []) {
  const u = await query('insert into users (login_id, display_name, password_hash, email) values ($1::citext,$1,$2,$3) returning id', [loginId, await hashPassword(PW), `${loginId}@example.org`]);
  await query('insert into user_roles select $1, id from roles where code=$2', [u.rows[0].id, role]);
  for (const p of extra) await query('insert into role_permissions select r.id, p.id from roles r, permissions p where r.code=$1 and p.code=$2 on conflict do nothing', [role, p]);
  return u.rows[0].id as string;
}
async function login(loginId: string, pw = PW) {
  const a = request.agent(app); const r = await a.post('/api/auth/login').send({ loginId, password: pw });
  const me = r.status === 200 ? await a.get('/api/auth/me') : null;
  return { a, status: r.status, h: { 'x-csrf-token': (me?.body.csrfToken ?? '') as string } };
}
async function parentSession(loginId: string) {
  const known = await login(loginId, NEWPW); if (known.status === 200) return known;
  const first = await login(loginId, temps[loginId]);
  await first.a.post('/api/auth/change-password').set(first.h).send({ currentPassword: temps[loginId], newPassword: NEWPW });
  return login(loginId, NEWPW);
}
type S = Awaited<ReturnType<typeof login>>;
const send = (s: S, method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: any) => { const r = (s.a as any)[method](url); if (method !== 'get') r.set(s.h); return body !== undefined ? r.send(body) : r; };

let adm: S, admin: S, principal: S, ct: S, other: S, lib: S, pA: S, pB: S;

beforeAll(async () => {
  await query('drop schema public cascade; create schema public;'); await migrate();
  await mkUser('adm', 'admission_staff', ['students.sensitive']); await mkUser('admin', 'school_admin'); await mkUser('principal', 'principal'); await mkUser('lib', 'librarian');
  const uCT = await mkUser('ct', 'teacher'), uOther = await mkUser('other', 'teacher');
  const y = (await query("insert into academic_years (label, starts_on, ends_on, is_current) values ('Y','2020-01-01','2099-12-31',true) returning id")).rows[0].id;
  const c = (await query("insert into classes (name, level) values ('Class 3',3) returning id")).rows[0].id;
  const stf = async (code: string, n: string, u: string) => (await query("insert into staff (user_id, staff_code, full_name, kind, designation) values ($1,$2,$3,'teacher','T') returning id", [u, code, n])).rows[0].id as number;
  ids.ct = await stf('S1', 'Class Teacher', uCT); ids.other = await stf('S2', 'Other Teacher', uOther);
  ids.secA = (await query("insert into sections (class_id, academic_year_id, name, class_teacher_id) values ($1,$2,'A',$3) returning id", [c, y, ids.ct])).rows[0].id;
  ids.secB = (await query("insert into sections (class_id, academic_year_id, name, class_teacher_id) values ($1,$2,'B',$3) returning id", [c, y, ids.other])).rows[0].id;
  ids.maths = (await query("insert into subjects (name, code) values ('Maths','MAT') returning id")).rows[0].id;
  await query('insert into class_subjects values ($1,$2)', [c, ids.maths]);
  await query('insert into teacher_assignments (staff_id, section_id, subject_id) values ($1,$2,$3)', [ids.ct, ids.secA, ids.maths]);
  const a0 = await login('adm');
  const reg = (b: any) => a0.a.post('/api/admin/school/students').set(a0.h).send({ dateOfBirth: '2017-01-01', gender: 'female', admissionDate: '2026-04-01', issueParentLogin: true, ...b });
  const anya = await reg({ fullName: 'Anya Rao', sectionId: ids.secA, guardians: [{ fullName: 'Rao Parent', relation: 'Mother', phone: '9000000001', email: 'rao@example.org' }] });
  const bela = await reg({ fullName: 'Bela Sen', sectionId: ids.secA, guardians: [{ fullName: 'Sen Parent', relation: 'Father', phone: '9000000002' }] });
  const chitra = await reg({ fullName: 'Chitra Das', sectionId: ids.secB, guardians: [{ fullName: 'Das Parent', relation: 'Mother', phone: '9000000003' }] });
  ids.anya = anya.body.id; ids.bela = bela.body.id; ids.chitra = chitra.body.id; ids.guardianAnya = (await query('select guardian_id from student_guardians where student_id=$1', [ids.anya])).rows[0].guardian_id;
  temps[anya.body.studentCode] = anya.body.parentLogin.temporaryPassword; temps[bela.body.studentCode] = bela.body.parentLogin.temporaryPassword; ids.codeA = anya.body.studentCode; ids.codeB = bela.body.studentCode;
  adm = a0; admin = await login('admin'); principal = await login('principal'); ct = await login('ct'); other = await login('other'); lib = await login('lib');
  pA = await parentSession(ids.codeA); pB = await parentSession(ids.codeB);
});
afterAll(async () => { await pool.end(); });

describe('safety: emergency contacts, pickups and the gate', () => {
  it('lets a parent add an emergency contact for their own child only, and rejects bad phone numbers', async () => {
    expect((await send(pA, 'post', `/api/family/children/${ids.anya}/emergency-contacts`, { fullName: 'Neighbour', relation: 'Neighbour', phone: '12345' })).status).toBe(400);
    expect((await send(pA, 'post', `/api/family/children/${ids.anya}/emergency-contacts`, { fullName: 'Neighbour', relation: 'Neighbour', phone: '+91 98765 43210'.replace(/ /g, '') })).status).toBe(201);
    expect((await send(pA, 'post', `/api/family/children/${ids.bela}/emergency-contacts`, { fullName: 'X', relation: 'Y', phone: '9876543210' })).status).toBe(404);
    expect((await send(pB, 'get', `/api/family/children/${ids.anya}/safety`)).status).toBe(404);
    const mine = await send(pA, 'get', `/api/family/children/${ids.anya}/safety`); expect(mine.body.emergencyContacts[0].phone).toBe('9876543210');
  });
  it('shows emergency contacts only to staff allowed to see sensitive details, and logs the access', async () => {
    expect((await send(ct, 'get', `/api/admin/school/safety/students/${ids.anya}/emergency-contacts`)).status).toBe(403);
    const r = await send(adm, 'get', `/api/admin/school/safety/students/${ids.anya}/emergency-contacts`); expect(r.status).toBe(200); expect(r.body).toHaveLength(1);
    expect((await query("select 1 from audit_logs where action='student.emergency_contacts_viewed'")).rowCount).toBe(1);
  });
  it('runs the pickup approval flow and refuses collection by anyone not approved', async () => {
    const add = await send(pA, 'post', `/api/family/children/${ids.anya}/pickups`, { fullName: 'Uncle Raj', relation: 'Uncle', phone: '9811111111', idHint: 'Licence ending 4821' });
    expect(add.status).toBe(201); expect(add.body.status).toBe('pending'); ids.pickup = add.body.id;
    expect((await send(pA, 'post', `/api/family/children/${ids.anya}/pickups`, { fullName: 'Bad', relation: 'x', phone: '9811111112', idHint: '123456789012' })).status).toBe(400); // a full ID number is refused
    const gate = (b: any) => send(admin, 'post', '/api/admin/school/safety/gate', { studentId: ids.anya, kind: 'pickup', ...b });
    expect((await gate({ pickupId: ids.pickup })).status).toBe(400); // still pending
    expect((await gate({})).status).toBe(400); // nobody named
    expect((await send(ct, 'post', `/api/admin/school/safety/pickups/${ids.pickup}/decision`, { decision: 'approved' })).status).toBe(403);
    expect((await send(principal, 'post', `/api/admin/school/safety/pickups/${ids.pickup}/decision`, { decision: 'approved' })).status).toBe(200);
    expect((await gate({ pickupId: ids.pickup, studentId: ids.bela })).status).toBe(400); // approved for Anya, not for Bela
    const ok = await gate({ pickupId: ids.pickup, reason: 'Doctor appointment' }); expect(ok.status).toBe(201);
    expect((await gate({ guardianId: ids.guardianAnya })).status).toBe(201); // a guardian may always collect
    const seen = await send(pA, 'get', `/api/family/children/${ids.anya}/safety`); expect(seen.body.gate.length).toBe(2);
    expect((await send(pB, 'get', `/api/family/children/${ids.anya}/safety`)).status).toBe(404);
    await send(principal, 'post', `/api/admin/school/safety/pickups/${ids.pickup}/decision`, { decision: 'revoked' });
    expect((await gate({ pickupId: ids.pickup })).status).toBe(400); // revoked people cannot collect
  });
  it('records late arrivals and tells the family, and only gate staff may record', async () => {
    expect((await send(ct, 'post', '/api/admin/school/safety/gate', { studentId: ids.anya, kind: 'late_arrival' })).status).toBe(403);
    expect((await send(admin, 'post', '/api/admin/school/safety/gate', { studentId: ids.anya, kind: 'late_arrival', reason: 'Bus delay' })).status).toBe(201);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where n.title='Arrived late'")).rowCount).toBeGreaterThan(0);
  });
});

describe('incidents', () => {
  it('lets a teacher report, shows them only their own reports, and keeps bullying confidential', async () => {
    const r = await send(ct, 'post', '/api/admin/school/safety/incidents', { kind: 'bullying', severity: 'high', description: 'Name-calling at lunch', confidential: false, students: [{ id: ids.anya, role: 'affected' }, { id: ids.bela, role: 'involved' }] });
    expect(r.status).toBe(201); ids.incident = r.body.id; expect(r.body.code).toMatch(/^INC-\d{4}-\d{4}$/);
    expect((await query('select confidential from incidents where id=$1', [ids.incident])).rows[0].confidential).toBe(true);
    expect((await send(ct, 'get', '/api/admin/school/safety/incidents')).body).toHaveLength(1);
    expect((await send(other, 'get', '/api/admin/school/safety/incidents')).body).toHaveLength(0);
    expect((await send(other, 'get', `/api/admin/school/safety/incidents/${ids.incident}`)).status).toBe(404);
    expect((await send(principal, 'get', '/api/admin/school/safety/incidents')).body).toHaveLength(1);
    expect((await send(pA, 'get', '/api/admin/school/safety/incidents')).status).toBe(403);
    expect((await query("select count(*)::int n from notifications where title like 'New incident%'")).rows[0].n).toBeGreaterThan(0); // handlers were told
  });
  it('lets only managers change status, and requires a resolution before closing', async () => {
    expect((await send(ct, 'patch', `/api/admin/school/safety/incidents/${ids.incident}`, { status: 'investigating' })).status).toBe(403);
    expect((await send(principal, 'patch', `/api/admin/school/safety/incidents/${ids.incident}`, { status: 'investigating' })).status).toBe(200);
    expect((await send(principal, 'patch', `/api/admin/school/safety/incidents/${ids.incident}`, { status: 'closed' })).status).toBe(400);
    expect((await send(principal, 'post', `/api/admin/school/safety/incidents/${ids.incident}/notes`, { note: 'Spoke to both students' })).status).toBe(201);
    expect((await send(principal, 'patch', `/api/admin/school/safety/incidents/${ids.incident}`, { status: 'resolved', resolution: 'Mediation held, parents informed' })).status).toBe(200);
  });
  it('tells a family only what the school chooses to say, and only for students in the incident', async () => {
    expect((await send(principal, 'post', `/api/admin/school/safety/incidents/${ids.incident}/notify-family`, { studentId: ids.chitra, message: 'x' })).status).toBe(400);
    expect((await send(principal, 'post', `/api/admin/school/safety/incidents/${ids.incident}/notify-family`, { studentId: ids.anya, message: 'We would like to talk to you about lunchtime.' })).status).toBe(200);
  });
});

describe('parent-teacher meetings', () => {
  it('lets a teacher offer times and only parents of that teacher’s class book one, once', async () => {
    const mk = await send(ct, 'post', '/api/admin/school/meetings/slots', { startsAt: FUT(3), minutes: 15, count: 3, mode: 'in_person', location: 'Staff room' });
    expect(mk.status).toBe(201); expect(mk.body.created).toBe(3);
    expect((await send(ct, 'post', '/api/admin/school/meetings/slots', { startsAt: FUT(-1), count: 1 })).status).toBe(400); // past
    const open = await send(pA, 'get', `/api/family/children/${ids.anya}/meetings`); expect(open.body.open).toHaveLength(3); ids.slot = open.body.open[0].id; ids.slot2 = open.body.open[1].id;
    expect((await send(pB, 'get', `/api/family/children/${ids.anya}/meetings`)).status).toBe(404);
    const other2 = await mkSlotFor(other); // a teacher who does not teach Anya
    expect((await send(pA, 'post', `/api/family/children/${ids.anya}/meetings`, { slotId: other2 })).status).toBe(404);
    expect((await send(pA, 'post', `/api/family/children/${ids.anya}/meetings`, { slotId: ids.slot, agenda: 'Maths progress' })).status).toBe(201);
    expect((await send(pB, 'post', `/api/family/children/${ids.bela}/meetings`, { slotId: ids.slot })).status).toBe(409); // already taken: exactly one parent wins
    expect((await send(pA, 'post', `/api/family/children/${ids.anya}/meetings`, { slotId: ids.slot2 })).status).toBe(409); // one upcoming meeting per teacher
    expect((await query("select 1 from notifications where title='Parent meeting booked'")).rowCount).toBe(1);
  });
  it('frees the time when a parent cancels, and notifies parents when a teacher cancels', async () => {
    const mine = (await send(pA, 'get', `/api/family/children/${ids.anya}/meetings`)).body.mine[0];
    expect((await send(pB, 'delete', `/api/family/children/${ids.anya}/meetings/${mine.id}`)).status).toBe(404);
    expect((await send(pA, 'delete', `/api/family/children/${ids.anya}/meetings/${mine.id}`)).status).toBe(200);
    expect((await send(pB, 'post', `/api/family/children/${ids.bela}/meetings`, { slotId: ids.slot })).status).toBe(201);
    const del = await send(ct, 'delete', `/api/admin/school/meetings/slots/${ids.slot}`); expect(del.body.notified).toBe(1);
    expect((await send(other, 'delete', `/api/admin/school/meetings/slots/${ids.slot2}`)).status).toBe(404); // someone else's slot
  });
});
async function mkSlotFor(s: S) { const r = await send(s, 'post', '/api/admin/school/meetings/slots', { startsAt: FUT(4), count: 1 }); expect(r.status).toBe(201); return (await query('select id from meeting_slots where staff_id=$1 order by id desc limit 1', [ids.other])).rows[0].id as number; }

describe('homework submissions and grading', () => {
  it('lets a family hand in work, and only the right teacher mark it', async () => {
    ids.hw = (await query("insert into assignments (section_id, subject_id, staff_id, kind, title, due_on, max_marks) values ($1,$2,$3,'homework','Fractions sheet', current_date + 2, 10) returning id", [ids.secA, ids.maths, ids.ct])).rows[0].id;
    expect((await send(pA, 'post', `/api/family/children/${ids.anya}/homework/${ids.hw}/submission`, {})).status).toBe(400); // nothing written
    expect((await send(pA, 'post', `/api/family/children/${ids.anya}/homework/${ids.hw}/submission`, { body: 'Answers: 1/2, 3/4' })).status).toBe(201);
    expect((await send(pB, 'get', `/api/family/children/${ids.anya}/homework/${ids.hw}/submission`)).status).toBe(404);
    const chitraHw = (await query("insert into assignments (section_id, subject_id, staff_id, kind, title, due_on) values ($1,$2,$3,'homework','Other class', current_date + 2) returning id", [ids.secB, ids.maths, ids.other])).rows[0].id;
    expect((await send(pA, 'post', `/api/family/children/${ids.anya}/homework/${chitraHw}/submission`, { body: 'x' })).status).toBe(404); // homework of another class
    const list = await send(ct, 'get', `/api/admin/school/classwork/homework/${ids.hw}/submissions`); expect(list.body.counts).toEqual({ total: 2, submitted: 1, graded: 0 });
    expect((await send(other, 'get', `/api/admin/school/classwork/homework/${ids.hw}/submissions`)).status).toBe(404);
    ids.sub = list.body.rows.find((r: any) => r.submission_id).submission_id;
    expect((await send(ct, 'put', `/api/admin/school/classwork/submissions/${ids.sub}/grade`, { status: 'graded', marks: 11 })).status).toBe(400); // over the maximum
    expect((await send(ct, 'put', `/api/admin/school/classwork/submissions/${ids.sub}/grade`, { status: 'graded' })).status).toBe(400); // marks needed
    expect((await send(other, 'put', `/api/admin/school/classwork/submissions/${ids.sub}/grade`, { status: 'graded', marks: 8 })).status).toBe(404);
    expect((await send(ct, 'put', `/api/admin/school/classwork/submissions/${ids.sub}/grade`, { status: 'graded', marks: 8, feedback: 'Good work' })).status).toBe(200);
    const after = await send(pA, 'get', `/api/family/children/${ids.anya}/homework/${ids.hw}/submission`); expect(after.body.submission).toMatchObject({ status: 'graded', marks: 8, feedback: 'Good work' });
    expect((await send(pA, 'post', `/api/family/children/${ids.anya}/homework/${ids.hw}/submission`, { body: 'changed' })).status).toBe(409); // marked work is final
  });
  it('accepts a real file, refuses a disguised one, and serves it only to the family and the teacher', async () => {
    const hw2 = (await query("insert into assignments (section_id, subject_id, staff_id, kind, title, due_on) values ($1,$2,$3,'homework','Poster', current_date + 5) returning id", [ids.secA, ids.maths, ids.ct])).rows[0].id;
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
    const bad = await pB.a.post(`/api/family/children/${ids.bela}/homework/${hw2}/submission`).set(pB.h).attach('file', Buffer.from('<script>alert(1)</script>'), 'x.pdf'); expect(bad.status).toBe(400);
    const ok = await pB.a.post(`/api/family/children/${ids.bela}/homework/${hw2}/submission`).set(pB.h).attach('file', pdf, 'poster.pdf'); expect(ok.status).toBe(201);
    const f = await pB.a.get(`/api/family/children/${ids.bela}/homework/${hw2}/submission/file`); expect(f.status).toBe(200); expect(f.headers['content-type']).toBe('application/pdf'); expect(f.headers['cache-control']).toContain('no-store');
    expect((await pA.a.get(`/api/family/children/${ids.bela}/homework/${hw2}/submission/file`)).status).toBe(404);
    const row = (await query('select id from assignment_submissions where assignment_id=$1', [hw2])).rows[0].id;
    expect((await ct.a.get(`/api/admin/school/classwork/submissions/${row}/file`)).status).toBe(200);
    expect((await other.a.get(`/api/admin/school/classwork/submissions/${row}/file`)).status).toBe(404);
  });
});

describe('lesson plans and learning materials', () => {
  it('lets teachers plan only classes they teach, and shows families the plan and shared materials for their own class', async () => {
    const plan = { sectionId: ids.secA, subjectId: ids.maths, plannedOn: iso(new Date(Date.now() + 86400000)), topic: 'Equivalent fractions', objectives: 'Compare fractions' };
    expect((await send(other, 'post', '/api/admin/school/classwork/lesson-plans', plan)).status).toBe(403);
    expect((await send(ct, 'post', '/api/admin/school/classwork/lesson-plans', plan)).status).toBe(201);
    expect((await send(ct, 'post', '/api/admin/school/classwork/materials', { sectionId: ids.secA, subjectId: ids.maths, title: 'Fractions video', linkUrl: 'https://example.org/video' })).status).toBe(201);
    expect((await send(ct, 'post', '/api/admin/school/classwork/materials', { sectionId: ids.secA, subjectId: ids.maths, title: 'Bad link', linkUrl: 'javascript:alert(1)' })).status).toBe(400);
    const fam = await send(pA, 'get', `/api/family/children/${ids.anya}/classwork`); expect(fam.body.plans[0].topic).toBe('Equivalent fractions'); expect(fam.body.materials[0].title).toBe('Fractions video');
    expect((await send(pA, 'get', `/api/family/children/${ids.chitra}/classwork`)).status).toBe(404);
    expect((await send(other, 'get', '/api/admin/school/classwork/lesson-plans')).body).toHaveLength(0); // a teacher sees their own plans
  });
});

describe('development beyond marks', () => {
  it('records activities and observations, shares only what is marked for families, and lists students who may need support', async () => {
    expect((await send(other, 'post', `/api/admin/school/growth/students/${ids.anya}/activities`, { kind: 'sport', title: 'Relay', occurredOn: iso(new Date()) })).status).toBe(404); // not their class
    expect((await send(ct, 'post', `/api/admin/school/growth/students/${ids.anya}/activities`, { kind: 'sport', title: 'Inter-school relay', level: 'inter_school', occurredOn: iso(new Date()), result: 'Silver', visibleToFamily: true })).status).toBe(201);
    expect((await send(ct, 'post', `/api/admin/school/growth/students/${ids.anya}/activities`, { kind: 'arts', title: 'Private note', occurredOn: iso(new Date()), visibleToFamily: false })).status).toBe(201);
    expect((await send(ct, 'post', `/api/admin/school/growth/students/${ids.anya}/observations`, { category: 'social', note: 'Helps classmates', sharedWithFamily: true })).status).toBe(201);
    expect((await send(ct, 'post', `/api/admin/school/growth/students/${ids.anya}/observations`, { category: 'wellbeing', note: 'Seems withdrawn lately', sharedWithFamily: false, needsSupport: true })).status).toBe(201);
    const fam = await send(pA, 'get', `/api/family/children/${ids.anya}/growth`); expect(fam.body.activities.map((a: any) => a.title)).toEqual(['Inter-school relay']); expect(fam.body.notes.map((n: any) => n.note)).toEqual(['Helps classmates']);
    expect((await send(pB, 'get', `/api/family/children/${ids.anya}/growth`)).status).toBe(404);
    const list = await send(ct, 'get', '/api/admin/school/growth/support-list'); expect(list.body.map((r: any) => r.full_name)).toContain('Anya Rao'); expect(list.body[0].reasons[0]).toBe('Flagged by a teacher');
    expect((await send(other, 'get', '/api/admin/school/growth/support-list')).body.map((r: any) => r.full_name)).not.toContain('Anya Rao');
  });
});

describe('reports', () => {
  it('gives school-wide reports to principals and admins, not to teachers or families', async () => {
    for (const path of ['workload', 'enrolment', 'transport', 'safety']) {
      expect((await send(principal, 'get', `/api/admin/school/reports/${path}`)).status).toBe(200);
      expect((await send(ct, 'get', `/api/admin/school/reports/${path}`)).status).toBe(403);
    }
    const w = (await send(admin, 'get', '/api/admin/school/reports/workload')).body; expect(w.teachers).toBe(2);
    const e = (await send(admin, 'get', '/api/admin/school/reports/enrolment')).body; expect(e.totals.active).toBe(3);
    expect((await send(admin, 'get', '/api/admin/school/reports/safety')).body.openHigh).toBe(0); // the only high incident was resolved
  });
});

describe('message delivery (email / SMS / WhatsApp)', () => {
  let server: http.Server; const got: { body: any; sig?: string }[] = []; let mode: 'ok' | 'fail' = 'ok'; let port = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { got.push({ body: JSON.parse(b), sig: req.headers['x-signature'] as string }); res.statusCode = mode === 'ok' ? 200 : 500; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'prov-1' })); }); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); port = (server.address() as any).port;
  });
  afterAll(() => { (config as any).NOTIFY_PROVIDER = 'off'; server.close(); });
  const on = () => { (config as any).NOTIFY_PROVIDER = 'webhook'; (config as any).NOTIFY_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`; (config as any).NOTIFY_WEBHOOK_SECRET = 'a-long-test-secret-value'; };

  it('queues nothing while no provider is configured', async () => {
    await query('delete from outbox'); await send(admin, 'post', '/api/admin/school/safety/gate', { studentId: ids.anya, kind: 'late_arrival' });
    expect((await query('select count(*)::int n from outbox')).rows[0].n).toBe(0);
  });
  it('lets a person choose channels and mute topics, but never safety messages', async () => {
    expect((await send(pA, 'put', '/api/prefs', { email: true, sms: true, whatsapp: false, mutedCategories: ['fees', 'attendance'] })).status).toBe(200);
    expect((await send(pA, 'put', '/api/prefs', { email: true, sms: false, whatsapp: false, mutedCategories: ['safety'] })).status).toBe(400); // safety is not mutable
    expect((await send(pA, 'put', '/api/prefs', { email: true, sms: true, whatsapp: false, mutedCategories: ['fees', 'attendance'] })).status).toBe(200);
    expect((await send(pA, 'get', '/api/prefs')).body.sms).toBe(true);
    expect((await send(pB, 'get', '/api/prefs')).body.sms).toBe(false); // each person sees only their own
  });
  it('queues email and SMS for a family that opted in, sends a signed request, and does not send twice', async () => {
    on(); await query('delete from outbox'); got.length = 0;
    await send(admin, 'post', '/api/admin/school/safety/gate', { studentId: ids.anya, kind: 'late_arrival', reason: 'Traffic' });
    const rows = (await query('select channel, status from outbox order by channel')).rows;
    expect(rows.map((r) => r.channel)).toEqual(['email', 'sms']); // not WhatsApp: not opted in
    const r = await processOutbox(); expect(r.sent).toBe(2); expect(got).toHaveLength(2);
    expect(got[0].sig).toMatch(/^[0-9a-f]{64}$/);
    await send(admin, 'post', '/api/admin/school/safety/gate', { studentId: ids.anya, kind: 'late_arrival', reason: 'Traffic' }); // identical message the same day
    expect((await query('select count(*)::int n from outbox')).rows[0].n).toBe(2);
  });
  it('respects muted topics but still delivers safety messages', async () => {
    await query('delete from outbox');
    const { enqueueForUsers } = await import('../src/lib/delivery');
    const uid = (await query('select id from users where login_id=$1', [ids.codeA])).rows[0].id;
    expect(await enqueueForUsers([uid], { title: 'Fee due', body: 'x', category: 'fees' })).toBe(0);
    expect(await enqueueForUsers([uid], { title: 'Safety', body: 'y', category: 'safety' })).toBe(2);
  });
  it('retries failures with backoff, then marks them failed and lets an administrator retry', async () => {
    await query('delete from outbox'); mode = 'fail'; got.length = 0;
    const uid = (await query('select id from users where login_id=$1', [ids.codeA])).rows[0].id;
    const { enqueueForUsers } = await import('../src/lib/delivery'); await enqueueForUsers([uid], { title: 'Retry me', body: 'z', category: 'safety' });
    for (let i = 0; i < 5; i++) { await query("update outbox set next_attempt_at = now() where status='queued'"); await processOutbox(); }
    const st = (await query('select distinct status, attempts from outbox')).rows; expect(st).toEqual([{ status: 'failed', attempts: 5 }]);
    const log = (await send(admin, 'get', '/api/admin/outbox')).body; expect(log.rows[0].to_address).not.toContain('example'); // contact details are masked in the log
    expect((await send(ct, 'get', '/api/admin/outbox')).status).toBe(403);
    mode = 'ok'; const id = (await query('select id from outbox limit 1')).rows[0].id;
    expect((await send(admin, 'post', `/api/admin/outbox/${id}/retry`, {})).status).toBe(200);
    expect((await processOutbox()).sent).toBeGreaterThanOrEqual(1);
  });
});

describe('configurable grading, late fees, waiting list, privacy export and SEO', () => {
  it('changes how percentages become grades when the school picks another scale', async () => {
    const { gradeOf, refreshGrading } = await import('../src/lib/grading');
    expect(gradeOf(95)).toBe('A+');
    expect((await send(admin, 'put', '/api/admin/cms/settings', { grading_scale: 'CBSE-style 9-point (A1 to E2)', board: 'CBSE' })).status).toBe(200);
    expect(gradeOf(95)).toBe('A1'); expect(gradeOf(35)).toBe('D');
    await query("update site_settings set value='' where key='grading_scale'"); await refreshGrading(true); expect(gradeOf(95)).toBe('A+');
  });
  it('adds one late fee to overdue charges, once, and only when switched on', async () => {
    const head = (await query("insert into fee_heads (name) values ('Tuition') returning id")).rows[0].id;
    const yr = (await query('select id from academic_years limit 1')).rows[0].id;
    await query("insert into fee_charges (student_id, academic_year_id, head_id, description, amount, due_on, period_key) values ($1,$2,$3,'Tuition – old', 1000, current_date - 30, 'old')", [ids.anya, yr, head]);
    const run = () => send(admin, 'post', '/api/admin/school/fees/late-fees/run', {});
    expect((await run()).body.applied).toBe(0); // off by default
    await send(admin, 'put', '/api/admin/cms/settings', { late_fee_flat: '50', late_fee_grace_days: '7' });
    expect((await run()).body).toEqual({ applied: 1, perFee: 50 });
    expect((await run()).body.applied).toBe(0); // never twice
    const adj = (await query("select amount::float as amount, kind from fee_adjustments")).rows; expect(adj).toEqual([{ amount: 50, kind: 'late_fee' }]);
    expect((await send(pA, 'get', `/api/family/children/${ids.anya}/fees`)).status).toBe(200);
  });
  it('puts an application on the waiting list with a note, and can still approve it later', async () => {
    const y = (await query('select id from academic_years limit 1')).rows[0].id; const c = (await query('select id from classes limit 1')).rows[0].id;
    const sub = await request(app).post('/api/apply/submit').send({ academicYearId: y, classId: c, studentName: 'Wait Child', dateOfBirth: '2018-06-01', gender: 'male', address: '5 Lake Road', guardianName: 'Anil Pillai', guardianRelation: 'Father', guardianPhone: '9876500123', guardianEmail: 'a@example.com', consent: true });
    expect(sub.status).toBe(201);
    const id = (await query('select id from applications order by id desc limit 1')).rows[0].id;
    expect((await send(adm, 'post', `/api/admin/school/admissions/${id}/action`, { action: 'waitlist' })).status).toBe(400);
    expect((await send(adm, 'post', `/api/admin/school/admissions/${id}/action`, { action: 'waitlist', note: 'Seats full; position 3' })).body.status).toBe('waitlisted');
    expect((await query('select status from applications where id=$1', [id])).rows[0].status).toBe('waitlisted');
  });
  it('exports a student’s personal data only for people allowed to, and logs it', async () => {
    expect((await send(ct, 'get', `/api/admin/school/privacy/students/${ids.anya}/export`)).status).toBe(403);
    expect((await send(principal, 'get', `/api/admin/school/privacy/students/${ids.anya}/export`)).status).toBe(403);
    const r = await send(admin, 'get', `/api/admin/school/privacy/students/${ids.anya}/export`); expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain('attachment'); const d = JSON.parse(r.text); expect(d.student.full_name).toBe('Anya Rao'); expect(d.emergencyContacts.length).toBe(1);
    expect(JSON.stringify(d)).not.toContain('Bela'); // nothing about another child
    expect((await query("select 1 from audit_logs where action='privacy.student_export'")).rowCount).toBe(1);
  });
  it('publishes robots.txt and a sitemap that list only public pages', async () => {
    const robots = await request(app).get('/robots.txt'); expect(robots.status).toBe(200); expect(robots.text).toContain('Disallow: /portal'); expect(robots.text).toContain('Sitemap:');
    const map = await request(app).get('/sitemap.xml'); expect(map.status).toBe(200); expect(map.text).toContain('<urlset'); expect(map.text).not.toMatch(/portal|family|login|api/);
  });
});
