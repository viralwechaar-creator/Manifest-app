-- Public website content, all editable from the admin panel.
create table site_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null
);

create table pages (
  slug text primary key,
  title text not null,
  subtitle text,
  body text not null default '',
  image_url text,
  published boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger trg_pages_updated before update on pages for each row execute function set_updated_at();

create table news (
  id serial primary key,
  title text not null,
  kind text not null default 'news' check (kind in ('news','announcement')),
  summary text,
  body text,
  image_url text,
  pinned boolean not null default false,
  published boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index news_pub_idx on news (published, pinned desc, published_at desc);
create trigger trg_news_updated before update on news for each row execute function set_updated_at();

create table events (
  id serial primary key,
  title text not null,
  category text not null default 'Other',
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  image_url text,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index events_start_idx on events (published, starts_at);
create trigger trg_events_updated before update on events for each row execute function set_updated_at();

create table achievements (
  id serial primary key,
  title text not null,
  category text,
  description text,
  achieved_on date,
  image_url text,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index achievements_idx on achievements (published, achieved_on desc);
create trigger trg_achievements_updated before update on achievements for each row execute function set_updated_at();

create table gallery_albums (
  id serial primary key,
  title text not null,
  description text,
  cover_url text,
  sort integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_albums_updated before update on gallery_albums for each row execute function set_updated_at();

create table gallery_items (
  id serial primary key,
  album_id integer not null references gallery_albums(id) on delete cascade,
  image_url text not null,
  caption text,
  sort integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gallery_items_album_idx on gallery_items (album_id, sort);
create trigger trg_gitems_updated before update on gallery_items for each row execute function set_updated_at();

create table faculty (
  id serial primary key,
  name text not null,
  designation text not null,
  department_id integer references departments(id) on delete set null,
  qualification text,
  bio text,
  photo_url text,
  sort integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index faculty_dept_idx on faculty (department_id);
create trigger trg_faculty_updated before update on faculty for each row execute function set_updated_at();

create table curriculum (
  id serial primary key,
  stage text not null,
  title text not null,
  class_label text,
  description text,
  subjects text[] not null default '{}',
  sort integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_curriculum_updated before update on curriculum for each row execute function set_updated_at();

create table documents (
  id serial primary key,
  title text not null,
  category text not null default 'Other',
  file_url text not null,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_documents_updated before update on documents for each row execute function set_updated_at();

create table job_openings (
  id serial primary key,
  title text not null,
  department text,
  employment_type text not null default 'Full-time',
  description text,
  closes_on date,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_jobs_updated before update on job_openings for each row execute function set_updated_at();

create table alumni (
  id serial primary key,
  name text not null,
  batch_year smallint,
  occupation text,
  story text,
  photo_url text,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_alumni_updated before update on alumni for each row execute function set_updated_at();

-- Public form submissions. Personal data: access restricted, retention enforced by a job.
create table admission_enquiries (
  id serial primary key,
  student_name text not null,
  grade_applying text not null,
  parent_name text not null,
  phone text not null,
  email citext,
  message text,
  status text not null default 'new' check (status in ('new','contacted','closed')),
  notes text,
  consent_purpose text not null,
  consent_notice_version text not null,
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index enquiries_status_idx on admission_enquiries (status, created_at desc);
create trigger trg_enq_updated before update on admission_enquiries for each row execute function set_updated_at();

create table contact_messages (
  id serial primary key,
  name text not null,
  email citext,
  phone text,
  subject text not null,
  message text not null,
  status text not null default 'new' check (status in ('new','read','closed')),
  consent_purpose text not null,
  consent_notice_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contact_status_idx on contact_messages (status, created_at desc);
create trigger trg_contact_updated before update on contact_messages for each row execute function set_updated_at();
