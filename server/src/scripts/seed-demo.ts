/**
 * Fills an EMPTY database with clearly fictional demo data so every screen can be explored.
 * Never run this on the real school database. Refuses to run if students already exist.
 *   npm run seed:demo
 */
import { pool, query, tx } from '../db';
import { migrate } from '../migrate';
import { hashPassword } from '../lib/password';
import { registerStudent } from '../modules/school/students';
import { issueParentAccount, issueStudentAccount } from '../modules/school/family';
import fs from 'fs';
import path from 'path';
import { sha256 } from '../lib/crypto';
import { generateCharges, recordPayment } from '../modules/school/fees';
import { PRIVATE_DIR } from '../modules/uploads';

const FIRST_F = ['Aanya', 'Diya', 'Meera', 'Isha', 'Kavya', 'Riya', 'Saanvi', 'Anika', 'Tara', 'Nisha', 'Zoya', 'Pooja'];
const FIRST_M = ['Aarav', 'Vihaan', 'Arjun', 'Kabir', 'Rohan', 'Ishaan', 'Dev', 'Yash', 'Neel', 'Rahul', 'Aditya', 'Samar'];
const LAST = ['Sharma', 'Nair', 'Iyer', 'Khan', 'Patel', 'Menon', 'Das', 'Reddy', 'Singh', 'Joshi', 'Verma', 'Kulkarni', 'Bose', 'Rao'];
let seed = 7;
const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 16) % n; };
const pick = <T,>(a: T[]) => a[rnd(a.length)];

async function main() {
  await migrate();
  if ((await query('select count(*)::int n from students')).rows[0].n > 0) throw new Error('Database already has students. Demo data is only for an empty database.');

  const depts: Record<string, number> = {};
  for (const [i, [n, d]] of ([['Languages', 'English, Hindi and regional languages.'], ['Mathematics', 'Number, logic and problem solving.'], ['Science', 'Physics, chemistry, biology and computing.'], ['Social Studies', 'History, geography and civics.'], ['Arts & Sports', 'Creative arts, music and physical education.']] as const).entries())
    depts[n] = (await query('insert into departments (name, description, sort) values ($1,$2,$3) returning id', [n, d, i])).rows[0].id;

  const year = (await query("insert into academic_years (label, starts_on, ends_on, is_current) values ('2026-27','2026-04-01','2027-03-31',true) returning id")).rows[0].id;
  const classIds: number[] = [];
  for (let l = 1; l <= 8; l++) classIds.push((await query('insert into classes (name, level) values ($1,$2) returning id', [`Class ${l}`, l])).rows[0].id);

  const subjDefs: [string, string, string][] = [['English', 'ENG', 'Languages'], ['Hindi', 'HIN', 'Languages'], ['Mathematics', 'MAT', 'Mathematics'], ['Science', 'SCI', 'Science'], ['Computer Science', 'CSC', 'Science'], ['Social Science', 'SST', 'Social Studies'], ['Art', 'ART', 'Arts & Sports'], ['Physical Education', 'PED', 'Arts & Sports']];
  const subj: Record<string, number> = {};
  for (const [n, c, d] of subjDefs) subj[c] = (await query('insert into subjects (name, code, department_id) values ($1,$2,$3) returning id', [n, c, depts[d]])).rows[0].id;
  for (const cid of classIds) for (const c of Object.keys(subj)) await query('insert into class_subjects values ($1,$2)', [cid, subj[c]]);

  // Staff: teachers per subject, plus non-teaching staff.
  const teachers: { id: number; code: string }[] = [];
  const codes = ['ENG', 'HIN', 'MAT', 'SCI', 'CSC', 'SST', 'ART', 'PED'];
  const tsubs = Array.from({ length: 24 }, (_, i) => codes[i % 8]);                       // three teachers per subject
  const tnames = Array.from({ length: 24 }, (_, i) => `${[...FIRST_F, ...FIRST_M][(i * 5) % 24]} ${LAST[(i * 3) % LAST.length]}`);
  const pw = await hashPassword('Demo-Pass-2026');
  let n = 0;
  for (const [i, name] of tnames.entries()) {
    const code = 'S' + String(++n).padStart(4, '0');
    let uid: string | null = null;
    if (i < 3) { // three demo teacher logins
      uid = (await query("insert into users (login_id, display_name, password_hash) values ($1::citext,$2,$3) returning id", [`teacher${i + 1}`, name, pw])).rows[0].id;
      await query("insert into user_roles select $1, id from roles where code='teacher'", [uid]);
    }
    const dept = subjDefs.find((s) => s[1] === tsubs[i])![2];
    const r = await query("insert into staff (user_id, staff_code, full_name, kind, designation, department_id, joined_on) values ($1,$2,$3,'teacher',$4,$5,$6) returning id", [uid, code, name, i % 4 === 0 ? 'PGT' : 'TGT', depts[dept], `20${10 + (i % 12)}-06-01`]);
    teachers.push({ id: r.rows[0].id, code: tsubs[i] });
  }
  for (const [name, des] of [['Kiran Mehta', 'Office Administrator'], ['Rekha Pillai', 'Librarian'], ['Joseph George', 'Transport In-charge'], ['Sana Qureshi', 'Accounts Officer']]) {
    await query("insert into staff (staff_code, full_name, kind, designation, joined_on) values ($1,$2,'non_teaching',$3,'2019-04-01')", ['S' + String(++n).padStart(4, '0'), name, des]);
  }
  for (const [dn, code] of [['Languages', 'ENG'], ['Mathematics', 'MAT'], ['Science', 'SCI'], ['Social Studies', 'SST'], ['Arts & Sports', 'ART']]) {
    const t = teachers.find((x) => x.code === code)!;
    await query('update departments set head_staff_id=$2 where id=$1', [depts[dn], t.id]);
  }

  // Sections (A and B per class), class teachers, teaching assignments.
  const sections: { id: number; classIdx: number }[] = [];
  for (const [ci, cid] of classIds.entries()) for (const name of ['A', 'B']) {
    const ct = teachers[(ci * 2 + (name === 'B' ? 1 : 0)) % teachers.length];
    const sid = (await query('insert into sections (class_id, academic_year_id, name, capacity, class_teacher_id) values ($1,$2,$3,35,$4) returning id', [cid, year, name, ct.id])).rows[0].id;
    sections.push({ id: sid, classIdx: ci });
    for (const code of Object.keys(subj)) {
      const pool_ = teachers.filter((t) => t.code === code); if (!pool_.length) continue;
      const t = pool_[(ci * 2 + (name === 'B' ? 1 : 0)) % pool_.length];
      await query('insert into teacher_assignments (staff_id, section_id, subject_id) values ($1,$2,$3) on conflict do nothing', [t.id, sid, subj[code]]);
    }
  }

  // ~90 students in classes 1-8, with a few sibling pairs sharing a parent.
  let count = 0; let phone = 9800000000;
  for (const sec of sections) {
    const k = 3 + rnd(4);
    for (let i = 0; i < k; i++) {
      const female = rnd(2) === 0; const last = pick(LAST);
      const parentPhone = String(phone++);
      await tx((c) => registerStudent(c, {
        fullName: `${pick(female ? FIRST_F : FIRST_M)} ${last}`, dateOfBirth: `${2026 - 5 - sec.classIdx - 1}-0${1 + rnd(9)}-1${rnd(9)}`, gender: female ? 'female' : 'male',
        sectionId: sec.id, admissionDate: `${2020 + rnd(6)}-0${4 + rnd(5)}-15`, address: `${10 + rnd(80)} Demo Street, Sample Town`, healthNotes: rnd(8) === 0 ? 'Mild allergy (demo)' : '',
        guardians: [{ fullName: `${pick(FIRST_M)} ${last}`, relation: 'Father', phone: parentPhone, isPrimary: true }, { fullName: `${pick(FIRST_F)} ${last}`, relation: 'Mother', phone: String(phone++) }],
      }));
      count++;
    }
  }
  // ---- Phase 4 demo data: periods, timetables, attendance, exams, leave ----
  const periodDefs: [number, string, string, string, boolean][] = [[1, 'Period 1', '08:30', '09:15', false], [2, 'Period 2', '09:15', '10:00', false], [3, 'Period 3', '10:00', '10:45', false], [4, 'Break', '10:45', '11:05', true], [5, 'Period 4', '11:05', '11:50', false], [6, 'Period 5', '11:50', '12:35', false], [7, 'Period 6', '12:35', '13:20', false]];
  const per: { id: number; brk: boolean }[] = [];
  for (const [n, name, a, b2, brk] of periodDefs) per.push({ id: (await query('insert into periods (number, name, starts_at, ends_at, is_break) values ($1,$2,$3,$4,$5) returning id', [n, name, a, b2, brk])).rows[0].id, brk });
  const assign = (await query('select staff_id, section_id, subject_id from teacher_assignments order by section_id, subject_id')).rows;
  const busy = new Set<string>(); let rot = 0;
  for (const sec of sections) {
    const subs = assign.filter((a) => a.section_id === sec.id);
    for (let day = 1; day <= 6; day++) for (const p of per.filter((x) => !x.brk)) {
      for (let k = 0; k < subs.length; k++) {
        const a = subs[(rot + k) % subs.length];
        if (busy.has(`${a.staff_id}-${day}-${p.id}`)) continue;
        busy.add(`${a.staff_id}-${day}-${p.id}`);
        await query('insert into timetable_slots (section_id, day, period_id, subject_id, staff_id) values ($1,$2,$3,$4,$5) on conflict do nothing', [sec.id, day, p.id, a.subject_id, a.staff_id]);
        rot++; break;
      }
    }
  }
  // Ten school days of attendance, mostly present.
  const stu = (await query("select id, section_id from students where status='active'")).rows;
  const allStaff = (await query("select id from staff")).rows;
  for (let back = 1, done = 0; done < 10; back++) {
    const d = new Date(Date.now() - back * 86400000); if (d.getUTCDay() === 0) continue; done++;
    const ds = d.toISOString().slice(0, 10);
    for (const s of stu) await query('insert into student_attendance (student_id, date, section_id, status) values ($1,$2,$3,$4)', [s.id, ds, s.section_id, ['present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', rnd(2) ? 'absent' : 'late', 'present'][rnd(10)]]);
    for (const t of allStaff) await query('insert into staff_attendance (staff_id, date, status) values ($1,$2,$3)', [t.id, ds, rnd(25) === 0 ? 'absent' : 'present']);
  }
  // A unit test for every class with marks for everybody, and a published one.
  const exam = (await query("insert into exams (name, kind, academic_year_id, starts_on) values ('Unit Test 1','unit_test',$1,current_date - 7) returning id", [year])).rows[0].id;
  const ct = (await query("insert into exams (name, kind, academic_year_id) values ('Class test: Mathematics','class_test',$1) returning id", [year])).rows[0].id;
  for (const cid of classIds) for (const code of ['ENG', 'MAT', 'SCI']) {
    const xs = (await query('insert into exam_subjects (exam_id, class_id, subject_id, max_marks, pass_marks) values ($1,$2,$3,50,18) returning id', [exam, cid, subj[code]])).rows[0].id;
    for (const s of stu.filter((x) => sections.find((q) => q.id === x.section_id && classIds[q.classIdx] === cid))) {
      const absent = rnd(30) === 0;
      await query('insert into marks (exam_subject_id, student_id, marks, absent) values ($1,$2,$3,$4)', [xs, s.id, absent ? null : 14 + rnd(36), absent]);
    }
    if (code === 'MAT') {
      const x2 = (await query('insert into exam_subjects (exam_id, class_id, subject_id, max_marks, pass_marks) values ($1,$2,$3,20,8) returning id', [ct, cid, subj.MAT])).rows[0].id;
      for (const s of stu.filter((x) => sections.find((q) => q.id === x.section_id && classIds[q.classIdx] === cid))) await query('insert into marks (exam_subject_id, student_id, marks) values ($1,$2,$3)', [x2, s.id, 5 + rnd(16)]);
    }
  }
  await query('update exams set results_published=true where id=$1', [exam]);
  // ---- Phase 5 demo data: a parent with two children, notices, remarks, a pending leave request ----
  const demoPw = await hashPassword('Demo-Pass-2026');
  const sec3A = sections[4].id, sec6B = sections[11].id;  // Class 3 A and Class 6 B
  const kidA = await tx((c) => registerStudent(c, { fullName: 'Aarav Menon', dateOfBirth: '2017-05-14', gender: 'male', sectionId: sec3A, admissionDate: '2023-04-10', address: '14 Demo Street (fictional)', healthNotes: '', guardians: [{ fullName: 'Rahul Menon', relation: 'Father', phone: '9811100001', isPrimary: true }] }));
  const kidB = await tx((c) => registerStudent(c, { fullName: 'Diya Menon', dateOfBirth: '2014-02-02', gender: 'female', sectionId: sec6B, admissionDate: '2020-04-10', address: '14 Demo Street (fictional)', healthNotes: '', guardians: [{ fullName: 'Rahul Menon', relation: 'Father', phone: '9811100001', isPrimary: true }] }));
  const pl = await tx((c) => issueParentAccount(c, kidA.id));
  await query('update users set password_hash=$2, must_change_password=false where login_id=$1', [pl.loginId, demoPw]);
  const sl = await tx((c) => issueStudentAccount(c, kidB.id));
  await query('update users set password_hash=$2, must_change_password=false where login_id=$1', [sl.loginId, demoPw]);
  for (const k of [kidA, kidB]) {
    const sec = k === kidA ? sec3A : sec6B;
    for (let back = 1, done = 0; done < 10; back++) { const d = new Date(Date.now() - back * 86400000); if (d.getUTCDay() === 0) continue; done++; await query('insert into student_attendance (student_id, date, section_id, status) values ($1,$2,$3,$4)', [k.id, d.toISOString().slice(0, 10), sec, done === 3 ? 'absent' : done === 6 ? 'late' : 'present']); }
  }
  for (const [k, sec, pct] of [[kidA, sec3A, 0.78], [kidB, sec6B, 0.86]] as const) // marks for the two demo children in every exam of their class
    await query('insert into marks (exam_subject_id, student_id, marks) select x.id, $1, round(x.max_marks * $3::numeric) from exam_subjects x join sections s on s.class_id = x.class_id where s.id = $2', [k.id, sec, pct]);
  await query("insert into notices (title, body, audience) values ('Annual Day rehearsals','Rehearsals for the Annual Day begin next week. Students should carry water bottles.','everyone'), ('Parent-teacher meeting','The parent-teacher meeting is on the first Saturday of next month, 10 am to 1 pm.','parents')");
  await query("insert into student_remarks (student_id, staff_id, kind, text, visible_to_parent) values ($1,$2,'praise','Helped a classmate understand fractions today. Kind and patient.',true), ($1,$2,'concern','Needs to complete homework more regularly.',true), ($1,$2,'note','Internal: discuss seating with the class teacher.',false)", [kidA.id, teachers[0].id]);
  await query("insert into student_leave_requests (student_id, from_date, to_date, reason) values ($1, current_date + 3, current_date + 3, 'Dental appointment')", [kidA.id]);
  console.log(`Parent demo: sign in with ${pl.loginId} or ${kidB.studentCode} (one parent, two children). Student login: ${sl.loginId}. Password for all: Demo-Pass-2026`);
  // Next Monday: one teacher on approved leave, so a vacant period needs a substitute.
  const nm = new Date(); nm.setUTCDate(nm.getUTCDate() + ((8 - nm.getUTCDay()) % 7 || 7)); const mon = nm.toISOString().slice(0, 10);
  const leaveT = teachers[5].id;
  await query("insert into leave_requests (staff_id, from_date, to_date, reason, status, decided_at) values ($1,$2,$2,'Medical appointment','approved', now())", [leaveT, mon]);
  await query("insert into staff_attendance (staff_id, date, status, note) values ($1,$2,'on_leave','Approved leave') on conflict do nothing", [leaveT, mon]);
  await query("insert into leave_requests (staff_id, from_date, to_date, reason) values ($1,$2,$3,'Family function')", [teachers[2].id, mon, mon]);
  // ---- Phase 6 demo data: staff logins, fees, payments, refunds, expenses, applications ----
  for (const [login, name, role] of [['accounts1', 'Sana Qureshi', 'accounts_staff'], ['admissions1', 'Kiran Mehta', 'admission_staff'], ['principal1', 'Dr. Latha Rao', 'principal']]) {
    const u = (await query('insert into users (login_id, display_name, password_hash) values ($1::citext,$2,$3) returning id', [login, name, demoPw])).rows[0].id;
    await query('insert into user_roles select $1, id from roles where code=$2', [u, role]);
  }
  const acct = (await query("select id from users where login_id='accounts1'")).rows[0].id as string;
  const hTuition = (await query("insert into fee_heads (name) values ('Tuition') returning id")).rows[0].id, hAnnual = (await query("insert into fee_heads (name) values ('Annual charges') returning id")).rows[0].id, hExam = (await query("insert into fee_heads (name) values ('Examination') returning id")).rows[0].id;
  await query("insert into fee_heads (name) values ('Transport'), ('Library')");
  for (const [i, cid] of classIds.entries()) {
    await query("insert into fee_structure_items (academic_year_id, class_id, head_id, amount, frequency, first_due_on) values ($1,$2,$3,$4,'monthly','2026-04-01')", [year, cid, hTuition, 1500 + 150 * i]);
    await query("insert into fee_structure_items (academic_year_id, class_id, head_id, amount, frequency, first_due_on) values ($1,$2,$3,$4,'annual','2026-04-10')", [year, cid, hAnnual, 6000 + 500 * i]);
    await query("insert into fee_structure_items (academic_year_id, class_id, head_id, amount, frequency, first_due_on) values ($1,$2,$3,$4,'quarterly','2026-06-01')", [year, cid, hExam, 800]);
  }
  await query("insert into concessions (student_id, head_id, academic_year_id, kind, value, reason) select s.id, $1, $2, 'percent', 25, 'Staff child concession' from students s where s.full_name like 'Aarav Menon'", [hTuition, year]);
  await tx((c) => generateCharges(c, { yearId: year }));
  const modes = ['cash', 'upi', 'cheque', 'bank_transfer', 'card'];
  const payers = (await query("select s.id, s.student_code from students s where s.status='active' order by s.id")).rows;
  for (const [i, st] of payers.entries()) {
    const owed = (await query("select coalesce(sum(round(c.amount*100) + coalesce((select sum(round(a.amount*100)) from fee_adjustments a where a.charge_id=c.id),0)),0)::int t from fee_charges c where c.student_id=$1 and c.due_on <= '2026-09-30'", [st.id])).rows[0].t / 100;
    const share = [1, 1, 0.8, 0.5, 0.3, 0][i % 6]; const amt = Math.floor(owed * share / 100) * 100; if (amt <= 0) continue;
    const mode = modes[i % modes.length];
    await tx((c) => recordPayment(c, { studentId: st.id, amount: amt, mode, reference: mode === 'cash' ? null : `TXN${100000 + i}`, paidOn: `2026-10-${String(1 + (i % 25)).padStart(2, '0')}`, source: 'counter', userId: acct }));
  }
  const firstPay = (await query("select id from payments order by id limit 1")).rows[0];
  await query("insert into refunds (payment_id, amount, reason, requested_by) values ($1, 500, 'Fee paid twice by mistake', $2)", [firstPay.id, acct]);
  for (const [cat, desc, amt] of [['Maintenance', 'Classroom repairs', 18500], ['Utilities', 'Electricity bill', 24300], ['Supplies', 'Stationery and lab consumables', 9200]] as const)
    await query("insert into expenses (category, description, amount, spent_on, mode, recorded_by) values ($1,$2,$3,current_date - 5,'bank_transfer',$4)", [cat, desc, amt, acct]);
  await query("insert into payment_claims (student_id, amount, mode, reference, paid_on, submitted_by) select $1, 1000, 'upi', 'UPI7788123', current_date - 1, u.id from users u where u.login_id=$2", [kidA.id, pl.loginId]);
  // Two applications: one waiting for review, one approved and ready to enrol.
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  fs.mkdirSync(path.join(PRIVATE_DIR, 'applications'), { recursive: true });
  const mkApp = async (ref: string, name: string, status: string, docStatus: string, guardian: string, phone: string) => {
    const a = (await query(`insert into applications (reference, tracking_hash, status, academic_year_id, class_id, student_name, date_of_birth, gender, address, guardian_name, guardian_relation, guardian_phone, guardian_email, consent_purpose, consent_notice_version, decision_note)
      values ($1,$2,$3,$4,$5,$6,'2019-03-09','female','21 Demo Lane (fictional)',$7,'Mother',$8,'demo@example.com','Process the admission application','1',$9) returning id`, [ref, sha256('DEMOA-' + ref.slice(-5)), status, year, classIds[0], name, guardian, phone, status === 'approved' ? 'Your application has been approved.' : null])).rows[0].id;
    for (const kind of ['birth_certificate', 'photo']) { const stored = `demo-${a}-${kind}.png`; fs.writeFileSync(path.join(PRIVATE_DIR, 'applications', stored), png); await query('insert into application_documents (application_id, kind, original_name, stored_name, mime, size_bytes, status) values ($1,$2,$3,$4,$5,$6,$7)', [a, kind, `${kind}.png`, stored, 'image/png', png.length, docStatus]); }
    await query("insert into application_events (application_id, actor, action) values ($1,'applicant','submitted')", [a]); return a;
  };
  await query("insert into application_counters (year, last_number) values (2026, 2) on conflict (year) do update set last_number = 2");
  await mkApp('APP-2026-0001', 'Ira Kapoor', 'submitted', 'pending', 'Neha Kapoor', '9833300001');
  await mkApp('APP-2026-0002', 'Zara Ahmed', 'approved', 'verified', 'Sara Ahmed', '9833300002');
  console.log('Finance demo logins: accounts1 (accounts), admissions1 (admissions), principal1 (principal), password Demo-Pass-2026. Applications: APP-2026-0001 (tracking code DEMOA-00001) and APP-2026-0002 (DEMOA-00002, approved, ready to enrol).');
  console.log(`Demo data ready: 8 classes, ${sections.length} sections, ${teachers.length + 4} staff, ${count} students.`);
  console.log('Demo teacher logins: teacher1, teacher2, teacher3  |  password: Demo-Pass-2026');
  console.log('Unit Test 1 (published) and a class test have marks; next Monday has an open vacant period.');
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
