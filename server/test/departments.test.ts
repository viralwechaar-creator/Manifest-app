import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool, query } from '../src/db';
import { hashPassword } from '../src/lib/password';
import { migrate } from '../src/migrate';
import { sendLibraryReminders } from '../src/modules/school/library';

const app = createApp(); const PW = 'Correct-horse-42'; const NEW = 'Fresh-Parent-2026';
const ids: Record<string, any> = {}; const temps: Record<string, string> = {};
const PDF = Buffer.from('%PDF-1.4\n' + 'x'.repeat(40));
const MONTH = new Date().toISOString().slice(0, 7);
async function mkUser(loginId: string, role: string) { const u = await query('insert into users (login_id, display_name, password_hash) values ($1::citext,$1,$2) returning id', [loginId, await hashPassword(PW)]); await query('insert into user_roles select $1, id from roles where code=$2', [u.rows[0].id, role]); return u.rows[0].id as string; }
async function login(loginId: string, pw = PW) { const a = request.agent(app); const r = await a.post('/api/auth/login').send({ loginId, password: pw }); const me = r.status === 200 ? await a.get('/api/auth/me') : null; return { a, status: r.status, h: { 'x-csrf-token': (me?.body.csrfToken ?? '') as string } }; }
async function parent(code: string) { const k = await login(code, NEW); if (k.status === 200) return k; const f = await login(code, temps[code]); await f.a.post('/api/auth/change-password').set(f.h).send({ currentPassword: temps[code], newPassword: NEW }); return login(code, NEW); }
const S = '/api/admin/school';

beforeAll(async () => {
  await query('drop schema public cascade; create schema public;'); await migrate();
  for (const [l, r] of [['admin', 'school_admin'], ['principal', 'principal'], ['adm', 'admission_staff'], ['trans', 'transport_staff'], ['lib', 'librarian'], ['hr', 'hr_staff'], ['teacher', 'teacher'], ['other', 'teacher'], ['acc', 'accounts_staff']] as const) ids['u_' + l] = await mkUser(l, r);
  ids.y = (await query("insert into academic_years (label, starts_on, ends_on, is_current) values ('Y','2020-01-01','2099-12-31',true) returning id")).rows[0].id;
  ids.c = (await query("insert into classes (name, level) values ('Class 4',4) returning id")).rows[0].id;
  const st = async (code: string, name: string, uid: string | null) => (await query("insert into staff (user_id, staff_code, full_name, kind, designation) values ($1,$2,$3,'teacher','T') returning id", [uid, code, name])).rows[0].id as number;
  ids.sTeacher = await st('S1', 'Tina Teacher', ids.u_teacher); ids.sOther = await st('S2', 'Omar Other', ids.u_other); ids.sHr = await st('S3', 'Hari HR', ids.u_hr); ids.sNoLogin = await st('S4', 'No Login', null);
  ids.secA = (await query("insert into sections (class_id, academic_year_id, name, class_teacher_id) values ($1,$2,'A',$3) returning id", [ids.c, ids.y, ids.sTeacher])).rows[0].id;
  ids.secB = (await query("insert into sections (class_id, academic_year_id, name, class_teacher_id) values ($1,$2,'B',$3) returning id", [ids.c, ids.y, ids.sOther])).rows[0].id;
  const adm = await login('adm'); await query("insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='admission_staff' and p.code in ('students.sensitive') on conflict do nothing");
  const reg = async (name: string, sec: number, phone: string) => (await adm.a.post(`${S}/students`).set(adm.h).send({ fullName: name, dateOfBirth: '2016-01-01', gender: 'female', sectionId: sec, issueParentLogin: true, guardians: [{ fullName: name + ' Parent', relation: 'Mother', phone }] })).body;
  const a = await reg('Anya A', ids.secA, '9100000001'), b = await reg('Bela B', ids.secB, '9100000002');
  ids.anya = a.id; ids.bela = b.id; ids.codeAnya = a.studentCode; ids.codeBela = b.studentCode; temps[a.studentCode] = a.parentLogin.temporaryPassword; temps[b.studentCode] = b.parentLogin.temporaryPassword;
  ids.noLoginStudent = (await adm.a.post(`${S}/students`).set(adm.h).send({ fullName: 'No Login Kid', dateOfBirth: '2016-01-01', gender: 'male', sectionId: ids.secA, guardians: [{ fullName: 'NL', relation: 'Father', phone: '9100000003' }] })).body.id;
  await query('insert into subjects (name, code) values (\'Maths\',\'MAT\')'); await query('insert into class_subjects select $1, id from subjects', [ids.c]);
  await query('insert into teacher_assignments (staff_id, section_id, subject_id) select $1, $2, id from subjects', [ids.sTeacher, ids.secA]);
});
afterAll(async () => { await pool.end(); });

describe('parent-teacher messaging', () => {
  it('lets a parent write only to their child’s teachers, and a teacher only about their own students', async () => {
    const p = await parent(ids.codeAnya); const t = await login('teacher'); const o = await login('other');
    const list = await p.a.get(`/api/family/children/${ids.anya}/teachers`); expect(list.body.map((x: any) => x.full_name)).toEqual(['Tina Teacher']); expect(list.body[0].role).toBeTruthy();
    expect((await p.a.post('/api/family/messages').set(p.h).send({ studentId: ids.anya, teacherUserId: ids.u_other, subject: 'Hi', body: 'Hello' })).status).toBe(400); // not Anya's teacher
    expect((await p.a.post('/api/family/messages').set(p.h).send({ studentId: ids.bela, teacherUserId: ids.u_other, subject: 'Hi', body: 'Hello' })).status).toBe(404); // not their child
    const th = await p.a.post('/api/family/messages').set(p.h).send({ studentId: ids.anya, teacherUserId: ids.u_teacher, subject: 'Homework', body: 'How can I help with maths?' }); expect(th.status).toBe(201); ids.thread = th.body.id;
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id='teacher' and n.title='New message from a parent'")).rowCount).toBe(1);
    const inbox = await t.a.get(`${S}/messages/threads`); expect(inbox.body[0].unread).toBe(1);
    expect((await t.a.get(`${S}/messages/threads/${ids.thread}`)).body.messages).toHaveLength(1);
    expect((await t.a.get(`${S}/messages/threads`)).body[0].unread).toBe(0);
    expect((await t.a.post(`${S}/messages/threads/${ids.thread}/messages`).set(t.h).send({ body: 'Practice fractions daily.' })).status).toBe(201);
    expect((await p.a.get('/api/family/messages')).body[0].unread).toBe(1);
    expect((await o.a.get(`${S}/messages/threads/${ids.thread}`)).status).toBe(404); expect((await o.a.post(`${S}/messages/threads/${ids.thread}/messages`).set(o.h).send({ body: 'snoop' })).status).toBe(404);
    const pb = await parent(ids.codeBela); expect((await pb.a.get(`/api/family/messages/${ids.thread}`)).status).toBe(404);
  });
  it('teachers start conversations only for their own students and only with parents who have a login', async () => {
    const t = await login('teacher'); const o = await login('other');
    expect((await o.a.post(`${S}/messages/threads`).set(o.h).send({ studentId: ids.anya, subject: 'x', body: 'not mine' })).status).toBe(404);
    expect((await t.a.post(`${S}/messages/threads`).set(t.h).send({ studentId: ids.noLoginStudent, subject: 'Hello', body: 'Welcome' })).status).toBe(409);
    expect((await t.a.post(`${S}/messages/threads`).set(t.h).send({ studentId: ids.anya, subject: 'Great progress', body: 'Anya did well.' })).status).toBe(201);
    const acc = await login('acc'); expect((await acc.a.get(`${S}/messages/threads`)).status).toBe(403);
  });
});

describe('complaints', () => {
  it('parents raise concerns and see only non-internal replies; others cannot see them', async () => {
    const p = await parent(ids.codeAnya); const pr = await login('principal'); const pb = await parent(ids.codeBela);
    expect((await p.a.post('/api/family/complaints').set(p.h).send({ category: 'transport', subject: 'Bus is late', body: 'The bus is late every day.' })).status).toBe(201);
    expect((await p.a.post('/api/family/complaints').set(p.h).send({ category: 'transport', subject: 'x', body: 'short' })).status).toBe(400);
    const c = await p.a.post('/api/family/complaints').set(p.h).send({ studentId: ids.anya, category: 'transport', subject: 'Bus is very late', body: 'The bus is late again today.' }); ids.cmp = c.body.id; expect(c.body.ref).toMatch(/^CMP-\d{4}-0002$/);
    expect((await p.a.post('/api/family/complaints').set(p.h).send({ studentId: ids.bela, category: 'other', subject: 'About another child', body: 'This is not my child.' })).status).toBe(404);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id='principal' and n.title='New complaint'")).rowCount).toBe(2);
    expect((await pr.a.post(`${S}/complaints/${ids.cmp}/updates`).set(pr.h).send({ note: 'Internal: check with the transport desk.', internal: true })).status).toBe(201);
    expect((await pr.a.post(`${S}/complaints/${ids.cmp}/updates`).set(pr.h).send({ note: 'We are looking into it.', internal: false })).status).toBe(201);
    const mine = await p.a.get(`/api/family/complaints/${ids.cmp}`); expect(mine.body.updates.map((u: any) => u.note)).toEqual(['We are looking into it.']); expect(JSON.stringify(mine.body)).not.toContain('Internal');
    expect((await pb.a.get(`/api/family/complaints/${ids.cmp}`)).status).toBe(404); expect((await pb.a.get('/api/family/complaints')).body).toHaveLength(0);
    expect((await pr.a.patch(`${S}/complaints/${ids.cmp}`).set(pr.h).send({ status: 'resolved' })).status).toBe(400);
    expect((await pr.a.patch(`${S}/complaints/${ids.cmp}`).set(pr.h).send({ status: 'resolved', resolution: 'Route timing adjusted.' })).status).toBe(200);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id=$1 and n.title like 'Your concern is resolved'", [ids.codeAnya])).rowCount).toBe(1);
    const t = await login('teacher'); expect((await t.a.get(`${S}/complaints`)).status).toBe(403);
  });
  it('keeps staff-conduct complaints confidential and lets teachers raise student concerns only for their students', async () => {
    const p = await parent(ids.codeAnya); const pr = await login('principal');
    const conf = await p.a.post('/api/family/complaints').set(p.h).send({ category: 'staff_conduct', subject: 'About a teacher', body: 'A serious concern about conduct.' }); ids.conf = conf.body.id;
    const role = (await query("insert into roles (code, name, is_system) values ('deputy','Deputy',false) returning id")).rows[0].id; await query("insert into role_permissions select $1, id from permissions where code='complaints.handle'", [role]);
    const dep = await mkUser('deputy', 'teacher'); await query("delete from user_roles where user_id=$1", [dep]); await query('insert into user_roles values ($1,$2)', [dep, role]);
    const d = await login('deputy'); expect((await d.a.get(`${S}/complaints`)).body.map((x: any) => x.id)).not.toContain(ids.conf); expect((await d.a.get(`${S}/complaints/${ids.conf}`)).status).toBe(404);
    expect((await pr.a.get(`${S}/complaints/${ids.conf}`)).status).toBe(200); expect((await query("select 1 from audit_logs where action='complaint.confidential_viewed'")).rowCount).toBe(1);
    expect((await pr.a.patch(`${S}/complaints/${ids.conf}`).set(pr.h).send({ assignedTo: dep })).status).toBe(400); // the deputy may not handle confidential ones
    const t = await login('teacher'); const o = await login('other');
    expect((await o.a.post(`${S}/complaints`).set(o.h).send({ studentId: ids.anya, category: 'student_conduct', subject: 'Disruption', body: 'Disrupted the class twice.' })).status).toBe(404);
    const ok = await t.a.post(`${S}/complaints`).set(t.h).send({ studentId: ids.anya, category: 'student_conduct', subject: 'Disruption', body: 'Disrupted the class twice.' }); expect(ok.status).toBe(201);
    expect((await t.a.get(`${S}/complaints/mine`)).body).toHaveLength(1);
    const own = await pr.a.patch(`${S}/complaints/${ok.body.id}`).set(pr.h).send({ status: 'closed', resolution: 'Spoke to the student.' }); expect(own.status).toBe(200);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id='teacher' and n.link='/portal/complaints'")).rowCount).toBeGreaterThan(0);
  });
});

describe('transport', () => {
  it('manages vehicles, routes and stops with capacity and one-vehicle-one-route rules', async () => {
    const tr = await login('trans'); const T = `${S}/transport`;
    ids.v1 = (await tr.a.post(`${T}/vehicles`).set(tr.h).send({ regNo: 'ka01ab1234', capacity: 1 })).body.id; expect((await tr.a.post(`${T}/vehicles`).set(tr.h).send({ regNo: 'KA01AB1234', capacity: 10 })).status).toBe(409);
    ids.d1 = (await tr.a.post(`${T}/drivers`).set(tr.h).send({ fullName: 'Ravi Driver', phone: '9000012345', licenseNo: 'DL-123' })).body.id;
    ids.r1 = (await tr.a.post(`${T}/routes`).set(tr.h).send({ name: 'North', vehicleId: ids.v1, driverId: ids.d1, monthlyFee: 800 })).body.id;
    expect((await tr.a.post(`${T}/routes`).set(tr.h).send({ name: 'South', vehicleId: ids.v1 })).status).toBe(409);
    expect((await tr.a.put(`${T}/routes/${ids.r1}/stops`).set(tr.h).send({ stops: [{ name: 'Gate', pickupTime: '07:10', dropTime: '15:30' }, { name: 'Market', pickupTime: '07:25', dropTime: '15:45' }] })).status).toBe(200);
    ids.stops = (await tr.a.get(`${T}/routes`)).body.find((r: any) => r.id === ids.r1).stops.map((s: any) => s.id);
    const t = await login('teacher'); expect((await t.a.post(`${T}/vehicles`).set(t.h).send({ regNo: 'X1', capacity: 5 })).status).toBe(403);
    const drv = await login('principal'); const list = (await drv.a.get(`${T}/drivers`)).body; expect(list[0].phone).toBeUndefined(); expect(list[0].license_no).toBeUndefined(); // viewers do not get personal details
  });
  it('assigns students within capacity, raises the transport fee, and withdraws unpaid future fees on leaving', async () => {
    const tr = await login('trans'); const T = `${S}/transport`; const acc = await login('acc');
    const a1 = await tr.a.post(`${T}/assign`).set(tr.h).send({ studentId: ids.anya, routeId: ids.r1, stopId: ids.stops[0] }); expect(a1.status).toBe(201); expect(a1.body.feesRaised).toBeGreaterThan(0);
    expect((await tr.a.post(`${T}/assign`).set(tr.h).send({ studentId: ids.bela, routeId: ids.r1, stopId: ids.stops[1] })).status).toBe(409); // 1 seat only
    expect((await tr.a.post(`${T}/assign`).set(tr.h).send({ studentId: ids.anya, routeId: ids.r1, stopId: 99999 })).status).toBe(400);
    const dues = (await acc.a.get(`${S}/fees/students/${ids.anya}/dues`)).body.dues; expect(dues.every((d: any) => d.description.startsWith('Transport') && d.amount === 800)).toBe(true);
    await acc.a.post(`${S}/fees/payments`).set(acc.h).send({ studentId: ids.anya, amount: 800, mode: 'cash', paidOn: new Date().toISOString().slice(0, 10) }); // pays the first month
    const p = await parent(ids.codeAnya); const view = await p.a.get(`/api/family/children/${ids.anya}/transport`); expect(view.body.route).toBe('North'); expect(view.body.driver).toBe('Ravi Driver'); expect(view.body.stop).toBe('Gate');
    expect((await p.a.get(`/api/family/children/${ids.bela}/transport`)).status).toBe(404);
    expect((await tr.a.post(`${T}/routes/${ids.r1}/alert`).set(tr.h).send({ message: 'Bus delayed by 15 minutes today.' })).status).toBe(200);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id=$1 and n.title='Transport: North'", [ids.codeAnya])).rowCount).toBe(1);
    const students = (await tr.a.get(`${T}/routes/${ids.r1}/students`)).body; expect(students).toHaveLength(1); expect(students[0].parent_phone).toBe('9100000001');
    expect((await tr.a.put(`${T}/routes/${ids.r1}/stops`).set(tr.h).send({ stops: [{ name: 'Market' }] })).status).toBe(409); // Gate still has a student
    const un = await tr.a.post(`${T}/unassign/${ids.anya}`).set(tr.h); expect(un.status).toBe(200);
    const after = (await acc.a.get(`${S}/fees/students/${ids.anya}/dues`)).body.dues; expect(after).toHaveLength(1); expect(after[0].paid).toBe(800); // the paid month stays
    expect((await tr.a.post(`${T}/unassign/${ids.anya}`).set(tr.h)).status).toBe(404);
  });
});

describe('library', () => {
  it('issues within limits, charges late fees on return, blocks until paid, and lets a book be renewed once', async () => {
    const lb = await login('lib'); const L = `${S}/library`;
    const bk = await lb.a.post(`${L}/books`).set(lb.h).send({ title: 'The Jungle Book', author: 'Kipling', category: 'Fiction', copies: 2 }); expect(bk.status).toBe(201); const [acc1, acc2] = bk.body.accessionNumbers;
    const i1 = await lb.a.post(`${L}/issue`).set(lb.h).send({ accessionNo: acc1, borrowerCode: ids.codeAnya }); expect(i1.status).toBe(201);
    expect((await lb.a.post(`${L}/issue`).set(lb.h).send({ accessionNo: acc1, borrowerCode: ids.codeBela })).status).toBe(409); // already out
    expect((await lb.a.post(`${L}/issue`).set(lb.h).send({ accessionNo: acc2, borrowerCode: 'NOPE-1' })).status).toBe(404);
    expect((await lb.a.post(`${L}/loans/${i1.body.id}/renew`).set(lb.h)).status).toBe(200); expect((await lb.a.post(`${L}/loans/${i1.body.id}/renew`).set(lb.h)).status).toBe(409);
    await query("update loans set due_on = current_date - 5 where id=$1", [i1.body.id]);
    expect((await lb.a.post(`${L}/issue`).set(lb.h).send({ accessionNo: acc2, borrowerCode: ids.codeAnya })).status).toBe(409); // has an overdue book
    expect(await sendLibraryReminders()).toBe(1); expect(await sendLibraryReminders()).toBe(0);
    const p = await parent(ids.codeAnya); const v = (await p.a.get(`/api/family/children/${ids.anya}/library`)).body; expect(v.open[0].overdue).toBe(true); expect(v.open[0].fine_so_far).toBe(10);
    const ret = await lb.a.post(`${L}/loans/${i1.body.id}/return`).set(lb.h).send({ condition: 'ok' }); expect(ret.body.fine).toBe(10);
    expect((await lb.a.post(`${L}/issue`).set(lb.h).send({ accessionNo: acc2, borrowerCode: ids.codeAnya })).body.error).toContain('unpaid library fines');
    expect((await lb.a.post(`${L}/loans/${i1.body.id}/fine-paid`).set(lb.h)).status).toBe(200); expect((await lb.a.post(`${L}/loans/${i1.body.id}/fine-paid`).set(lb.h)).status).toBe(404);
    expect((await lb.a.post(`${L}/issue`).set(lb.h).send({ accessionNo: acc2, borrowerCode: ids.codeAnya })).status).toBe(201);
    expect((await p.a.get(`/api/family/children/${ids.bela}/library`)).status).toBe(404);
  });
  it('enforces the book limit, supports staff borrowers, lost copies, and catalogue search', async () => {
    const lb = await login('lib'); const L = `${S}/library`; await query("update site_settings set value='1' where key='library_max_books_staff'");
    const b = (await lb.a.post(`${L}/books`).set(lb.h).send({ title: 'Atlas of India', author: 'Survey', copies: 2 })).body.accessionNumbers;
    expect((await lb.a.post(`${L}/issue`).set(lb.h).send({ accessionNo: b[0], borrowerCode: 'S1' })).status).toBe(201);
    expect((await lb.a.post(`${L}/issue`).set(lb.h).send({ accessionNo: b[1], borrowerCode: 'S1' })).status).toBe(409); // limit of 1
    const loan = (await lb.a.get(`${L}/loans?q=Atlas`)).body[0]; expect(loan.kind).toBe('staff');
    expect((await lb.a.post(`${L}/loans/${loan.id}/return`).set(lb.h).send({ condition: 'lost' })).status).toBe(200);
    expect((await lb.a.post(`${L}/issue`).set(lb.h).send({ accessionNo: b[0], borrowerCode: 'S1' })).status).toBe(409); // lost copies cannot be issued
    expect((await lb.a.get(`${L}/books?q=atlas`)).body.rows[0].available).toBe(1);
    const t = await login('teacher'); expect((await t.a.get(`${L}/books`)).status).toBe(200); expect((await t.a.post(`${L}/issue`).set(t.h).send({ accessionNo: b[1], borrowerCode: 'S1' })).status).toBe(403);
    const bid = (await lb.a.get(`${L}/books?q=jungle`)).body.rows[0].id; expect((await lb.a.delete(`${L}/books/${bid}`).set(lb.h)).status).toBe(409); // has history
  });
});

describe('HR: documents, recruitment and payroll', () => {
  it('keeps staff documents private: HR and the person themself only', async () => {
    const hr = await login('hr'); const t = await login('teacher'); const o = await login('other');
    const up = (u: any, buf: Buffer, name: string) => u.a.post(`${S}/hr/staff/${ids.sTeacher}/documents`).set(u.h).field('kind', 'qualification').field('title', 'B.Ed certificate').field('expiresOn', '2026-12-01').attach('file', buf, name);
    expect((await up(hr, Buffer.from('<script>x</script>'), 'a.pdf')).status).toBe(400); expect((await up(t, PDF, 'b.pdf')).status).toBe(403); ids.doc = (await up(hr, PDF, '../../cert.pdf')).body.id; expect(ids.doc).toBeTruthy();
    expect((await t.a.get(`${S}/hr/staff/${ids.sTeacher}/documents`)).body).toHaveLength(1); expect((await t.a.get(`${S}/hr/staff/${ids.sTeacher}/documents/${ids.doc}/file`)).status).toBe(200);
    expect((await o.a.get(`${S}/hr/staff/${ids.sTeacher}/documents`)).status).toBe(404); expect((await o.a.get(`${S}/hr/staff/${ids.sTeacher}/documents/${ids.doc}/file`)).status).toBe(404);
    const stored = (await query('select stored_name from staff_documents')).rows[0].stored_name; expect((await request(app).get(`/uploads/${stored}`)).status).toBe(404);
    expect((await hr.a.get(`${S}/hr/documents/expiring`)).body).toHaveLength(1);
  });
  it('takes job applications publicly and moves them through HR to a staff record', async () => {
    const op = (await query("insert into job_openings (title, employment_type) values ('Maths Teacher','Full-time') returning id")).rows[0].id;
    const apply = (f: any = {}) => { let r = request(app).post('/api/apply/jobs').field('openingId', String(op)).field('fullName', 'Priya Applicant').field('email', 'priya@example.com').field('phone', '9888800000').field('consent', f.consent ?? 'true'); if (f.website) r = r.field('website', f.website); return r.attach('resume', f.file ?? PDF, 'cv.pdf'); };
    expect((await apply({ consent: 'false' })).status).toBe(400); expect((await apply({ file: Buffer.from('not a pdf at all, sorry') })).status).toBe(400); expect((await apply({ website: 'bot' })).status).toBe(200);
    expect((await apply()).status).toBe(201);
    const hr = await login('hr'); const list = (await hr.a.get(`${S}/hr/applications`)).body; expect(list).toHaveLength(1); const id = list[0].id; expect(list[0].has_resume).toBe(true);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id='hr' and n.title='New job application'")).rowCount).toBe(1);
    expect((await hr.a.get(`${S}/hr/applications/${id}/resume`)).headers['content-type']).toBe('application/pdf'); const t = await login('teacher'); expect((await t.a.get(`${S}/hr/applications`)).status).toBe(403); expect((await request(app).get(`${S}/hr/applications/${id}/resume`)).status).toBe(401);
    expect((await hr.a.post(`${S}/hr/applications/${id}/hire`).set(hr.h).send({ designation: 'TGT', kind: 'teacher' })).status).toBe(409); // not offered yet
    await hr.a.patch(`${S}/hr/applications/${id}`).set(hr.h).send({ status: 'offered', hrNotes: 'Strong demo class' });
    const h = await hr.a.post(`${S}/hr/applications/${id}/hire`).set(hr.h).send({ designation: 'TGT', kind: 'teacher' }); expect(h.status).toBe(201); expect(h.body.staffCode).toBe('S0005');
    expect((await hr.a.post(`${S}/hr/applications/${id}/hire`).set(hr.h).send({ designation: 'TGT', kind: 'teacher' })).status).toBe(409);
  });
  it('prepares payroll with loss of pay, needs a second person to finalise, locks it, and shows each person only their own payslip', async () => {
    const hr = await login('hr'); const pr = await login('principal'); const t = await login('teacher'); const o = await login('other');
    const sal = (id: number, comps: any[]) => hr.a.put(`${S}/hr/staff/${id}/salary`).set(hr.h).send({ components: comps });
    expect((await sal(ids.sTeacher, [{ name: 'Basic', kind: 'earning', amount: 30000 }, { name: 'Allowance', kind: 'earning', amount: 6000 }, { name: 'PF', kind: 'deduction', amount: 1800 }])).status).toBe(200);
    expect((await sal(ids.sOther, [{ name: 'Basic', kind: 'earning', amount: 20000 }])).status).toBe(200); expect((await sal(ids.sOther, [{ name: 'Basic', kind: 'earning', amount: 1 }, { name: 'basic', kind: 'earning', amount: 2 }])).status).toBe(400);
    expect((await t.a.get(`${S}/hr/staff/${ids.sTeacher}/salary`)).status).toBe(403);
    await query("insert into staff_attendance (staff_id, date, status) values ($1,$2,'absent'), ($1,$3,'half_day'), ($4,$2,'on_leave')", [ids.sTeacher, `${MONTH}-02`, `${MONTH}-03`, ids.sOther]);
    expect((await hr.a.post(`${S}/hr/payroll`).set(hr.h).send({ month: '2999-01' })).status).toBe(400);
    const run = await hr.a.post(`${S}/hr/payroll`).set(hr.h).send({ month: MONTH }); expect(run.status).toBe(201); expect(run.body.payslips).toBe(2);
    const d = (await hr.a.get(`${S}/hr/payroll/${run.body.id}`)).body; const mine = d.payslips.find((x: any) => x.staff_code === 'S1'); const days = mine.working_days;
    expect(mine.lop_days).toBe(1.5); expect(mine.gross).toBe(36000); expect(mine.lop_deduction).toBe(Math.round((36000 * 1.5 / days) * 100) / 100); expect(mine.net).toBe(Math.round((36000 - 1800 - mine.lop_deduction) * 100) / 100);
    expect(d.payslips.find((x: any) => x.staff_code === 'S2').lop_days).toBe(0); // approved leave is paid
    expect((await hr.a.post(`${S}/hr/payroll/${run.body.id}/finalise`).set(hr.h).send({})).status).toBe(403); // HR cannot finalise
    await query("insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='hr_staff' and p.code='payroll.approve' on conflict do nothing"); const hr2 = await login('hr');
    expect((await hr2.a.post(`${S}/hr/payroll/${run.body.id}/finalise`).set(hr2.h).send({})).status).toBe(403); // even with the right, not their own run
    await query("delete from role_permissions where role_id=(select id from roles where code='hr_staff') and permission_id=(select id from permissions where code='payroll.approve')");
    expect((await t.a.get(`${S}/hr/me/payslips`)).body).toHaveLength(0); // drafts are not visible to staff
    const fin = await pr.a.post(`${S}/hr/payroll/${run.body.id}/finalise`).set(pr.h).send({}); expect(fin.status).toBe(200); expect(fin.body.total).toBeCloseTo(mine.net + 20000, 2);
    expect((await query("select amount::float a from expenses where category='Salaries'")).rows[0].a).toBeCloseTo(fin.body.total, 2);
    expect((await hr.a.post(`${S}/hr/payroll`).set(hr.h).send({ month: MONTH })).status).toBe(409); expect((await pr.a.post(`${S}/hr/payroll/${run.body.id}/finalise`).set(pr.h).send({})).status).toBe(409);
    const slips = (await t.a.get(`${S}/hr/me/payslips`)).body; expect(slips).toHaveLength(1); expect((await t.a.get(`${S}/hr/payslips/${slips[0].id}`)).status).toBe(200);
    expect((await o.a.get(`${S}/hr/payslips/${slips[0].id}`)).status).toBe(404); expect((await o.a.get(`${S}/hr/payroll`)).status).toBe(403);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id='teacher' and n.title='Payslip available'")).rowCount).toBe(1);
  });
});
