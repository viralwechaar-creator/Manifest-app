import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool, query } from '../src/db';
import { hashPassword } from '../src/lib/password';
import { migrate } from '../src/migrate';

const app = createApp();
const PW = 'Correct-horse-42';
const NEWPW = 'Fresh-Parent-2026';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = (() => { const d = new Date(); if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1); return iso(d); })();
const FUT = iso(new Date(Date.now() + 5 * 86400000));
const ids: Record<string, number> = {}; const temps: Record<string, string> = {};

async function mkUser(loginId: string, role: string) {
  const u = await query('insert into users (login_id, display_name, password_hash) values ($1::citext,$1,$2) returning id', [loginId, await hashPassword(PW)]);
  await query('insert into user_roles select $1, id from roles where code=$2', [u.rows[0].id, role]); return u.rows[0].id as string;
}
async function login(loginId: string, pw = PW) {
  const a = request.agent(app); const r = await a.post('/api/auth/login').send({ loginId, password: pw });
  const me = r.status === 200 ? await a.get('/api/auth/me') : null;
  return { a, status: r.status, h: { 'x-csrf-token': (me?.body.csrfToken ?? '') as string } };
}
async function parentSession(loginId: string) {
  const known = await login(loginId, NEWPW); if (known.status === 200) return known; // already changed earlier
  const first = await login(loginId, temps[loginId]);
  await first.a.post('/api/auth/change-password').set(first.h).send({ currentPassword: temps[loginId], newPassword: NEWPW });
  return login(loginId, NEWPW);
}

beforeAll(async () => {
  await query('drop schema public cascade; create schema public;'); await migrate();
  await mkUser('adm', 'admission_staff'); await mkUser('principal', 'principal'); await mkUser('admin', 'school_admin');
  const uCT = await mkUser('ct', 'teacher'), uOther = await mkUser('other', 'teacher');
  const y = (await query("insert into academic_years (label, starts_on, ends_on, is_current) values ('Y','2020-01-01','2099-12-31',true) returning id")).rows[0].id;
  const c = (await query("insert into classes (name, level) values ('Class 3',3) returning id")).rows[0].id; ids.c = c;
  const stf = async (code: string, n: string, u: string) => (await query("insert into staff (user_id, staff_code, full_name, kind, designation) values ($1,$2,$3,'teacher','T') returning id", [u, code, n])).rows[0].id as number;
  ids.ct = await stf('S1', 'Class Teacher', uCT); ids.other = await stf('S2', 'Other Teacher', uOther);
  ids.secA = (await query("insert into sections (class_id, academic_year_id, name, class_teacher_id) values ($1,$2,'A',$3) returning id", [c, y, ids.ct])).rows[0].id;
  ids.secB = (await query("insert into sections (class_id, academic_year_id, name, class_teacher_id) values ($1,$2,'B',$3) returning id", [c, y, ids.other])).rows[0].id;
  ids.maths = (await query("insert into subjects (name, code) values ('Maths','MAT') returning id")).rows[0].id;
  await query('insert into class_subjects values ($1,$2)', [c, ids.maths]);
  await query('insert into teacher_assignments (staff_id, section_id, subject_id) values ($1,$2,$3)', [ids.ct, ids.secA, ids.maths]);
  // Registration through the API issues the parent login together with the student ID.
  const adm = await login('adm'); await query("insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='admission_staff' and p.code in ('students.sensitive') on conflict do nothing");
  const reg = (body: any) => adm.a.post('/api/admin/school/students').set(adm.h).send({ dateOfBirth: '2017-01-01', gender: 'female', admissionDate: '2026-04-01', issueParentLogin: true, ...body });
  const a1 = await reg({ fullName: 'Anya Rao', sectionId: ids.secA, guardians: [{ fullName: 'Rao Parent', relation: 'Mother', phone: '9000000001' }] });
  const a2 = await reg({ fullName: 'Arun Rao', sectionId: ids.secB, guardians: [{ fullName: 'Rao Parent', relation: 'Mother', phone: '9000000001' }] }); // sibling in the other section
  const b1 = await reg({ fullName: 'Bela Sen', sectionId: ids.secA, guardians: [{ fullName: 'Sen Parent', relation: 'Father', phone: '9000000002' }] });
  ids.anya = a1.body.id; ids.arun = a2.body.id; ids.bela = b1.body.id;
  temps[a1.body.studentCode] = a1.body.parentLogin.temporaryPassword; temps[b1.body.studentCode] = b1.body.parentLogin.temporaryPassword;
  ids.codeAnya = a1.body.studentCode as any; ids.codeArun = a2.body.studentCode as any; ids.codeBela = b1.body.studentCode as any;
  (ids as any).a2 = a2.body;
});
afterAll(async () => { await pool.end(); });
const code = (n: 'codeAnya' | 'codeArun' | 'codeBela') => ids[n] as unknown as string;

describe('parent accounts', () => {
  it('issues one account per parent, reachable by every child ID, and forces a password change', async () => {
    expect((ids as any).a2.parentLogin.existingAccount).toBe(true); expect((ids as any).a2.parentLogin.temporaryPassword).toBeNull();
    const first = await login(code('codeAnya'), temps[code('codeAnya')]);
    expect(first.status).toBe(200);
    expect((await first.a.get('/api/family/children')).status).toBe(403); // must change password first
    const p = await parentSession(code('codeAnya'));
    const kids = await p.a.get('/api/family/children');
    expect(kids.body.children.map((k: any) => k.full_name).sort()).toEqual(['Anya Rao', 'Arun Rao']);
    expect((await login(code('codeArun'), NEWPW)).status).toBe(200); // sibling ID signs in to the same account
    expect((await login(code('codeAnya'), 'wrong-pass-123')).status).toBe(401);
  });
});

describe('family data isolation', () => {
  it('a parent cannot reach another family’s child on any endpoint (IDOR)', async () => {
    const p = await parentSession(code('codeAnya'));
    for (const path of ['overview', 'attendance', 'results', 'homework', 'timetable', 'remarks', 'leave', 'performance']) {
      expect((await p.a.get(`/api/family/children/${ids.bela}/${path}`)).status, path).toBe(404);
      expect((await p.a.get(`/api/family/children/${ids.anya}/${path}`)).status, 'own ' + path).toBe(200);
    }
    expect((await p.a.post(`/api/family/children/${ids.bela}/leave`).set(p.h).send({ fromDate: FUT, toDate: FUT, reason: 'trip' })).status).toBe(404);
    expect((await p.a.get('/api/family/children/abc/overview')).status).toBe(404);
  });
  it('family accounts cannot use any staff API; staff cannot use the family API', async () => {
    const p = await parentSession(code('codeBela'));
    for (const path of ['/api/admin/school/students', '/api/admin/school/exams', '/api/admin/users', '/api/admin/cms/entities/news', '/api/admin/dashboard', '/api/admin/school/timetable?sectionId=1', '/api/admin/school/staff']) {
      expect([401, 403], path).toContain((await p.a.get(path)).status);
    }
    const t = await login('ct'); expect((await t.a.get('/api/family/children')).status).toBe(403);
    expect((await request(app).get('/api/family/children')).status).toBe(401);
  });
});

describe('attendance, results and rank privacy', () => {
  it('shows attendance and notifies the parent of an absence', async () => {
    const ct = await login('ct');
    const r = await ct.a.put('/api/admin/school/attendance/students').set(ct.h).send({ sectionId: ids.secA, date: TODAY, records: [{ studentId: ids.anya, status: 'absent' }, { studentId: ids.bela, status: 'present' }] });
    expect(r.status).toBe(200);
    const p = await parentSession(code('codeAnya'));
    const a = await p.a.get(`/api/family/children/${ids.anya}/attendance?month=${TODAY.slice(0, 7)}`);
    expect(a.body.days.find((d: any) => d.date === TODAY).status).toBe('absent'); expect(a.body.totals.absent).toBe(1);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id=$1 and n.title='Marked absent'", [code('codeAnya')])).rowCount).toBe(1);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id=$1 and n.title='Marked absent'", [code('codeBela')])).rowCount).toBe(0);
  });
  it('hides unpublished results, then shows only the child’s own rank after publishing', async () => {
    const ad = await login('admin'); const ct = await login('ct');
    const exam = (await ad.a.post('/api/admin/school/exams').set(ad.h).send({ name: 'Unit Test', kind: 'unit_test', academicYearId: 1 })).body.id;
    await ad.a.post(`/api/admin/school/exams/${exam}/subjects`).set(ad.h).send({ classId: ids.c, subjectId: ids.maths, maxMarks: 20, passMarks: 8 });
    const xs = (await ad.a.get(`/api/admin/school/exams/${exam}/subjects`)).body[0].id;
    await ct.a.put('/api/admin/school/marks').set(ct.h).send({ examSubjectId: xs, sectionId: ids.secA, records: [{ studentId: ids.anya, marks: 15 }, { studentId: ids.bela, marks: 18 }] });
    const other = await login('other');
    await other.a.put('/api/admin/school/marks').set(other.h).send({ examSubjectId: xs, sectionId: ids.secB, records: [{ studentId: ids.arun, marks: 12 }] }); // other teacher: not assigned to Maths in B
    await query('insert into marks (exam_subject_id, student_id, marks) values ($1,$2,12)', [xs, ids.arun]);
    const p = await parentSession(code('codeAnya'));
    expect((await p.a.get(`/api/family/children/${ids.anya}/results`)).body).toEqual([]);
    expect((await p.a.get(`/api/family/children/${ids.anya}/report/${exam}`)).status).toBe(404);
    expect((await ad.a.post(`/api/admin/school/exams/${exam}/publish`).set(ad.h).send({ published: true })).status).toBe(200);
    const res = await p.a.get(`/api/family/children/${ids.anya}/results`);
    expect(res.body).toHaveLength(1); expect(res.body[0].total).toBe(15); expect(res.body[0].classRank).toBe(2); expect(res.body[0].classSize).toBe(3);
    const rep = await p.a.get(`/api/family/children/${ids.anya}/report/${exam}`);
    expect(rep.status).toBe(200);
    expect(JSON.stringify(rep.body)).not.toContain('Bela'); expect(JSON.stringify(res.body)).not.toContain('Bela'); // no other child's name anywhere
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id=$1 and n.title='Results published'", [code('codeAnya')])).rowCount).toBe(1);
    const perf = await p.a.get(`/api/family/children/${ids.anya}/performance`);
    expect(perf.body.subjects[0].averagePct).toBe(75);
  });
});

describe('leave, notices, remarks and student logins', () => {
  let leaveId = 0;
  it('parent applies for leave; only the class teacher decides; approval excuses the days', async () => {
    const p = await parentSession(code('codeAnya')); const ct = await login('ct'); const other = await login('other');
    expect((await p.a.post(`/api/family/children/${ids.anya}/leave`).set(p.h).send({ fromDate: '2020-01-01', toDate: '2020-01-02', reason: 'old' })).status).toBe(400);
    const r = await p.a.post(`/api/family/children/${ids.anya}/leave`).set(p.h).send({ fromDate: FUT, toDate: FUT, reason: 'Wedding in family' });
    expect(r.status).toBe(201); leaveId = r.body.id;
    expect((await p.a.post(`/api/family/children/${ids.anya}/leave`).set(p.h).send({ fromDate: FUT, toDate: FUT, reason: 'again, please' })).status).toBe(409);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id='ct' and n.title='Student leave request'")).rowCount).toBe(1);
    expect((await other.a.post(`/api/admin/school/student-leave/${leaveId}/decision`).set(other.h).send({ decision: 'approved' })).status).toBe(404);
    expect((await other.a.get('/api/admin/school/student-leave')).body).toHaveLength(0);
    expect((await ct.a.post(`/api/admin/school/student-leave/${leaveId}/decision`).set(ct.h).send({ decision: 'approved', note: 'Take care' })).status).toBe(200);
    const roster = await ct.a.get(`/api/admin/school/attendance/students?sectionId=${ids.secA}&date=${TODAY}`); expect(roster.status).toBe(200);
    const lv = await p.a.get(`/api/family/children/${ids.anya}/leave`); expect(lv.body[0].status).toBe('approved');
    expect((await ct.a.post(`/api/admin/school/student-leave/${leaveId}/decision`).set(ct.h).send({ decision: 'rejected' })).status).toBe(409);
  });
  it('notices reach only the intended audience', async () => {
    const ad = await login('admin');
    expect((await ad.a.post('/api/admin/school/notices').set(ad.h).send({ title: 'Class A trip', body: 'Bring lunch', audience: 'section', sectionId: ids.secA })).status).toBe(201);
    expect((await ad.a.post('/api/admin/school/notices').set(ad.h).send({ title: 'Staff meeting', body: 'Friday', audience: 'staff' })).status).toBe(201);
    expect((await ad.a.post('/api/admin/school/notices').set(ad.h).send({ title: 'Bad', body: 'x', audience: 'section' })).status).toBe(400);
    const bela = await parentSession(code('codeBela')); const arunSide = await parentSession(code('codeAnya'));
    const titles = (r: any) => r.body.map((n: any) => n.title);
    expect(titles(await bela.a.get('/api/family/notices'))).toContain('Class A trip');
    expect(titles(await bela.a.get('/api/family/notices'))).not.toContain('Staff meeting');
    expect(titles(await arunSide.a.get('/api/family/notices'))).toContain('Class A trip'); // Anya is in A
    expect((await bela.a.post('/api/admin/school/notices').set(bela.h).send({ title: 'x', body: 'y', audience: 'everyone' })).status).toBe(403);
  });
  it('teachers write remarks only for their own students; parents see only shared ones', async () => {
    const ct = await login('ct'); const other = await login('other');
    expect((await ct.a.post(`/api/admin/school/students/${ids.anya}/remarks`).set(ct.h).send({ kind: 'praise', text: 'Great participation', visibleToParent: true })).status).toBe(201);
    expect((await ct.a.post(`/api/admin/school/students/${ids.anya}/remarks`).set(ct.h).send({ kind: 'concern', text: 'Internal staff note', visibleToParent: false })).status).toBe(201);
    expect((await other.a.post(`/api/admin/school/students/${ids.anya}/remarks`).set(other.h).send({ kind: 'note', text: 'Not my class', visibleToParent: true })).status).toBe(404);
    const p = await parentSession(code('codeAnya')); const r = await p.a.get(`/api/family/children/${ids.anya}/remarks`);
    expect(r.body.map((x: any) => x.text)).toEqual(['Great participation']);
  });
  it('a student gets their own login that sees only themselves and cannot apply for leave', async () => {
    const adm = await login('adm'); const s = await adm.a.post(`/api/admin/school/students/${ids.bela}/student-login`).set(adm.h);
    expect(s.status).toBe(201); expect(s.body.loginId).toBe(`${code('codeBela')}-S`);
    expect((await adm.a.post(`/api/admin/school/students/${ids.bela}/student-login`).set(adm.h)).status).toBe(409);
    temps[s.body.loginId] = s.body.temporaryPassword; const st = await parentSession(s.body.loginId);
    const kids = await st.a.get('/api/family/children'); expect(kids.body.role).toBe('student'); expect(kids.body.children).toHaveLength(1);
    expect((await st.a.get(`/api/family/children/${ids.anya}/overview`)).status).toBe(404);
    expect((await st.a.post(`/api/family/children/${ids.bela}/leave`).set(st.h).send({ fromDate: FUT, toDate: FUT, reason: 'I want a day off' })).status).toBe(403);
    const teacher = await login('ct'); expect((await teacher.a.post(`/api/admin/school/students/${ids.bela}/student-login`).set(teacher.h)).status).toBe(403);
  });
});

describe('no family can reach another family\'s child (automatic sweep of every child route)', () => {
  it('answers 404 for every child-specific route when the child belongs to someone else', async () => {
    const { listRoutes } = await import('../src/app');
    const routes = listRoutes(app).filter((r) => r.path.startsWith('/api/family') && r.path.includes('/children/:id'));
    expect(routes.length).toBeGreaterThanOrEqual(14);
    const p = await parentSession(code('codeAnya')); const bad: string[] = [];
    for (const r of routes) {
      const url = r.path.replace(':id', String(ids.bela)).replace(/:[A-Za-z]+/g, '1');
      const res = await (p.a as any)[r.method.toLowerCase()](url).set(r.method === 'GET' ? {} : p.h).send(r.method === 'GET' ? undefined : {});
      if (res.status !== 404) bad.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
    // and nobody can reach a child by a non-numeric or negative ID
    for (const weird of ['abc', '-1', '0', '1e3', '1;drop']) expect((await p.a.get(`/api/family/children/${weird}/overview`)).status).toBe(404);
  });
});
