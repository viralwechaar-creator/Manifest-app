-- Phase 4: timetable, attendance, leave, substitutions, exams, marks, homework.

create table periods (
  id serial primary key,
  number integer not null unique check (number > 0),
  name text not null,
  starts_at time not null,
  ends_at time not null,
  is_break boolean not null default false,
  check (ends_at > starts_at)
);

-- day: 1 = Monday ... 7 = Sunday (ISO). A teacher can never be booked twice in the same period.
create table timetable_slots (
  id serial primary key,
  section_id integer not null references sections(id) on delete cascade,
  day smallint not null check (day between 1 and 7),
  period_id integer not null references periods(id) on delete restrict,
  subject_id integer not null references subjects(id) on delete restrict,
  staff_id integer not null references staff(id) on delete restrict,
  unique (section_id, day, period_id),
  unique (staff_id, day, period_id)
);
create index slots_staff_idx on timetable_slots (staff_id, day);

create table student_attendance (
  student_id integer not null references students(id) on delete cascade,
  date date not null,
  section_id integer not null references sections(id) on delete cascade,
  status text not null check (status in ('present','absent','late','excused')),
  marked_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (student_id, date)
);
create index sa_section_date_idx on student_attendance (section_id, date);

create table staff_attendance (
  staff_id integer not null references staff(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present','absent','late','half_day','on_leave')),
  note text,
  marked_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (staff_id, date)
);
create index sta_date_idx on staff_attendance (date, status);

create table leave_requests (
  id serial primary key,
  staff_id integer not null references staff(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index leave_staff_idx on leave_requests (staff_id, status);

-- A vacant period is "a timetable slot whose teacher is absent or on leave that day".
-- A substitution covers one vacant slot on one date. A substitute cannot cover two classes in the same period.
create table substitutions (
  id serial primary key,
  date date not null,
  slot_id integer not null references timetable_slots(id) on delete cascade,
  period_id integer not null references periods(id) on delete restrict,
  substitute_staff_id integer not null references staff(id) on delete restrict,
  reason text,
  assigned_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (date, slot_id),
  unique (date, period_id, substitute_staff_id)
);

create table exams (
  id serial primary key,
  name text not null,
  kind text not null check (kind in ('class_test','unit_test','midterm','final')),
  academic_year_id integer not null references academic_years(id) on delete restrict,
  starts_on date,
  results_published boolean not null default false,
  created_at timestamptz not null default now()
);
create table exam_subjects (
  id serial primary key,
  exam_id integer not null references exams(id) on delete cascade,
  class_id integer not null references classes(id) on delete restrict,
  subject_id integer not null references subjects(id) on delete restrict,
  max_marks numeric(6,2) not null check (max_marks > 0),
  pass_marks numeric(6,2) not null check (pass_marks >= 0),
  exam_date date,
  unique (exam_id, class_id, subject_id),
  check (pass_marks <= max_marks)
);
create table marks (
  exam_subject_id integer not null references exam_subjects(id) on delete cascade,
  student_id integer not null references students(id) on delete cascade,
  marks numeric(6,2) check (marks >= 0),
  absent boolean not null default false,
  entered_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (exam_subject_id, student_id),
  check (not (absent and marks is not null))
);
create table report_remarks (
  exam_id integer not null references exams(id) on delete cascade,
  student_id integer not null references students(id) on delete cascade,
  remark text not null,
  entered_by uuid references users(id) on delete set null,
  primary key (exam_id, student_id)
);

create table assignments (
  id serial primary key,
  section_id integer not null references sections(id) on delete cascade,
  subject_id integer not null references subjects(id) on delete restrict,
  staff_id integer not null references staff(id) on delete restrict,
  kind text not null check (kind in ('homework','assignment')),
  title text not null,
  description text,
  due_on date not null,
  max_marks numeric(6,2),
  created_at timestamptz not null default now()
);
create index assignments_section_idx on assignments (section_id, due_on desc);

insert into permissions (code, description) values
 ('timetable.view','See timetables'),
 ('timetable.manage','Edit the period structure and timetables'),
 ('attendance.students.mark','Mark student attendance (teachers: own class only)'),
 ('attendance.students.view_all','See attendance for every class'),
 ('attendance.staff.manage','Mark staff attendance'),
 ('attendance.staff.view','See staff attendance'),
 ('leave.apply','Apply for leave'),
 ('leave.approve','Approve or reject staff leave'),
 ('substitutions.manage','Assign substitute teachers to vacant periods'),
 ('exams.manage','Create exams and publish results'),
 ('marks.enter','Enter marks (teachers: own classes and subjects only)'),
 ('results.view_all','See results and rankings for every class'),
 ('homework.manage','Set homework and assignments (teachers: own classes only)');

insert into role_permissions select r.id, p.id from roles r, permissions p where r.code in ('super_admin','school_admin') on conflict do nothing;  -- admins hold every permission
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='principal'
  and p.code in ('timetable.view','attendance.students.view_all','attendance.staff.view','leave.apply','leave.approve','substitutions.manage','exams.manage','results.view_all');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code in ('teacher','department_head')
  and p.code in ('timetable.view','attendance.students.mark','leave.apply','marks.enter','homework.manage');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='hr_staff'
  and p.code in ('timetable.view','attendance.staff.manage','attendance.staff.view','leave.apply','leave.approve');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code in ('accounts_staff','admission_staff','transport_staff','librarian')
  and p.code in ('leave.apply');
