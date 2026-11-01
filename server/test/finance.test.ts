import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool, query } from '../src/db';
import { hashPassword } from '../src/lib/password';
import { migrate } from '../src/migrate';

const app = createApp();
const PW = 'Correct-horse-42'; const NEW = 'Fresh-Parent-2026';
const TODAY = new Date().toISOString().slice(0, 10);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const ids: Record<string, any> = {};

async function mkUser(loginId: string, role: string) {
  const u = await query('insert into users (login_id, display_name, password_hash) values ($1::citext,$1,$2) returning id', [loginId, await hashPassword(PW)]);
  await query('insert into user_roles select $1, id from roles where code=$2', [u.rows[0].id, role]); return u.rows[0].id as string;
}
async function login(loginId: string, pw = PW) {
  const a = request.agent(app); const r = await a.post('/api/auth/login').send({ loginId, password: pw });
  const me = r.status === 200 ? await a.get('/api/auth/me') : null;
  return { a, status: r.status, h: { 'x-csrf-token': (me?.body.csrfToken ?? '') as string } };
}
const F = '/api/admin/school/fees', AD = '/api/admin/school/admissions';
const apply = (over: any = {}) => request(app).post('/api/apply/submit').send({ academicYearId: ids.y, classId: ids.c, studentName: 'Meera Pillai', dateOfBirth: '2018-06-01', gender: 'female', address: '5 Lake Road', guardianName: 'Anil Pillai', guardianRelation: 'Father', guardianPhone: '9876500123', guardianEmail: 'a@example.com', consent: true, ...over });

beforeAll(async () => {
  await query('drop schema public cascade; create schema public;'); await migrate();
  await mkUser('adm', 'admission_staff'); await mkUser('acc', 'accounts_staff'); await mkUser('principal', 'principal'); await mkUser('admin', 'school_admin'); await mkUser('teacher', 'teacher');
  ids.y = (await query("insert into academic_years (label, starts_on, ends_on, is_current) values ('Y','2020-01-01','2099-12-31',true) returning id")).rows[0].id;
  ids.c = (await query("insert into classes (name, level) values ('Class 1',1) returning id")).rows[0].id;
  ids.c2 = (await query("insert into classes (name, level) values ('Class 2',2) returning id")).rows[0].id;
  ids.secA = (await query("insert into sections (class_id, academic_year_id, name, capacity) values ($1,$2,'A',3) returning id", [ids.c, ids.y])).rows[0].id;
  ids.secOther = (await query("insert into sections (class_id, academic_year_id, name) values ($1,$2,'A') returning id", [ids.c2, ids.y])).rows[0].id;
});
afterAll(async () => { await pool.end(); });

describe('online admission: public side', () => {
  it('validates the form, records consent and hands back a reference and a secret tracking code', async () => {
    expect((await apply({ consent: false })).status).toBe(400);
    expect((await apply({ dateOfBirth: '2999-01-01' })).status).toBe(400);
    expect((await apply({ guardianPhone: 'abc' })).status).toBe(400);
    const r = await apply(); expect(r.status).toBe(201);
    expect(r.body.reference).toMatch(/^APP-\d{4}-0001$/); expect(r.body.trackingCode).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    ids.ref = r.body.reference; ids.code = r.body.trackingCode;
    expect((await apply({ studentName: 'Second Child' })).body.reference).toMatch(/0002$/);
    expect((await query('select consent_notice_version from applications limit 1')).rows[0].consent_notice_version).toBe('1');
    expect((await apply({ website: 'spam' })).status).toBe(200); // the hidden spam-trap field: pretend success, store nothing
    expect((await query('select count(*)::int n from applications')).rows[0].n).toBe(2);
  });
  it('shows status only with the right reference and code', async () => {
    const st = (ref: string, code: string) => request(app).post('/api/apply/status').send({ reference: ref, code });
    expect((await st(ids.ref, 'WRONG-CODE0')).status).toBe(404); expect((await st('APP-2099-9999', ids.code)).status).toBe(404);
    const ok = await st(ids.ref.toLowerCase(), ids.code.replace('-', '').toLowerCase());
    expect(ok.status).toBe(200); expect(ok.body.status).toBe('submitted'); expect(ok.body.missingDocuments).toEqual(['birth_certificate', 'photo']);
    expect(JSON.stringify(ok.body)).not.toContain('tracking_hash');
  });
  it('accepts real documents into private storage only, and rejects disguised files', async () => {
    const up = (kind: string, buf: Buffer, name = 'x.png', code = ids.code) => request(app).post('/api/apply/documents').field('reference', ids.ref).field('code', code).field('kind', kind).attach('file', buf, name);
    expect((await up('photo', Buffer.from('<script>alert(1)</script>'), 'pic.png')).status).toBe(400);
    expect((await up('photo', PNG, 'p.png', 'AAAAA-AAAAA')).status).toBe(404);
    expect((await up('photo', PNG, '../../evil name.png')).status).toBe(201);
    expect((await up('birth_certificate', PNG, 'bc.png')).status).toBe(201);
    const stored = (await query('select stored_name, original_name from application_documents order by id')).rows;
    expect(stored[0].original_name).not.toContain('/'); expect(stored[0].stored_name).toMatch(/^[0-9a-f]{36}\.png$/);
    expect((await request(app).get(`/uploads/${stored[0].stored_name}`)).status).toBe(404); // not reachable as a public file
    expect((await request(app).get('/api/admin/school/admissions/1/documents/1/file')).status).toBe(401);
  });
});

describe('online admission: staff workflow and enrolment', () => {
  it('only admission staff review; documents open for them only; approval needs verified documents', async () => {
    const t = await login('teacher'); expect((await t.a.get(AD)).status).toBe(403);
    const pr = await login('principal'); expect((await pr.a.get(AD)).status).toBe(200); expect((await pr.a.get(`${AD}/1/documents/1/file`)).status).toBe(403); // principal views, cannot open documents
    const adm = await login('adm'); const list = await adm.a.get(AD); expect(list.body.total).toBe(2);
    const id = list.body.rows.find((r: any) => r.reference === ids.ref).id; ids.app = id;
    expect((await adm.a.get(`${AD}/${id}`)).body.documents).toHaveLength(2);
    const d = (await adm.a.get(`${AD}/${id}`)).body.documents[0];
    const f = await adm.a.get(`${AD}/${id}/documents/${d.id}/file`); expect(f.status).toBe(200); expect(f.headers['content-type']).toBe('image/png'); expect(f.headers['cache-control']).toContain('no-store');
    expect((await query("select 1 from audit_logs where action='application.document_opened'")).rowCount).toBe(1);
    expect((await adm.a.post(`${AD}/${id}/approve`).set(adm.h).send({})).status).toBe(409);
    expect((await adm.a.post(`${AD}/${id}/action`).set(adm.h).send({ action: 'request_documents' })).status).toBe(400); // note needed
  });
  it('verifies documents, auto-advances to verified, then approves', async () => {
    const adm = await login('adm'); const docs = (await adm.a.get(`${AD}/${ids.app}`)).body.documents;
    expect((await adm.a.post(`${AD}/${ids.app}/documents/${docs[0].id}/verify`).set(adm.h).send({ status: 'rejected' })).status).toBe(400);
    for (const d of docs) expect((await adm.a.post(`${AD}/${ids.app}/documents/${d.id}/verify`).set(adm.h).send({ status: 'verified' })).status).toBe(200);
    expect((await adm.a.get(`${AD}/${ids.app}`)).body.status).toBe('verified');
    expect((await adm.a.post(`${AD}/${ids.app}/approve`).set(adm.h).send({ note: 'Welcome to the school.' })).status).toBe(200);
    const pub = await request(app).post('/api/apply/status').send({ reference: ids.ref, code: ids.code });
    expect(pub.body.status).toBe('approved'); expect(pub.body.decisionNote).toBe('Welcome to the school.'); expect(JSON.stringify(pub.body.events)).not.toContain('Student ID');
  });
  it('set up fees so that enrolment raises them, then enrol: student ID, parent login and first fees', async () => {
    const acc = await login('acc');
    ids.head1 = (await acc.a.post(`${F}/heads`).set(acc.h).send({ name: 'Admission' })).body.id; ids.head2 = (await acc.a.post(`${F}/heads`).set(acc.h).send({ name: 'Tuition' })).body.id;
    const put = (b: any) => acc.a.put(`${F}/structure`).set(acc.h).send({ yearId: ids.y, classId: ids.c, ...b });

    expect((await put({ headId: ids.head1, amount: 5000, frequency: 'one_time', firstDueOn: '2020-04-01' })).status).toBe(200);
    expect((await put({ headId: ids.head2, amount: 1000, frequency: 'monthly', firstDueOn: '2020-04-01' })).status).toBe(200);
    expect((await put({ headId: ids.head2, amount: -5, frequency: 'monthly', firstDueOn: '2020-04-01' })).status).toBe(400);
    const adm = await login('adm');
    expect((await adm.a.post(`${AD}/${ids.app}/enrol`).set(adm.h).send({ sectionId: ids.secOther })).status).toBe(400); // wrong class
    const r = await adm.a.post(`${AD}/${ids.app}/enrol`).set(adm.h).send({ sectionId: ids.secA });
    expect(r.status).toBe(200); expect(r.body.studentCode).toMatch(/^\d{4}-0001$/); expect(r.body.parentLogin.temporaryPassword).toBeTruthy(); expect(r.body.feesRaised).toBe(1); // admission fee only: past monthly periods are not back-dated
    ids.s1 = r.body.studentId; ids.code1 = r.body.studentCode; ids.temp1 = r.body.parentLogin.temporaryPassword;
    expect((await adm.a.post(`${AD}/${ids.app}/enrol`).set(adm.h).send({ sectionId: ids.secA })).status).toBe(409);
    expect((await query('select status, student_id from applications where id=$1', [ids.app])).rows[0]).toEqual({ status: 'enrolled', student_id: ids.s1 });
    expect((await request(app).post('/api/apply/status').send({ reference: ids.ref, code: ids.code })).body.canUpload).toBe(false);
  });
  it('rejects with a reason and refuses to enrol anything that is not approved', async () => {
    const adm = await login('adm'); const id = (await adm.a.get(AD)).body.rows.find((r: any) => r.student_name === 'Second Child').id;
    expect((await adm.a.post(`${AD}/${id}/enrol`).set(adm.h).send({ sectionId: ids.secA })).status).toBe(409);
    expect((await adm.a.post(`${AD}/${id}/action`).set(adm.h).send({ action: 'reject', note: 'No seat available this year.' })).status).toBe(200);
    expect((await adm.a.post(`${AD}/${id}/approve`).set(adm.h).send({})).status).toBe(409);
  });
});

describe('fees: charges, concessions and payments', () => {
  it('generates charges once, applies standing concessions, and shows dues', async () => {
    const acc = await login('acc'); const pr = await login('principal');
    expect((await acc.a.post(`${F}/students/${ids.s1}/concessions`).set(acc.h).send({ headId: ids.head2, yearId: ids.y, kind: 'percent', value: 10, reason: 'Sibling discount' })).status).toBe(201);
    expect((await acc.a.post(`${F}/generate`).set(acc.h).send({ yearId: ids.y })).body.charges).toBe(12);
    expect((await acc.a.post(`${F}/generate`).set(acc.h).send({ yearId: ids.y })).body.charges).toBe(0); // repeat is safe
    const d = (await acc.a.get(`${F}/students/${ids.s1}/dues`)).body;
    expect(d.dues).toHaveLength(13); const tu = d.dues.find((x: any) => x.description.startsWith('Tuition')); expect(tu.net).toBe(900); expect(d.totals.balance).toBe(5000 + 12 * 900);
    expect((await acc.a.put(`${F}/structure`).set(acc.h).send({ yearId: ids.y, classId: ids.c, headId: ids.head2, amount: 1200, frequency: 'monthly', firstDueOn: '2020-04-01' })).status).toBe(409); // already used
    expect((await pr.a.put(`${F}/structure`).set(pr.h).send({})).status).toBe(403);
  });
  it('allocates oldest first, refuses over-payment, needs references, and numbers receipts uniquely', async () => {
    const acc = await login('acc'); const pay = (b: any) => acc.a.post(`${F}/payments`).set(acc.h).send({ studentId: ids.s1, mode: 'cash', paidOn: TODAY, ...b });
    expect((await pay({ amount: 100000 })).status).toBe(400); expect((await pay({ amount: 10.123 })).status).toBe(400); expect((await pay({ amount: 500, paidOn: '2999-01-01' })).status).toBe(400);
    expect((await pay({ amount: 500, mode: 'upi' })).status).toBe(400);
    const p1 = await pay({ amount: 5500 }); expect(p1.status).toBe(201); expect(p1.body.receiptNo).toMatch(/^REC-\d{4}-000001$/);
    const d = (await acc.a.get(`${F}/students/${ids.s1}/dues`)).body.dues; expect(d.find((x: any) => x.description === 'Admission').balance).toBe(0); expect(d.filter((x: any) => x.paid > 0)).toHaveLength(2); // admission + first tuition (500 of 900)
    const bad = await pay({ amount: 300, allocations: [{ chargeId: d[1].id, amount: 100 }] }); expect(bad.status).toBe(400);
    const lot = await Promise.all([1, 2, 3, 4, 5].map((i) => pay({ amount: 10 + i, mode: 'upi', reference: `TXN${i}` }))); expect(lot.every((r) => r.status === 201)).toBe(true);
    expect(new Set(lot.map((r) => r.body.receiptNo)).size).toBe(5);
    ids.pay1 = p1.body.id;
    const t = await login('teacher'); expect((await t.a.post(`${F}/payments`).set(t.h).send({ studentId: ids.s1, amount: 10, mode: 'cash', paidOn: TODAY })).status).toBe(403);
  });
  it('adjustments cannot push a fee below what was paid', async () => {
    const acc = await login('acc'); const d = (await acc.a.get(`${F}/students/${ids.s1}/dues`)).body.dues; const paidOne = d.find((x: any) => x.paid > 0 && x.description !== 'Admission');
    expect((await acc.a.post(`${F}/charges/${paidOne.id}/adjust`).set(acc.h).send({ amount: -paidOne.net, kind: 'waiver', reason: 'Too much' })).status).toBe(400);
    const open = d.find((x: any) => x.paid === 0);
    expect((await acc.a.post(`${F}/charges/${open.id}/adjust`).set(acc.h).send({ amount: -100, kind: 'waiver', reason: 'Hardship' })).status).toBe(201);
    expect((await acc.a.post(`${F}/charges/${open.id}/adjust`).set(acc.h).send({ amount: 50, kind: 'late_fee', reason: 'Late payment' })).status).toBe(201);
  });
});

describe('fees: refunds, cancellations, reports', () => {
  it('refunds need a second person, restore the dues, and cannot exceed the payment', async () => {
    const acc = await login('acc'); const pr = await login('principal'); const before = (await acc.a.get(`${F}/students/${ids.s1}/dues`)).body.totals.balance;
    expect((await acc.a.post(`${F}/refunds`).set(acc.h).send({ paymentId: ids.pay1, amount: 9999, reason: 'Too much to refund' })).status).toBe(400);
    const r = await acc.a.post(`${F}/refunds`).set(acc.h).send({ paymentId: ids.pay1, amount: 500, reason: 'Fee paid twice by mistake' }); expect(r.status).toBe(201);
    expect((await acc.a.post(`${F}/refunds/${r.body.id}/decision`).set(acc.h).send({ decision: 'approved', payoutMode: 'cash' })).status).toBe(403);
    expect((await pr.a.post(`${F}/refunds/${r.body.id}/decision`).set(pr.h).send({ decision: 'approved' })).status).toBe(400); // payout mode needed
    expect((await pr.a.post(`${F}/refunds/${r.body.id}/decision`).set(pr.h).send({ decision: 'approved', payoutMode: 'bank_transfer', payoutReference: 'NEFT123' })).status).toBe(200);
    expect((await acc.a.get(`${F}/students/${ids.s1}/dues`)).body.totals.balance).toBe(before + 500);
    expect((await pr.a.post(`${F}/refunds/${r.body.id}/decision`).set(pr.h).send({ decision: 'rejected' })).status).toBe(409);
    expect((await acc.a.post(`${F}/refunds`).set(acc.h).send({ paymentId: ids.pay1, amount: 5100, reason: 'More than is left' })).status).toBe(400); // 5500 paid, 500 already refunded
  });
  it('principal can cancel a wrong payment; accounts cannot', async () => {
    const acc = await login('acc'); const pr = await login('principal'); const p = (await acc.a.post(`${F}/payments`).set(acc.h).send({ studentId: ids.s1, amount: 40, mode: 'cash', paidOn: TODAY })).body.id;
    const before = (await acc.a.get(`${F}/students/${ids.s1}/dues`)).body.totals.balance;
    expect((await acc.a.post(`${F}/payments/${p}/cancel`).set(acc.h).send({ reason: 'Entered by mistake' })).status).toBe(403);
    expect((await pr.a.post(`${F}/payments/${p}/cancel`).set(pr.h).send({ reason: 'Entered by mistake' })).status).toBe(200);
    expect((await acc.a.get(`${F}/students/${ids.s1}/dues`)).body.totals.balance).toBe(before + 40);
  });
  it('reports add up, expenses count against net, and CSV exports are safe', async () => {
    const acc = await login('acc'); const pr = await login('principal');
    expect((await acc.a.post(`${F}/expenses`).set(acc.h).send({ category: 'Maintenance', description: 'Repairs', amount: 300, spentOn: TODAY, mode: 'cash' })).status).toBe(201);
    const r = (await pr.a.get(`${F}/reports/collection?from=${TODAY}&to=${TODAY}`)).body;
    expect(r.totalReceived.t).toBe(5500 + 11 + 12 + 13 + 14 + 15); expect(r.refunded).toBe(500); expect(r.expenses).toBe(300); expect(r.net).toBe(5565 - 500 - 300);
    expect(r.byMode.find((m: any) => m.mode === 'cash').total).toBe(5500); expect(r.byHead.map((h: any) => h.head).sort()).toEqual(['Admission', 'Tuition']);
    await query("update students set full_name='=HYPERLINK(\"http://evil\")' where id=$1", [ids.s1]);
    const csv = await pr.a.get(`${F}/reports/outstanding.csv`); expect(csv.status).toBe(200); expect(csv.text).toContain("'=HYPERLINK"); expect(csv.text).not.toMatch(/(^|,)=HYPERLINK/m);
    const out = (await pr.a.get(`${F}/reports/outstanding`)).body; expect(out.byClass[0].students).toBe(1); expect(out.students[0].overdue).toBeGreaterThan(0);
    const t = await login('teacher'); expect((await t.a.get(`${F}/reports/collection`)).status).toBe(403);
    expect((await query("select 1 from audit_logs where action='report.outstanding_exported'")).rowCount).toBe(1);
  });
});

describe('fees in the parent portal', () => {
  async function parent() {
    const f = await login(ids.code1, ids.temp1); if (f.status === 200) { await f.a.post('/api/auth/change-password').set(f.h).send({ currentPassword: ids.temp1, newPassword: NEW }); }
    return login(ids.code1, NEW);
  }
  it('a parent sees only their own child’s dues and receipts', async () => {
    const reg = await login('adm');
    const other = await reg.a.post('/api/admin/school/students').set(reg.h).send({ fullName: 'Other Child', dateOfBirth: '2018-01-01', gender: 'male', sectionId: ids.secA, guardians: [{ fullName: 'Other Parent', relation: 'Mother', phone: '9000099999' }] }); ids.s2 = other.body.id;
    const acc = await login('acc'); await acc.a.post(`${F}/generate`).set(acc.h).send({ yearId: ids.y });
    const op = (await acc.a.post(`${F}/payments`).set(acc.h).send({ studentId: ids.s2, amount: 100, mode: 'cash', paidOn: TODAY })).body.id; ids.otherPay = op;
    const p = await parent(); const kids = await p.a.get('/api/family/children'); expect(kids.body.children).toHaveLength(1);
    const fees = await p.a.get(`/api/family/children/${ids.s1}/fees`); expect(fees.status).toBe(200); expect(fees.body.totals.balance).toBeGreaterThan(0); expect(fees.body.instructions).toContain('accounts office'); expect(fees.body.payments.length).toBeGreaterThan(0);
    expect(fees.body.dues.every((d: any) => /^\d{4}-\d{2}-\d{2}$/.test(d.dueOn))).toBe(true); expect(fees.body.dues.some((d: any) => d.overdue)).toBe(true); expect(fees.body.totals.nextDue).toBe('2020-04-01');
    expect((await p.a.get(`/api/family/children/${ids.s2}/fees`)).status).toBe(404);
    expect((await p.a.get(`/api/family/children/${ids.s1}/receipts/${fees.body.payments[0].id}`)).body.receiptNo).toMatch(/^REC-/);
    expect((await p.a.get(`/api/family/children/${ids.s1}/receipts/${ids.otherPay}`)).status).toBe(404); // someone else's receipt
    for (const path of ['/api/admin/school/fees/payments', '/api/admin/school/fees/reports/collection', '/api/admin/school/admissions']) expect((await p.a.get(path)).status).toBe(403);
  });
  it('a parent can tell the school about a payment (online or offline); accounts confirms it into a receipt', async () => {
    const p = await parent(); const acc = await login('acc'); const before = (await p.a.get(`/api/family/children/${ids.s1}/fees`)).body.totals.balance;
    const claim = (b: any) => p.a.post(`/api/family/children/${ids.s1}/claims`).set(p.h).send({ amount: 450, mode: 'upi', reference: 'UPI998877', paidOn: TODAY, ...b });
    expect((await claim({ reference: undefined })).status).toBe(400); expect((await claim({ paidOn: '2999-01-01' })).status).toBe(400);
    const c = await claim({}); expect(c.status).toBe(201);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id='acc' and n.title='Payment to confirm'")).rowCount).toBe(1);
    const pending = (await acc.a.get(`${F}/claims`)).body; expect(pending).toHaveLength(1);
    expect((await acc.a.post(`${F}/claims/${pending[0].id}/decision`).set(acc.h).send({ decision: 'rejected' })).status).toBe(400);
    const ok = await acc.a.post(`${F}/claims/${pending[0].id}/decision`).set(acc.h).send({ decision: 'accepted' }); expect(ok.status).toBe(200); expect(ok.body.receiptNo).toMatch(/^REC-/);
    expect((await p.a.get(`/api/family/children/${ids.s1}/fees`)).body.totals.balance).toBe(before - 450);
    expect((await acc.a.post(`${F}/claims/${pending[0].id}/decision`).set(acc.h).send({ decision: 'accepted' })).status).toBe(409);
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id=$1 and n.title='Payment confirmed'", [ids.code1])).rowCount).toBe(1);
  });
  it('sends each reminder once', async () => {
    const acc = await login('acc'); const a = (await acc.a.post(`${F}/reminders/run`).set(acc.h)).body; expect(a.overdue).toBeGreaterThan(0);
    const b = (await acc.a.post(`${F}/reminders/run`).set(acc.h)).body; expect(b).toEqual({ dueSoon: 0, overdue: 0 });
    expect((await query("select 1 from notifications n join users u on u.id=n.user_id where u.login_id=$1 and n.title='Fee overdue'", [ids.code1])).rowCount).toBeGreaterThan(0);
  });
});
