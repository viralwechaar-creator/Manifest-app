-- Phase 6B: fee structures, charges, payments (any mode), receipts, concessions, refunds, expenses.
create table fee_heads (id serial primary key, name text not null unique, active boolean not null default true);

create table fee_structure_items (
  id serial primary key,
  academic_year_id integer not null references academic_years(id) on delete restrict,
  class_id integer not null references classes(id) on delete restrict,
  head_id integer not null references fee_heads(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  frequency text not null check (frequency in ('one_time','monthly','quarterly','annual')),
  first_due_on date not null,
  unique (academic_year_id, class_id, head_id)
);

create table fee_charges (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  item_id integer references fee_structure_items(id) on delete set null,
  head_id integer not null references fee_heads(id) on delete restrict,
  academic_year_id integer not null references academic_years(id) on delete restrict,
  period_key text not null,
  description text not null,
  amount numeric(10,2) not null check (amount > 0),
  due_on date not null,
  created_at timestamptz not null default now(),
  unique (student_id, item_id, period_key)
);
create index charges_student_idx on fee_charges (student_id, due_on);
create index charges_due_idx on fee_charges (due_on);

-- Signed: negative reduces what is owed (concession, waiver), positive adds (late fee).
create table fee_adjustments (
  id serial primary key,
  charge_id integer not null references fee_charges(id) on delete cascade,
  amount numeric(10,2) not null check (amount <> 0),
  kind text not null check (kind in ('concession','waiver','late_fee','correction')),
  reason text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index adjustments_charge_idx on fee_adjustments (charge_id);

-- Standing concessions applied automatically when charges are generated.
create table concessions (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  head_id integer references fee_heads(id) on delete cascade,   -- null = every head
  academic_year_id integer not null references academic_years(id) on delete restrict,
  kind text not null check (kind in ('percent','fixed')),
  value numeric(10,2) not null check (value > 0),
  reason text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100)
);

create table payments (
  id serial primary key,
  receipt_no text not null unique,
  student_id integer not null references students(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  mode text not null check (mode in ('cash','cheque','upi','bank_transfer','card','online','other')),
  reference text,
  paid_on date not null,
  note text,
  source text not null default 'counter' check (source in ('counter','claim','gateway')),
  status text not null default 'valid' check (status in ('valid','cancelled')),
  cancel_reason text,
  received_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_student_idx on payments (student_id);
create index payments_date_idx on payments (paid_on);

create table payment_allocations (
  payment_id integer not null references payments(id) on delete cascade,
  charge_id integer not null references fee_charges(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  primary key (payment_id, charge_id)
);
create index alloc_charge_idx on payment_allocations (charge_id);

create table refunds (
  id serial primary key,
  payment_id integer not null references payments(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  requested_by uuid references users(id) on delete set null,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  payout_mode text,
  payout_reference text,
  created_at timestamptz not null default now()
);

create table expenses (
  id serial primary key,
  category text not null,
  description text not null,
  amount numeric(10,2) not null check (amount > 0),
  spent_on date not null,
  mode text not null check (mode in ('cash','cheque','upi','bank_transfer','card','other')),
  reference text,
  paid_to text,
  recorded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index expenses_date_idx on expenses (spent_on);

create table payment_claims (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  mode text not null check (mode in ('cash','cheque','upi','bank_transfer','card','online','other')),
  reference text,
  paid_on date not null,
  note text,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  submitted_by uuid references users(id) on delete set null,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  payment_id integer references payments(id) on delete set null,
  created_at timestamptz not null default now()
);
create index claims_status_idx on payment_claims (status, created_at);

create table receipt_counters (year integer primary key, last_number integer not null default 0);
create table fee_reminders (charge_id integer not null references fee_charges(id) on delete cascade, stage text not null, sent_at timestamptz not null default now(), primary key (charge_id, stage));

insert into permissions (code, description) values
 ('fees.setup','Define fee heads and structures and generate fees'),
 ('fees.view','See fee dues and payments'),
 ('fees.collect','Record payments and review parents'' payment notifications'),
 ('fees.concession','Give discounts, waivers and concessions'),
 ('refunds.request','Request a refund'),
 ('refunds.approve','Approve refunds and cancel wrong payments'),
 ('expenses.manage','Record school expenses'),
 ('finance.reports','See financial reports');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code in ('super_admin','school_admin') on conflict do nothing;
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='accounts_staff' and p.code in ('fees.setup','fees.view','fees.collect','fees.concession','refunds.request','expenses.manage','finance.reports');
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code='principal' and p.code in ('fees.view','fees.concession','refunds.approve','finance.reports');

insert into site_settings (key, value) values ('payment_instructions','Pay at the school accounts office (cash, cheque, UPI or card), or by bank transfer. After paying, use “I have paid” in the parent portal to tell us the details.') on conflict do nothing;
