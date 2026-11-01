-- Phase 7: communication, transport, library, HR and payroll.

-- ===== Parent-teacher messaging =====
create table threads (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  parent_user_id uuid not null references users(id) on delete cascade,
  staff_user_id uuid not null references users(id) on delete cascade,
  subject text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  parent_read_at timestamptz,
  staff_read_at timestamptz
);
create index threads_parent_idx on threads (parent_user_id, last_message_at desc);
create index threads_staff_idx on threads (staff_user_id, last_message_at desc);
create table messages (
  id bigserial primary key,
  thread_id integer not null references threads(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index messages_thread_idx on messages (thread_id, created_at);

-- ===== Complaints =====
create table complaints (
  id serial primary key,
  ref text not null unique,
  submitted_by uuid not null references users(id) on delete restrict,
  student_id integer references students(id) on delete set null,
  category text not null check (category in ('academic','transport','fees','safety','facilities','staff_conduct','student_conduct','other')),
  subject text not null,
  body text not null,
  confidential boolean not null default false,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  assigned_to uuid references users(id) on delete set null,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index complaints_status_idx on complaints (status, created_at desc);
create index complaints_user_idx on complaints (submitted_by);
create trigger trg_complaints_updated before update on complaints for each row execute function set_updated_at();
create table complaint_updates (
  id serial primary key,
  complaint_id integer not null references complaints(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  note text not null,
  internal boolean not null default false,       -- internal notes are never shown to the person who complained
  created_at timestamptz not null default now()
);
create table complaint_counters (year integer primary key, last_number integer not null default 0);

-- ===== Transport =====
create table vehicles (
  id serial primary key,
  reg_no text not null unique,
  kind text not null default 'Bus',
  capacity integer not null check (capacity > 0),
  status text not null default 'active' check (status in ('active','maintenance','retired')),
  insurance_expiry date,
  fitness_expiry date
);
create table drivers (
  id serial primary key,
  full_name text not null,
  phone text not null,
  license_no text not null unique,
  license_expiry date,
  status text not null default 'active' check (status in ('active','inactive'))
);
create table transport_routes (
  id serial primary key,
  name text not null unique,
  vehicle_id integer references vehicles(id) on delete set null,
  driver_id integer references drivers(id) on delete set null,
  attendant text,
  monthly_fee numeric(10,2) not null default 0 check (monthly_fee >= 0),
  active boolean not null default true
);
create table transport_stops (
  id serial primary key,
  route_id integer not null references transport_routes(id) on delete cascade,
  name text not null,
  sequence integer not null,
  pickup_time time,
  drop_time time,
  unique (route_id, sequence)
);
create table student_transport (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  route_id integer not null references transport_routes(id) on delete restrict,
  stop_id integer not null references transport_stops(id) on delete restrict,
  direction text not null default 'both' check (direction in ('both','pickup','drop')),
  started_on date not null default current_date,
  ended_on date
);
create unique index one_active_transport on student_transport (student_id) where ended_on is null;
create index st_route_idx on student_transport (route_id) where ended_on is null;

-- ===== Library =====
create table books (
  id serial primary key,
  title text not null,
  author text not null,
  isbn text,
  category text,
  publisher text,
  published_year smallint,
  created_at timestamptz not null default now()
);
create index books_title_idx on books (lower(title));
create table book_copies (
  id serial primary key,
  book_id integer not null references books(id) on delete cascade,
  accession_no text not null unique,
  shelf text,
  status text not null default 'available' check (status in ('available','issued','lost','damaged'))
);
create index copies_book_idx on book_copies (book_id);
create table loans (
  id serial primary key,
  copy_id integer not null references book_copies(id) on delete restrict,
  student_id integer references students(id) on delete restrict,
  staff_id integer references staff(id) on delete restrict,
  issued_on date not null default current_date,
  due_on date not null,
  returned_on date,
  renewals integer not null default 0,
  fine numeric(8,2) not null default 0,
  fine_paid boolean not null default false,
  issued_by uuid references users(id) on delete set null,
  returned_by uuid references users(id) on delete set null,
  check ((student_id is not null) <> (staff_id is not null))
);
create unique index one_open_loan_per_copy on loans (copy_id) where returned_on is null;
create index loans_student_idx on loans (student_id);
create index loans_open_idx on loans (due_on) where returned_on is null;

-- ===== HR =====
create table staff_documents (
  id serial primary key,
  staff_id integer not null references staff(id) on delete cascade,
  kind text not null check (kind in ('id_proof','qualification','experience','contract','medical','other')),
  title text not null,
  stored_name text not null unique,
  original_name text not null,
  mime text not null,
  size_bytes integer not null,
  expires_on date,
  uploaded_by uuid references users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create table job_applications (
  id serial primary key,
  opening_id integer references job_openings(id) on delete set null,
  full_name text not null,
  email citext not null,
  phone text not null,
  note text,
  resume_stored text,
  resume_name text,
  status text not null default 'new' check (status in ('new','shortlisted','interview','offered','rejected','hired')),
  hr_notes text,
  consent_purpose text not null,
  consent_notice_version text not null,
  staff_id integer references staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobapps_status_idx on job_applications (status, created_at desc);
create trigger trg_jobapps_updated before update on job_applications for each row execute function set_updated_at();
create table salary_components (
  id serial primary key,
  staff_id integer not null references staff(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('earning','deduction')),
  amount numeric(10,2) not null check (amount >= 0),
  unique (staff_id, name)
);
create table payroll_runs (
  id serial primary key,
  month text not null unique check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'draft' check (status in ('draft','finalised')),
  created_by uuid references users(id) on delete set null,
  finalised_by uuid references users(id) on delete set null,
  finalised_at timestamptz,
  created_at timestamptz not null default now()
);
create table payslips (
  id serial primary key,
  run_id integer not null references payroll_runs(id) on delete cascade,
  staff_id integer not null references staff(id) on delete restrict,
  working_days numeric(4,1) not null,
  loss_of_pay_days numeric(4,1) not null default 0,
  gross numeric(10,2) not null,
  deductions numeric(10,2) not null,
  lop_deduction numeric(10,2) not null default 0,
  net numeric(10,2) not null,
  lines jsonb not null,
  unique (run_id, staff_id)
);
create index payslips_staff_idx on payslips (staff_id);

insert into permissions (code, description) values
 ('messages.use','Message parents about students in your classes'),
 ('complaints.submit','Raise a complaint or concern'),
 ('complaints.handle','Handle complaints'),
 ('complaints.confidential','See confidential complaints such as staff conduct'),
 ('transport.manage','Manage vehicles, drivers, routes and student transport'),
 ('transport.view','See transport arrangements'),
 ('library.manage','Issue and return books and manage the catalogue'),
 ('library.view','Search the library catalogue'),
 ('hr.manage','Manage staff documents and recruitment'),
 ('payroll.manage','Prepare payroll'),
 ('payroll.approve','Finalise payroll');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code in ('super_admin','school_admin') on conflict do nothing;
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='principal' and p.code in ('messages.use','complaints.submit','complaints.handle','complaints.confidential','transport.view','library.view','payroll.approve');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code in ('teacher','department_head') and p.code in ('messages.use','complaints.submit','library.view');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='transport_staff' and p.code in ('transport.manage','complaints.submit');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='librarian' and p.code in ('library.manage','library.view','complaints.submit');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='hr_staff' and p.code in ('hr.manage','payroll.manage','complaints.submit');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code in ('accounts_staff','admission_staff') and p.code in ('complaints.submit');

insert into site_settings (key, value) values ('library_loan_days','14'), ('library_fine_per_day','2'), ('library_max_books_student','3'), ('library_max_books_staff','5') on conflict do nothing;
