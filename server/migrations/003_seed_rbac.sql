insert into schools (id, legal_name) values (1, 'Your School Name');

insert into roles (code, name, description) values
 ('super_admin','Super Admin','Full control of the system, including users and security'),
 ('school_admin','School Admin','Runs day-to-day administration and website content'),
 ('principal','Principal','School-wide oversight'),
 ('department_head','Department Head','Leads an academic department'),
 ('teacher','Teacher','Teaching staff'),
 ('student','Student','Student portal'),
 ('parent','Parent','Parent portal (own children only)'),
 ('accounts_staff','Accounts Staff','Fees and finance'),
 ('admission_staff','Admission Staff','Enquiries and admissions'),
 ('hr_staff','HR Staff','Staff records, leave and payroll'),
 ('transport_staff','Transport Staff','Vehicles, routes and drivers'),
 ('librarian','Librarian','Library catalogue and circulation');

insert into permissions (code, description) values
 ('dashboard.view','See the staff dashboard'),
 ('cms.manage','Edit public website content'),
 ('settings.manage','Edit school-wide website settings'),
 ('enquiries.manage','View and handle admission enquiries and contact messages'),
 ('users.manage','Create and manage user accounts'),
 ('audit.view','View the audit log');

-- super_admin and school_admin: everything
insert into role_permissions select r.id, p.id from roles r, permissions p where r.code in ('super_admin','school_admin');
-- principal
insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code='principal' and p.code in ('dashboard.view','audit.view');
-- admission staff
insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code='admission_staff' and p.code in ('dashboard.view','enquiries.manage');
-- other staff roles: dashboard only (module permissions are added by later migrations)
insert into role_permissions select r.id, p.id from roles r, permissions p
  where r.code in ('department_head','teacher','accounts_staff','hr_staff','transport_staff','librarian')
    and p.code='dashboard.view';
