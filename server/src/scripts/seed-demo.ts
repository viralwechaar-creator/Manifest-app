/**
 * Fills an EMPTY database with clearly fictional demo data so every screen can be explored.
 * Never run this on the real school database. Refuses to run if students already exist.
 *   npm run seed:demo
 */
import { pool, query, tx } from '../db';
import { migrate } from '../migrate';
import { hashPassword } from '../lib/password';
import { registerStudent } from '../modules/school/students';

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
  const tnames = ['Meera Nair', 'Arun Iyer', 'Farah Khan', 'Suresh Patel', 'Lakshmi Menon', 'Rohit Das', 'Anita Reddy', 'Vikram Singh', 'Neha Joshi', 'Prakash Verma', 'Sunita Kulkarni', 'Amit Bose'];
  const tsubs = ['ENG', 'ENG', 'HIN', 'MAT', 'MAT', 'SCI', 'SCI', 'CSC', 'SST', 'SST', 'ART', 'PED'];
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
      const t = pool_[(ci + (name === 'B' ? 1 : 0)) % pool_.length];
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
  console.log(`Demo data ready: 8 classes, ${sections.length} sections, ${teachers.length + 4} staff, ${count} students.`);
  console.log('Demo teacher logins: teacher1, teacher2, teacher3  |  password: Demo-Pass-2026');
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
