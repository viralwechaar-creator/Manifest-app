-- Phase 5: parent and student portals.
-- Parents sign in with a child's student ID; one parent account can be reached by every linked child's ID.
alter table students add column user_id uuid unique references users(id) on delete set null;

create table login_aliases (
  login_id citext primary key,
  user_id uuid not null references users(id) on delete cascade
);
create index login_aliases_user_idx on login_aliases (user_id);

create table notices (
  id serial primary key,
  title text not null,
  body text not null,
  audience text not null check (audience in ('everyone','parents','students','staff','section')),
  section_id integer references sections(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  published_at timestamptz not null default now(),
  expires_on date,
  check ((audience = 'section') = (section_id is not null))
);
create index notices_pub_idx on notices (published_at desc);

create table student_remarks (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  staff_id integer not null references staff(id) on delete restrict,
  kind text not null check (kind in ('praise','concern','note')),
  text text not null,
  visible_to_parent boolean not null default true,
  created_at timestamptz not null default now()
);
create index remarks_student_idx on student_remarks (student_id, created_at desc);

create table student_leave_requests (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  applied_by uuid references users(id) on delete set null,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index sleave_student_idx on student_leave_requests (student_id, status);

insert into permissions (code, description) values
 ('notices.manage','Publish notices to parents, students and staff'),
 ('remarks.write','Write remarks about students in your classes'),
 ('student_leave.decide','Approve or reject student leave (teachers: own class only)'),
 ('family_accounts.manage','Create parent and student logins');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code in ('super_admin','school_admin') on conflict do nothing;
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='principal' and p.code in ('notices.manage','remarks.write','student_leave.decide');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code in ('teacher','department_head') and p.code in ('remarks.write','student_leave.decide');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='admission_staff' and p.code in ('family_accounts.manage');
