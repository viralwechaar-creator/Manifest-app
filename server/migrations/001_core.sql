-- Core: school, academic years, departments, identity, RBAC, sessions, audit.
create extension if not exists citext;

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- Single-school deployment: the CHECK keeps exactly one row.
create table schools (
  id smallint primary key default 1 check (id = 1),
  legal_name text not null,
  board text,
  affiliation_number text,
  established_year smallint,
  timezone text not null default 'Asia/Kolkata',
  currency char(3) not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_schools_updated before update on schools for each row execute function set_updated_at();

create table academic_years (
  id serial primary key,
  label text not null unique,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_on > starts_on)
);
create unique index academic_years_one_current on academic_years (is_current) where is_current;

create table departments (
  id serial primary key,
  name text not null unique,
  description text,
  image_url text,
  sort integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_departments_updated before update on departments for each row execute function set_updated_at();

create table roles (
  id serial primary key,
  code text not null unique,
  name text not null,
  description text,
  is_system boolean not null default true
);
create table permissions (
  id serial primary key,
  code text not null unique,
  description text not null
);
create table role_permissions (
  role_id integer not null references roles(id) on delete cascade,
  permission_id integer not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table users (
  id uuid primary key default gen_random_uuid(),
  login_id citext not null unique,          -- email, staff code or (later) student ID
  email citext,
  display_name text not null,
  password_hash text not null,
  status text not null default 'active' check (status in ('active','suspended')),
  must_change_password boolean not null default false,
  mfa_secret_enc text,
  mfa_enabled boolean not null default false,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index users_email_idx on users (email);
create trigger trg_users_updated before update on users for each row execute function set_updated_at();

create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role_id integer not null references roles(id) on delete restrict,
  primary key (user_id, role_id)
);
create index user_roles_role_idx on user_roles (role_id);

-- Only a SHA-256 hash of the session token is stored.
create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  csrf_token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip text
);
create index sessions_user_idx on sessions (user_id);
create index sessions_expires_idx on sessions (expires_at);

create table audit_logs (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  ip text,
  details jsonb
);
create index audit_at_idx on audit_logs (at desc);
create index audit_entity_idx on audit_logs (entity, entity_id);
create index audit_user_idx on audit_logs (user_id);

create table notifications (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, read_at, created_at desc);
