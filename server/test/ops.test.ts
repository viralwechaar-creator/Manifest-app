import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool, query } from '../src/db';
import { hashPassword } from '../src/lib/password';
import { migrate } from '../src/migrate';
import { rankBy } from '../src/modules/school/exams';

const app = createApp();
const PW = 'Correct-horse-42';
const iso = (d: Date) => d.toISOString().slice(0, 10);
function nextMonday() { const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); return iso(d); }
const MON = nextMonday();
const TODAY = iso(new Date());

async function mkUser(loginId: string, role: string) {
  const u = await query('insert into users (login_id, display_name, password_hash) values ($1::citext,$1,$2) returning id', [loginId, await hashPassword(PW)]);
  await query('insert into user_roles select $1, id from roles where code=$2', [u.rows[0].id, role]);
  return u.rows[0].id as string;
}
async function mkStaff(code: string, name: string, userId: string | null, dept: number | null = null) {
  return (await query("insert into staff (user_id, staff_code, full_name, kind, designation, department_id) values ($1,$2,$3,'teacher','Teacher',$4) returning id", [userId, code, name, dept])).rows[0].id as number;
}
async function login(loginId: string) {
  const a = request.agent(app); await a.post('/api/auth/login').send({ loginId, password: PW });
  return { a, h: { 'x-csrf-token': (await a.get('/api/auth/me')).body.csrfToken as string } };
}
const ids: Record<string, number> = {};

beforeAll(async () => {
  await query('drop schema public cascade; create schema public;'); await migrate();
  await mkUser('admin', 'school_admin'); await mkUser('hr', 'hr_staff'); await mkUser('principal', 'principal');
  const uA = await mkUser('tA', 'teacher'), uB = await mkUser('tB', 'teacher'), uC = await mkUser('tC', 'teacher'), uD = await mkUser('tD', 'teacher');
  ids.tA = await mkStaff('S1', 'Teacher A', uA); ids.tB = await mkStaff('S2', 'Teacher B', uB); ids.tC = await mkStaff('S3', 'Teacher C', uC); ids.tD = await mkStaff('S4', 'Teacher D', uD);
  const y = (await query("insert into academic_years (label, starts_on, ends_on, is_current) values ('Y','2020-01-01','2099-12-31',true) returning id")).rows[0].id; ids.y = y;
  const c = (await query("insert into classes (name, level) values ('Class 5',5) returning id")).rows[0].id; ids.c = c;
  ids.secA = (await query("insert into sections (class_id, academic_year_id, name, class_teacher_id) values ($1,$2,'A',$3) returning id", [c, y, ids.tA])).rows[0].id;
  ids.secB = (await query("insert into sections (class_id, academic_year_id, name, class_teacher_id) values ($1,$2,'B',$3) returning id", [c, y, ids.tD])).rows[0].id;
  ids.maths = (await query("insert into subjects (name, code) values ('Maths','MAT') returning id")).rows[0].id;
  ids.eng = (await query("insert into subjects (name, code) values ('English','ENG') returning id")).rows[0].id;
  for (const s of [ids.maths, ids.eng]) await query('insert into class_subjects values ($1,$2)', [c, s]);
  const ta = (t: number, s: number, sub: number) => query('insert into teacher_assignments (staff_id, section_id, subject_id) values ($1,$2,$3)', [t, s, sub]);
  await ta(ids.tA, ids.secA, ids.maths); await ta(ids.tD, ids.secB, ids.maths); await ta(ids.tB, ids.secA, ids.eng); await ta(ids.tB, ids.secB, ids.eng);
  ids.p1 = (await query("insert into periods (number, name, starts_at, ends_at) values (1,'Period 1','09:00','09:45') returning id")).rows[0].id;
  ids.p2 = (await query("insert into periods (number, name, starts_at, ends_at) values (2,'Period 2','09:45','10:30') returning id")).rows[0].id;
  ids.brk = (await query("insert into periods (number, name, starts_at, ends_at, is_break) values (3,'Break','10:30','10:45',true) returning id")).rows[0].id;
  const stu = async (n: string, sec: number) => (await query("insert into students (student_code, full_name, date_of_birth, gender, section_id) values ($1,$2,'2015-01-01','female',$3) returning id", ['ST-' + n, n, sec])).rows[0].id as number;
  ids.s1 = await stu('Asha', ids.secA); ids.s2 = await stu('Bela', ids.secA); ids.s3 = await stu('Chitra', ids.secA); ids.s4 = await stu('Dev', ids.secA); ids.s5 = await stu('Esha', ids.secB);
});
afterAll(async () => { await pool.end(); });

describe('ranking helper', () => {
  it('gives equal scores the same rank and skips the next', () => {
    const items = [{ s: 90 }, { s: 90 }, { s: 70 }, { s: 50 }];
    const r = rankBy(items, (x) => x.s);
    expect(items.map((i) => r.get(i))).toEqual([1, 1, 3, 4]);
  });
});

describe('timetable', () => {
  it('builds slots and refuses to double-book a teacher or use a break', async () => {
    const ad = await login('admin');
    const put = (b: any) => ad.a.put('/api/admin/school/timetable/slot').set(ad.h).send(b);
    expect((await put({ sectionId: ids.secA, day: 1, periodId: ids.p1, subjectId: ids.maths, staffId: ids.tA })).status).toBe(200);
    expect((await put({ sectionId: ids.secB, day: 1, periodId: ids.p1, subjectId: ids.maths, staffId: ids.tD })).status).toBe(200);
    expect((await put({ sectionId: ids.secA, day: 1, periodId: ids.p2, subjectId: ids.eng, staffId: ids.tB })).status).toBe(200);
    const clash = await put({ sectionId: ids.secB, day: 1, periodId: ids.p2, subjectId: ids.eng, staffId: ids.tB });
    expect(clash.status).toBe(409); expect(clash.body.error).toContain('already teaches');
    expect((await put({ sectionId: ids.secA, day: 2, periodId: ids.brk, subjectId: ids.maths, staffId: ids.tA })).status).toBe(400);
    expect((await put({ sectionId: ids.secA, day: 2, periodId: ids.p1, subjectId: ids.maths, staffId: ids.tC })).status).toBe(400); // tC not assigned to Maths in 5A
    const tA = await login('tA');
    expect((await tA.a.put('/api/admin/school/timetable/slot').set(tA.h).send({ sectionId: ids.secA, day: 3, periodId: ids.p1, subjectId: ids.maths, staffId: ids.tA })).status).toBe(403);
    const mine = await tA.a.get('/api/admin/school/timetable/my');
    expect(mine.body.slots).toHaveLength(1);
  });
});

describe('student attendance', () => {
  it('only the class teacher (or admin) can mark; future dates and strangers are rejected', async () => {
    const tA = await login('tA'), tD = await login('tD');
    const rec = [{ studentId: ids.s1, status: 'present' }, { studentId: ids.s2, status: 'absent' }, { studentId: ids.s3, status: 'late' }, { studentId: ids.s4, status: 'present' }];
    const put = (u: any, sec: number, date: string, records: any[]) => u.a.put('/api/admin/school/attendance/students').set(u.h).send({ sectionId: sec, date, records });
    const dow = new Date(TODAY + 'T00:00:00Z').getUTCDay();
    const day = dow === 0 ? iso(new Date(Date.now() - 86400000)) : TODAY; // never Sunday
    expect((await put(tA, ids.secA, day, rec)).status).toBe(200);
    expect((await put(tD, ids.secA, day, rec)).status).toBe(403);
    expect((await put(tA, ids.secA, '2999-01-01', rec)).status).toBe(400);
    expect((await put(tA, ids.secA, day, [{ studentId: ids.s5, status: 'present' }])).status).toBe(400); // student of another section
    const roster = await tA.a.get(`/api/admin/school/attendance/students?sectionId=${ids.secA}&date=${day}`);
    expect(roster.body.rows.find((r: any) => r.id === ids.s2).status).toBe('absent');
    expect((await tA.a.get(`/api/admin/school/attendance/students?sectionId=${ids.secB}&date=${day}`)).status).toBe(403);
    const pr = await login('principal');
    const sum = await pr.a.get(`/api/admin/school/attendance/summary?from=${day}&to=${day}`);
    expect(sum.body.find((s: any) => s.section === 'Class 5 A').pct).toBe('75.0');
  });
});

describe('leave, vacant periods and substitution', () => {
  let leaveId = 0;
  it('applies, validates and gets approved by HR; approval marks the teacher on leave', async () => {
    const tA = await login('tA'); const hr = await login('hr');
    expect((await tA.a.post('/api/admin/school/leave').set(tA.h).send({ fromDate: MON, toDate: MON, reason: '' })).status).toBe(400);
    expect((await tA.a.post('/api/admin/school/leave').set(tA.h).send({ fromDate: '2020-01-01', toDate: '2020-01-02', reason: 'past' })).status).toBe(400);
    const r = await tA.a.post('/api/admin/school/leave').set(tA.h).send({ fromDate: MON, toDate: MON, reason: 'Family function' });
    expect(r.status).toBe(201); leaveId = r.body.id;
    expect((await tA.a.post('/api/admin/school/leave').set(tA.h).send({ fromDate: MON, toDate: MON, reason: 'again please' })).status).toBe(409);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id='hr' and n.title='Leave request'")).rowCount).toBe(1);
    expect((await tA.a.post(`/api/admin/school/leave/${leaveId}/decision`).set(tA.h).send({ decision: 'approved' })).status).toBe(403); // cannot self-approve
    expect((await hr.a.post(`/api/admin/school/leave/${leaveId}/decision`).set(hr.h).send({ decision: 'approved' })).status).toBe(200);
    expect((await hr.a.post(`/api/admin/school/leave/${leaveId}/decision`).set(hr.h).send({ decision: 'rejected' })).status).toBe(409);
    expect((await query("select status from staff_attendance where staff_id=$1 and date=$2", [ids.tA, MON])).rows[0].status).toBe('on_leave');
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id='tA' and n.title='Leave approved'")).rowCount).toBe(1);
  });
  it('shows the vacant period and offers only genuinely free teachers', async () => {
    const ad = await login('admin');
    const v = await ad.a.get(`/api/admin/school/substitutions/vacancies?date=${MON}`);
    expect(v.body.rows).toHaveLength(1); expect(v.body.rows[0].section).toBe('Class 5 A'); expect(v.body.open).toBe(1);
    const slot = v.body.rows[0].slot_id;
    const c = await ad.a.get(`/api/admin/school/substitutions/candidates?date=${MON}&slotId=${slot}`);
    const names = c.body.map((x: any) => x.full_name);
    expect(names).toContain('Teacher B'); expect(names).toContain('Teacher C');
    expect(names).not.toContain('Teacher D'); // teaching another class in that period
    expect(names).not.toContain('Teacher A'); // the absent teacher
    ids.slot = slot;
  });
  it('assigns a substitute once, notifies them, and rejects busy or duplicate assignments', async () => {
    const ad = await login('admin');
    const body = (staffId: number) => ({ date: MON, slotId: ids.slot, staffId });
    expect((await ad.a.post('/api/admin/school/substitutions').set(ad.h).send(body(ids.tD))).status).toBe(409);
    expect((await ad.a.post('/api/admin/school/substitutions').set(ad.h).send(body(ids.tC))).status).toBe(201);
    expect((await ad.a.post('/api/admin/school/substitutions').set(ad.h).send(body(ids.tB))).status).toBe(409);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id='tC' and n.title='Substitution assigned'")).rowCount).toBe(1);
    const tC = await login('tC');
    expect((await tC.a.get('/api/admin/school/timetable/my')).body.substitutions).toHaveLength(1);
    expect((await ad.a.get(`/api/admin/school/substitutions/vacancies?date=${MON}`)).body.open).toBe(0);
    const tB = await login('tB');
    expect((await tB.a.post('/api/admin/school/substitutions').set(tB.h).send(body(ids.tB))).status).toBe(403);
  });
  it('a teacher who is not actually absent creates no vacancy', async () => {
    const ad = await login('admin');
    const slotTD = (await query('select id from timetable_slots where staff_id=$1', [ids.tD])).rows[0].id;
    expect((await ad.a.post('/api/admin/school/substitutions').set(ad.h).send({ date: MON, slotId: slotTD, staffId: ids.tC })).status).toBe(400);
  });
});

describe('exams, marks and rankings', () => {
  let exam = 0, xsM = 0, xsE = 0;
  it('admin creates an exam and configures subjects; teacher cannot', async () => {
    const ad = await login('admin'); const tA = await login('tA');
    exam = (await ad.a.post('/api/admin/school/exams').set(ad.h).send({ name: 'Unit Test 1', kind: 'unit_test', academicYearId: ids.y })).body.id;
    expect((await tA.a.post('/api/admin/school/exams').set(tA.h).send({ name: 'x', kind: 'unit_test', academicYearId: ids.y })).status).toBe(403);
    expect((await ad.a.post(`/api/admin/school/exams/${exam}/subjects`).set(ad.h).send({ classId: ids.c, subjectId: ids.maths, maxMarks: 20, passMarks: 8 })).status).toBe(201);
    expect((await ad.a.post(`/api/admin/school/exams/${exam}/subjects`).set(ad.h).send({ classId: ids.c, subjectId: ids.eng, maxMarks: 20, passMarks: 8 })).status).toBe(201);
    expect((await ad.a.post(`/api/admin/school/exams/${exam}/subjects`).set(ad.h).send({ classId: ids.c, subjectId: ids.eng, maxMarks: 5, passMarks: 8 })).status).toBe(400);
    const subs = (await ad.a.get(`/api/admin/school/exams/${exam}/subjects`)).body; xsM = subs.find((s: any) => s.subject === 'Maths').id; xsE = subs.find((s: any) => s.subject === 'English').id;
  });
  it('teachers enter marks only for classes and subjects they teach, within the maximum', async () => {
    const tA = await login('tA'); const tB = await login('tB');
    const put = (u: any, xs: number, sec: number, records: any[]) => u.a.put('/api/admin/school/marks').set(u.h).send({ examSubjectId: xs, sectionId: sec, records });
    expect((await put(tA, xsM, ids.secA, [{ studentId: ids.s1, marks: 18 }, { studentId: ids.s2, marks: 18 }, { studentId: ids.s3, marks: 15 }, { studentId: ids.s4, marks: null, absent: true }])).status).toBe(200);
    expect((await put(tA, xsM, ids.secA, [{ studentId: ids.s1, marks: 25 }])).status).toBe(400);
    expect((await put(tA, xsE, ids.secA, [{ studentId: ids.s1, marks: 10 }])).status).toBe(403); // does not teach English
    expect((await put(tA, xsM, ids.secB, [{ studentId: ids.s5, marks: 10 }])).status).toBe(403); // not their section
    expect((await put(tB, xsE, ids.secA, [{ studentId: ids.s1, marks: 16 }, { studentId: ids.s2, marks: 16 }, { studentId: ids.s3, marks: 12 }, { studentId: ids.s4, marks: 9 }])).status).toBe(200);
    const roster = await tA.a.get(`/api/admin/school/marks?examSubjectId=${xsM}&sectionId=${ids.secA}`);
    expect(roster.status).toBe(200); expect(roster.body.rows.find((r: any) => r.id === ids.s4).absent).toBe(true);
  });
  it('ranks by total with ties sharing a rank; incomplete students are not ranked', async () => {
    const ad = await login('admin');
    const r = await ad.a.get(`/api/admin/school/exams/${exam}/results?sectionId=${ids.secA}`);
    const by = (n: string) => r.body.rows.find((x: any) => x.name === n);
    expect(by('Asha').total).toBe(34); expect(by('Asha').classRank).toBe(1); expect(by('Bela').classRank).toBe(1);
    expect(by('Chitra').classRank).toBe(3); expect(by('Chitra').grade).toBe('C'); expect(by('Chitra').percentage).toBe(67.5);
    expect(by('Dev').passed).toBe(false); expect(by('Dev').failedSubjects).toEqual(['Maths']);
    expect(by('Asha').subjects.find((s: any) => s.subject === 'Maths').rank).toBe(1);
    const all = await ad.a.get(`/api/admin/school/exams/${exam}/results`);
    expect(all.body.rows.find((x: any) => x.name === 'Esha').complete).toBe(false); // section B: nothing entered
    expect(all.body.rows.find((x: any) => x.name === 'Esha').classRank).toBeNull();
  });
  it('scopes results: a teacher sees only their classes; report card and remark rules hold', async () => {
    const tA = await login('tA'); const tD = await login('tD');
    expect((await tA.a.get(`/api/admin/school/exams/${exam}/results?sectionId=${ids.secB}`)).status).toBe(403);
    expect((await tA.a.get(`/api/admin/school/report/${ids.s1}?examId=${exam}`)).status).toBe(200);
    expect((await tA.a.get(`/api/admin/school/report/${ids.s5}?examId=${exam}`)).status).toBe(404);
    expect((await tA.a.put(`/api/admin/school/report/${ids.s1}/remark`).set(tA.h).send({ examId: exam, remark: 'Excellent effort' })).status).toBe(200); // class teacher
    expect((await tD.a.put(`/api/admin/school/report/${ids.s1}/remark`).set(tD.h).send({ examId: exam, remark: 'x' })).status).toBe(403);
    const rc = await tA.a.get(`/api/admin/school/report/${ids.s1}?examId=${exam}`);
    expect(rc.body.remark).toBe('Excellent effort'); expect(rc.body.attendance.marked).toBeGreaterThan(0);
  });
  it('blocks publishing with missing marks, then locks marks after publishing', async () => {
    const ad = await login('admin'); const tA = await login('tA');
    const pub = await ad.a.post(`/api/admin/school/exams/${exam}/publish`).set(ad.h).send({ published: true });
    expect(pub.status).toBe(409); expect(pub.body.error).toContain('missing');
    const xsM2 = xsM; await query('insert into marks (exam_subject_id, student_id, marks) values ($1,$2,10),($3,$2,10)', [xsM2, ids.s5, xsE]);
    expect((await ad.a.post(`/api/admin/school/exams/${exam}/publish`).set(ad.h).send({ published: true })).status).toBe(200);
    const edit = await tA.a.put('/api/admin/school/marks').set(tA.h).send({ examSubjectId: xsM, sectionId: ids.secA, records: [{ studentId: ids.s3, marks: 19 }] });
    expect(edit.status).toBe(409);
    expect((await ad.a.put('/api/admin/school/marks').set(ad.h).send({ examSubjectId: xsM, sectionId: ids.secA, records: [{ studentId: ids.s3, marks: 19 }] })).status).toBe(200); // admin correction, audited
    expect((await query("select 1 from audit_logs where action='marks.entered' and details->>'afterPublish'='true'")).rowCount).toBeGreaterThan(0);
    expect((await ad.a.delete(`/api/admin/school/exams/${exam}`).set(ad.h)).status).toBe(409);
  });
});

describe('homework', () => {
  it('teachers set work only for their own classes and subjects', async () => {
    const tA = await login('tA'); const ad = await login('admin');
    const due = iso(new Date(Date.now() + 3 * 86400000));
    const mk = (u: any, b: any) => u.a.post('/api/admin/school/homework').set(u.h).send({ kind: 'homework', title: 'Fractions', dueOn: due, ...b });
    expect((await mk(tA, { sectionId: ids.secA, subjectId: ids.maths })).status).toBe(201);
    expect((await mk(tA, { sectionId: ids.secA, subjectId: ids.eng })).status).toBe(403);
    expect((await mk(tA, { sectionId: ids.secB, subjectId: ids.maths })).status).toBe(403);
    expect((await tA.a.post('/api/admin/school/homework').set(tA.h).send({ sectionId: ids.secA, subjectId: ids.maths, kind: 'homework', title: 'Old', dueOn: '2020-01-01' })).status).toBe(400);
    const list = await tA.a.get('/api/admin/school/homework'); expect(list.body).toHaveLength(1);
    const tD = await login('tD'); expect((await tD.a.get('/api/admin/school/homework')).body).toHaveLength(0);
    expect((await ad.a.get('/api/admin/school/homework')).body).toHaveLength(1);
    expect((await tD.a.delete(`/api/admin/school/homework/${list.body[0].id}`).set(tD.h)).status).toBe(404);
  });
});
