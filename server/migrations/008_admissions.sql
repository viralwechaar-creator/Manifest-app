-- Phase 6A: online admission applications, document verification, enrolment.
create table applications (
  id serial primary key,
  reference text not null unique,                 -- e.g. APP-2026-0001, quoted on every message
  tracking_hash text not null,                    -- sha256 of the secret tracking code given to the applicant once
  status text not null default 'submitted' check (status in ('submitted','under_review','documents_pending','verified','approved','rejected','withdrawn','enrolled')),
  academic_year_id integer not null references academic_years(id) on delete restrict,
  class_id integer not null references classes(id) on delete restrict,
  student_name text not null,
  date_of_birth date not null,
  gender text not null check (gender in ('female','male','other')),
  previous_school text,
  address text,
  health_notes text,
  guardian_name text not null,
  guardian_relation text not null,
  guardian_phone text not null,
  guardian_email citext,
  consent_purpose text not null,
  consent_notice_version text not null,
  consented_at timestamptz not null default now(),
  decision_note text,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  student_id integer unique references students(id) on delete set null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index applications_status_idx on applications (status, submitted_at desc);
create index applications_class_idx on applications (class_id, academic_year_id);
create trigger trg_applications_updated before update on applications for each row execute function set_updated_at();

create table application_documents (
  id serial primary key,
  application_id integer not null references applications(id) on delete cascade,
  kind text not null check (kind in ('birth_certificate','photo','address_proof','transfer_certificate','previous_marksheet','other')),
  original_name text not null,
  stored_name text not null unique,               -- file lives in PRIVATE storage, never under /uploads
  mime text not null,
  size_bytes integer not null,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  review_note text,
  reviewed_by uuid references users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index app_docs_idx on application_documents (application_id);

create table application_events (
  id bigserial primary key,
  application_id integer not null references applications(id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null,                            -- 'applicant' or a staff name
  action text not null,
  note text
);
create index app_events_idx on application_events (application_id, at);

create table application_counters (year integer primary key, last_number integer not null default 0);

insert into permissions (code, description) values
 ('admissions.review','Review applications, verify documents, approve and enrol'),
 ('admissions.view','See admission applications (read only)');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code in ('super_admin','school_admin') on conflict do nothing;
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='admission_staff' and p.code in ('admissions.review');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='principal' and p.code in ('admissions.view');

insert into site_settings (key, value) values
 ('admission_required_documents','birth_certificate,photo'),
 ('admissions_accepting','true')
on conflict do nothing;
