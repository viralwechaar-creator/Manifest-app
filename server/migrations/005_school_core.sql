-- Phase 3: classes, sections, subjects, staff, students, guardians, enrolments.

create table classes (
  id serial primary key,
  name text not null unique,        -- e.g. "Class 5"
  level integer not null unique,    -- ordering and "next class" for promotion
  created_at timestamptz not null default now()
);

create table subjects (
  id serial primary key,
  name text not null unique,
  code text not null unique,
  department_id integer references departments(id) on delete set null,
  created_at timestamptz not null default now()
);

create table class_subjects (
  class_id integer not null references classes(id) on delete cascade,
  subject_id integer not null references subjects(id) on delete cascade,
  primary key (class_id, subject_id)
);

create table staff (
  id serial primary key,
  user_id uuid unique references users(id) on delete set null,
  staff_code text not null unique,
  full_name text not null,
  kind text not null check (kind in ('teacher','non_teaching')),
  designation text not null,
  department_id integer references departments(id) on delete set null,
  email citext,
  phone text,                       -- personal data: shown only with staff.manage
  joined_on date,
  status text not null default 'active' check (status in ('active','on_leave','left')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_dept_idx on staff (department_id);
create index staff_kind_idx on staff (kind, status);
create trigger trg_staff_updated before update on staff for each row execute function set_updated_at();

alter table departments add column head_staff_id integer references staff(id) on delete set null;

create table sections (
  id serial primary key,
  class_id integer not null references classes(id) on delete restrict,
  academic_year_id integer not null references academic_years(id) on delete restrict,
  name text not null,                -- "A", "B"
  class_teacher_id integer references staff(id) on delete set null,
  capacity integer not null default 40 check (capacity > 0),
  unique (class_id, academic_year_id, name)
);
create index sections_class_idx on sections (class_id, academic_year_id);

create table teacher_assignments (
  id serial primary key,
  staff_id integer not null references staff(id) on delete cascade,
  section_id integer not null references sections(id) on delete cascade,
  subject_id integer not null references subjects(id) on delete cascade,
  unique (staff_id, section_id, subject_id)
);
create index ta_section_idx on teacher_assignments (section_id);

create table students (
  id serial primary key,
  student_code text not null unique,   -- the school-issued student ID (also the parent login ID)
  full_name text not null,
  date_of_birth date not null,
  gender text not null check (gender in ('female','male','other')),
  section_id integer references sections(id) on delete set null,
  admission_date date not null default current_date,
  status text not null default 'active' check (status in ('active','transferred','withdrawn','alumni','suspended')),
  address text,                        -- sensitive
  health_notes text,                   -- sensitive
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_section_idx on students (section_id);
create index students_status_idx on students (status);
create index students_name_idx on students (lower(full_name));
create trigger trg_students_updated before update on students for each row execute function set_updated_at();

create table guardians (
  id serial primary key,
  user_id uuid unique references users(id) on delete set null,
  full_name text not null,
  phone text not null,
  email citext,
  created_at timestamptz not null default now()
);
create table student_guardians (
  student_id integer not null references students(id) on delete cascade,
  guardian_id integer not null references guardians(id) on delete cascade,
  relation text not null,
  is_primary boolean not null default false,
  primary key (student_id, guardian_id)
);
create index sg_guardian_idx on student_guardians (guardian_id);

-- Academic history: one row per student per academic year.
create table enrolments (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  section_id integer not null references sections(id) on delete restrict,
  academic_year_id integer not null references academic_years(id) on delete restrict,
  started_on date not null default current_date,
  ended_on date,
  outcome text check (outcome in ('promoted','repeated','transferred','withdrawn','completed')),
  unique (student_id, academic_year_id)
);
create index enrol_student_idx on enrolments (student_id);

create table student_status_log (
  id bigserial primary key,
  student_id integer not null references students(id) on delete cascade,
  old_status text,
  new_status text not null,
  reason text,
  changed_by uuid references users(id) on delete set null,
  changed_at timestamptz not null default now()
);

-- Student ID counters, one per year, incremented inside a transaction.
create table student_id_counters (
  year integer primary key,
  last_number integer not null default 0
);

insert into permissions (code, description) values
 ('academics.manage','Manage academic years, classes, sections and subjects'),
 ('staff.view','See the staff directory'),
 ('staff.manage','Create and edit staff records and teaching assignments'),
 ('students.view','See students (teachers see only their own classes)'),
 ('students.view_all','See students in every class'),
 ('students.sensitive','See students'' addresses, health notes and guardian contact details'),
 ('students.manage','Register, edit, promote and change status of students');

insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code in ('super_admin','school_admin') and p.code in ('academics.manage','staff.view','staff.manage','students.view','students.view_all','students.sensitive','students.manage');
insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code='principal' and p.code in ('staff.view','students.view','students.view_all','students.sensitive');
insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code='admission_staff' and p.code in ('students.view','students.view_all','students.sensitive','students.manage');
insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code='accounts_staff' and p.code in ('students.view','students.view_all');
insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code='hr_staff' and p.code in ('staff.view','staff.manage');
insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code in ('teacher','department_head') and p.code in ('staff.view','students.view');

insert into site_settings (key, value) values ('student_id_format', '{YYYY}-{NNNN}');
