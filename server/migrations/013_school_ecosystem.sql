-- Phase 11: school ecosystem gaps found in the audit. Additive only: nothing here changes or removes existing data.

-- =============== Safety and well-being ===============
create table emergency_contacts (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  full_name text not null,
  relation text not null,
  phone text not null,
  priority integer not null default 1 check (priority between 1 and 9),
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index emergency_contacts_student_idx on emergency_contacts (student_id, priority);

-- People a family has authorised to collect a child. Pending until the school approves.
create table authorized_pickups (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  full_name text not null,
  relation text not null,
  phone text not null,
  id_hint text,                                 -- e.g. "Driving licence ending 4821". Never store a full ID number (Aadhaar storage is restricted by law).
  status text not null default 'pending' check (status in ('pending','approved','rejected','revoked')),
  valid_until date,
  requested_by uuid references users(id) on delete set null,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index authorized_pickups_student_idx on authorized_pickups (student_id, status);

-- Late arrivals, early departures and collections, recorded at the gate or front office.
create table gate_events (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  kind text not null check (kind in ('late_arrival','early_departure','pickup')),
  at timestamptz not null default now(),
  pickup_id integer references authorized_pickups(id) on delete set null,
  picked_up_by text,
  reason text,
  recorded_by uuid references users(id) on delete set null
);
create index gate_events_student_idx on gate_events (student_id, at desc);
create index gate_events_at_idx on gate_events (at desc);

create sequence incident_seq;
create table incidents (
  id serial primary key,
  code text not null unique default ('INC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('incident_seq')::text, 4, '0')),
  kind text not null check (kind in ('bullying','harassment','injury','safety','behaviour','health','other')),
  severity text not null default 'medium' check (severity in ('low','medium','high')),
  occurred_at timestamptz not null default now(),
  location text,
  description text not null,
  confidential boolean not null default true,
  status text not null default 'open' check (status in ('open','investigating','resolved','closed')),
  reported_by uuid references users(id) on delete set null,
  assigned_to uuid references users(id) on delete set null,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incidents_status_idx on incidents (status, created_at desc);
create table incident_students (
  incident_id integer not null references incidents(id) on delete cascade,
  student_id integer not null references students(id) on delete cascade,
  role text not null default 'involved' check (role in ('affected','involved','witness')),
  primary key (incident_id, student_id)
);
create table incident_notes (
  id serial primary key,
  incident_id integer not null references incidents(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  note text not null,
  created_at timestamptz not null default now()
);
create index incident_notes_idx on incident_notes (incident_id, created_at);

-- =============== Parent-teacher meetings ===============
create table meeting_slots (
  id serial primary key,
  staff_id integer not null references staff(id) on delete cascade,
  starts_at timestamptz not null,
  minutes integer not null default 15 check (minutes between 5 and 120),
  mode text not null default 'in_person' check (mode in ('in_person','phone','video')),
  location text,
  status text not null default 'open' check (status in ('open','cancelled')),
  created_at timestamptz not null default now(),
  unique (staff_id, starts_at)
);
create index meeting_slots_time_idx on meeting_slots (starts_at);
create table meeting_bookings (
  id serial primary key,
  slot_id integer not null references meeting_slots(id) on delete cascade,
  student_id integer not null references students(id) on delete cascade,
  booked_by uuid references users(id) on delete set null,
  agenda text,
  status text not null default 'booked' check (status in ('booked','cancelled','completed')),
  teacher_notes text,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create unique index meeting_one_active_booking on meeting_bookings (slot_id) where status = 'booked';
create index meeting_bookings_student_idx on meeting_bookings (student_id);

-- =============== Classwork: submissions, lesson plans, materials ===============
create table assignment_submissions (
  id serial primary key,
  assignment_id integer not null references assignments(id) on delete cascade,
  student_id integer not null references students(id) on delete cascade,
  body text,
  file_stored text,                              -- private storage name, never served from /uploads
  file_name text,
  submitted_by uuid references users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted','graded','returned')),
  marks numeric(6,2) check (marks is null or marks >= 0),
  feedback text,
  graded_by uuid references users(id) on delete set null,
  graded_at timestamptz,
  unique (assignment_id, student_id)
);
create index assignment_submissions_assignment_idx on assignment_submissions (assignment_id);

create table lesson_plans (
  id serial primary key,
  section_id integer not null references sections(id) on delete cascade,
  subject_id integer not null references subjects(id) on delete restrict,
  staff_id integer not null references staff(id) on delete restrict,
  planned_on date not null,
  topic text not null,
  objectives text,
  activities text,
  resources text,
  status text not null default 'planned' check (status in ('planned','done','skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lesson_plans_section_idx on lesson_plans (section_id, planned_on desc);

create table learning_materials (
  id serial primary key,
  section_id integer not null references sections(id) on delete cascade,
  subject_id integer not null references subjects(id) on delete restrict,
  staff_id integer not null references staff(id) on delete restrict,
  title text not null,
  description text,
  link_url text,
  file_stored text,
  file_name text,
  created_at timestamptz not null default now()
);
create index learning_materials_section_idx on learning_materials (section_id, created_at desc);

-- =============== Development beyond marks ===============
create table student_activities (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  kind text not null check (kind in ('sport','arts','club','academic','community','competition','leadership','other')),
  title text not null,
  level text not null default 'school' check (level in ('class','school','inter_school','district','state','national','international')),
  occurred_on date not null,
  result text,
  description text,
  visible_to_family boolean not null default true,
  recorded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index student_activities_student_idx on student_activities (student_id, occurred_on desc);
create table student_observations (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  category text not null check (category in ('learning','social','skills','interests','wellbeing','support')),
  note text not null,
  shared_with_family boolean not null default false,
  needs_support boolean not null default false,
  author_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index student_observations_student_idx on student_observations (student_id, created_at desc);

-- =============== Notification preferences and delivery log ===============
create table notification_prefs (
  user_id uuid primary key references users(id) on delete cascade,
  email boolean not null default true,
  sms boolean not null default false,
  whatsapp boolean not null default false,
  muted_categories text[] not null default '{}',   -- safety messages can never be muted
  updated_at timestamptz not null default now()
);
create table outbox (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  channel text not null check (channel in ('email','sms','whatsapp')),
  to_address text not null,
  subject text,
  body text not null,
  category text not null default 'general',
  dedupe_key text,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider_ref text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index outbox_dedupe_idx on outbox (user_id, channel, dedupe_key) where dedupe_key is not null;
create index outbox_due_idx on outbox (status, next_attempt_at);

-- =============== Admissions waiting list ===============
alter table applications drop constraint if exists applications_status_check;
alter table applications add constraint applications_status_check
  check (status in ('submitted','under_review','documents_pending','verified','approved','waitlisted','rejected','withdrawn','enrolled'));

-- =============== Permissions ===============
insert into permissions (code, description) values
 ('safety.gate','Record late arrivals, early departures and collections'),
 ('safety.pickups.manage','Approve or revoke authorised pickup persons'),
 ('incidents.report','Report a safety or well-being incident'),
 ('incidents.manage','See and handle incidents, including confidential ones'),
 ('meetings.manage','Offer parent-teacher meeting times'),
 ('growth.manage','Record activities, achievements and observations'),
 ('reports.view','See school-wide reports'),
 ('notifications.manage','See the message delivery log and retry failures'),
 ('privacy.export','Export a student''s personal data on request');

insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code in ('super_admin','school_admin') and p.code in ('safety.gate','safety.pickups.manage','incidents.report','incidents.manage','meetings.manage','growth.manage','reports.view','notifications.manage','privacy.export')
  on conflict do nothing;
insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code = 'principal' and p.code in ('safety.gate','safety.pickups.manage','incidents.report','incidents.manage','meetings.manage','growth.manage','reports.view','notifications.manage')
  on conflict do nothing;
insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code in ('teacher','department_head') and p.code in ('incidents.report','meetings.manage','growth.manage')
  on conflict do nothing;
insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code in ('transport_staff','librarian','hr_staff','accounts_staff','admission_staff') and p.code = 'incidents.report'
  on conflict do nothing;
