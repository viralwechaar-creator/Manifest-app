import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool, query } from '../src/db';
import { hashPassword } from '../src/lib/password';
import { migrate } from '../src/migrate';
import { formatStudentId, validateFormat } from '../src/modules/school/studentId';

const app = createApp();
const PW = 'Correct-horse-42';
async function user(loginId: string, role: string) {
  const u = await query('insert into users (login_id, display_name, password_hash) values ($1::citext,$1,$2) returning id', [loginId, await hashPassword(PW)]);
  await query('insert into user_roles select $1, id from roles where code=$2', [u.rows[0].id, role]);
  return u.rows[0].id as string;
}
async function login(loginId: string) {
  const a = request.agent(app);
  await a.post('/api/auth/login').send({ loginId, password: PW });
  const me = await a.get('/api/auth/me');
  return { a, h: { 'x-csrf-token': me.body.csrfToken as string } };
}
const g = { fullName: 'Parent One', relation: 'Mother', phone: '9876500001' };
let secA = 0, secB = 0, secNext = 0;

beforeAll(async () => {
  await query('drop schema public cascade; create schema public;');
  await migrate();
  await user('admin', 'school_admin');
  const tUser = await user('teacher.a', 'teacher');
  await user('teacher.none', 'teacher');
  await user('hr', 'hr_staff');
  await user('adm', 'admission_staff');
  const y1 = (await query("insert into academic_years (label, starts_on, ends_on, is_current) values ('2026-27','2026-04-01','2027-03-31',true) returning id")).rows[0].id;
  const y2 = (await query("insert into academic_years (label, starts_on, ends_on) values ('2027-28','2027-04-01','2028-03-31') returning id")).rows[0].id;
  const c1 = (await query("insert into classes (name, level) values ('Class 1',1) returning id")).rows[0].id;
  const c2 = (await query("insert into classes (name, level) values ('Class 2',2) returning id")).rows[0].id;
  secA = (await query("insert into sections (class_id, academic_year_id, name, capacity) values ($1,$2,'A',2) returning id", [c1, y1])).rows[0].id;
  secB = (await query("insert into sections (class_id, academic_year_id, name, capacity) values ($1,$2,'B',30) returning id", [c1, y1])).rows[0].id;
  secNext = (await query("insert into sections (class_id, academic_year_id, name) values ($1,$2,'A') returning id", [c2, y2])).rows[0].id;
  const sub = (await query("insert into subjects (name, code) values ('Maths','MAT') returning id")).rows[0].id;
  await query('insert into class_subjects values ($1,$2)', [c1, sub]);
  const st = (await query("insert into staff (user_id, staff_code, full_name, kind, designation) values ($1,'S0001','Teacher A','teacher','Teacher') returning id", [tUser])).rows[0].id;
  await query('insert into teacher_assignments (staff_id, section_id, subject_id) values ($1,$2,$3)', [st, secA, sub]);
});
afterAll(async () => { await pool.end(); });

describe('student ID format', () => {
  it('formats and validates', () => {
    expect(formatStudentId('{YYYY}-{NNNN}', 2026, 7)).toBe('2026-0007');
    expect(formatStudentId('GFA{NNNNN}', 2026, 42)).toBe('GFA00042');
    expect(validateFormat('{YYYY}-{NNNN}')).toBeNull();
    expect(validateFormat('no-number')).not.toBeNull();
    expect(validateFormat('{NNNN}{NNNN}')).not.toBeNull();
    expect(validateFormat('<script>{NNNN}')).not.toBeNull();
  });
});

describe('student registration and access', () => {
  it('issues unique sequential IDs, even for simultaneous registrations, and shares guardians between siblings', async () => {
    const { a, h } = await login('adm');
    const mk = (n: string, sec: number) => a.post('/api/admin/school/students').set(h).send({ fullName: n, dateOfBirth: '2018-05-01', gender: 'female', sectionId: sec, admissionDate: '2026-04-10', address: '12 Lake Rd', healthNotes: 'Asthma', guardians: [g] });
    const rs = await Promise.all([mk('Sib One', secB), mk('Sib Two', secB), mk('Sib Three', secB)]);
    expect(rs.every((r) => r.status === 201)).toBe(true);
    const codes = rs.map((r) => r.body.studentCode).sort();
    expect(codes).toEqual(['2026-0001', '2026-0002', '2026-0003']);
    expect((await query('select count(*)::int n from guardians')).rows[0].n).toBe(1); // same parent phone = one guardian, three children
    expect((await query('select count(*)::int n from enrolments')).rows[0].n).toBe(3);
  });
  it('enforces section capacity', async () => {
    const { a, h } = await login('adm');
    const mk = (n: string) => a.post('/api/admin/school/students').set(h).send({ fullName: n, dateOfBirth: '2018-05-01', gender: 'male', sectionId: secA, guardians: [{ ...g, phone: '9876500002' }] });
    expect((await mk('Cap One')).status).toBe(201);
    expect((await mk('Cap Two')).status).toBe(201);
    expect((await mk('Cap Three')).status).toBe(409);
  });
  it('teachers only see students of their own sections, and no sensitive data', async () => {
    const { a } = await login('teacher.a');
    const list = await a.get('/api/admin/school/students');
    expect(list.status).toBe(200);
    expect(list.body.rows.map((r: any) => r.full_name).sort()).toEqual(['Cap One', 'Cap Two']);
    const own = list.body.rows[0].id;
    const detail = await a.get(`/api/admin/school/students/${own}`);
    expect(detail.status).toBe(200);
    expect(detail.body.address).toBeUndefined();
    expect(detail.body.health_notes).toBeUndefined();
    expect(detail.body.guardians[0].phone).toBeUndefined();
    const other = (await query("select id from students where full_name='Sib One'")).rows[0].id;
    expect((await a.get(`/api/admin/school/students/${other}`)).status).toBe(404); // out of scope: same as not found
  });
  it('a teacher with no assignments sees nobody; cannot register or promote', async () => {
    const { a, h } = await login('teacher.none');
    expect((await a.get('/api/admin/school/students')).body.total).toBe(0);
    expect((await a.post('/api/admin/school/students').set(h).send({})).status).toBe(403);
    expect((await a.post('/api/admin/school/students/promote').set(h).send({ studentIds: [1], targetSectionId: secNext })).status).toBe(403);
  });
  it('sensitive access is audited for authorised staff', async () => {
    const { a } = await login('adm');
    const id = (await query("select id from students where full_name='Sib One'")).rows[0].id;
    const d = await a.get(`/api/admin/school/students/${id}`);
    expect(d.body.address).toBe('12 Lake Rd');
    expect(d.body.guardians[0].phone).toBe('9876500001');
    expect((await query("select 1 from audit_logs where action='student.sensitive_viewed'")).rowCount).toBeGreaterThan(0);
  });
});

describe('status, promotion and staff', () => {
  it('status changes need a reason and are logged; leavers end their enrolment', async () => {
    const { a, h } = await login('adm');
    const id = (await query("select id from students where full_name='Cap Two'")).rows[0].id;
    expect((await a.post(`/api/admin/school/students/${id}/status`).set(h).send({ status: 'withdrawn', reason: '' })).status).toBe(400);
    expect((await a.post(`/api/admin/school/students/${id}/status`).set(h).send({ status: 'withdrawn', reason: 'Family moved' })).status).toBe(200);
    expect((await query('select outcome from enrolments where student_id=$1', [id])).rows[0].outcome).toBe('withdrawn');
    expect((await query('select count(*)::int n from student_status_log where student_id=$1', [id])).rows[0].n).toBe(2);
  });
  it('promotes into a later year and keeps academic history', async () => {
    const { a, h } = await login('adm');
    const id = (await query("select id from students where full_name='Sib One'")).rows[0].id;
    const same = await a.post('/api/admin/school/students/promote').set(h).send({ studentIds: [id], targetSectionId: secB });
    expect(same.status).toBe(400);
    const ok = await a.post('/api/admin/school/students/promote').set(h).send({ studentIds: [id], targetSectionId: secNext });
    expect(ok.status).toBe(200);
    const hist = (await query('select outcome, section_id from enrolments where student_id=$1 order by id', [id])).rows;
    expect(hist).toHaveLength(2);
    expect(hist[0].outcome).toBe('promoted');
    expect((await query('select section_id from students where id=$1', [id])).rows[0].section_id).toBe(secNext);
  });
  it('HR creates a teacher with a login; contact details hidden from teachers', async () => {
    const hr = await login('hr');
    const r = await hr.a.post('/api/admin/school/staff').set(hr.h).send({ fullName: 'New Teacher', kind: 'teacher', designation: 'PGT Science', phone: '9000000000', login: { loginId: 'new.teacher', role: 'teacher' } });
    expect(r.status).toBe(201);
    expect(r.body.temporaryPassword).toBeTruthy();
    const t = await login('teacher.a');
    const list = await t.a.get('/api/admin/school/staff');
    expect(list.status).toBe(200);
    expect(list.body.rows[0].phone).toBeUndefined();
    const asHr = await hr.a.get('/api/admin/school/staff');
    expect(asHr.body.rows.find((x: any) => x.full_name === 'New Teacher').phone).toBe('9000000000');
    expect((await t.a.post('/api/admin/school/staff').set(t.h).send({})).status).toBe(403);
  });
  it('a staff member who leaves loses access immediately', async () => {
    const hr = await login('hr');
    const sid = (await query("select id from staff where full_name='New Teacher'")).rows[0].id;
    await hr.a.patch(`/api/admin/school/staff/${sid}`).set(hr.h).send({ status: 'left' });
    expect((await query("select status from users where login_id='new.teacher'")).rows[0].status).toBe('suspended');
  });
  it('academic setup is admin-only and the current year stays unique', async () => {
    const t = await login('teacher.a');
    expect((await t.a.post('/api/admin/school/classes').set(t.h).send({ name: 'X', level: 9 })).status).toBe(403);
    const ad = await login('admin');
    const y = (await query("select id from academic_years where label='2027-28'")).rows[0].id;
    expect((await ad.a.post(`/api/admin/school/years/${y}/current`).set(ad.h)).status).toBe(200);
    expect((await query('select count(*)::int n from academic_years where is_current')).rows[0].n).toBe(1);
    expect((await ad.a.post('/api/admin/school/years').set(ad.h).send({ label: 'bad', startsOn: '2030-01-01', endsOn: '2029-01-01' })).status).toBe(400);
  });
});
