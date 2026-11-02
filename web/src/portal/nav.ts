/** The staff portal's menu: a few smart categories, each showing only what the signed-in person may use. */
export interface NavItem { to: string; label: string; hint?: string }
export interface NavCategory { id: string; label: string; icon: string; items: NavItem[] }

type Can = (p: string) => boolean;
const any = (can: Can, ...p: string[]) => p.some((x) => can(x));

export function buildNav(can: Can, entities: { key: string; label: string; group: string }[]): NavCategory[] {
  const cats: NavCategory[] = [];
  const add = (id: string, label: string, icon: string, items: (NavItem | false)[]) => { const list = items.filter(Boolean) as NavItem[]; if (list.length) cats.push({ id, label, icon, items: list }); };

  add('overview', 'Overview', 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', [{ to: '/portal', label: 'Dashboard', hint: 'Your day at a glance' }]);
  add('people', 'People', 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0', [
    can('students.view') && { to: '/portal/students', label: 'Students', hint: 'Records, classes, parents' },
    can('staff.view') && { to: '/portal/staff', label: 'Teachers & staff', hint: 'Directory and assignments' },
    any(can, 'admissions.review', 'admissions.view') && { to: '/portal/admissions', label: 'Admissions', hint: 'Applications and enrolment' },
    can('student_leave.decide') && { to: '/portal/student-leave', label: 'Student leave', hint: 'Requests from parents' },
  ]);
  add('teaching', 'Teaching', 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4', [
    any(can, 'academics.manage', 'staff.view') && { to: '/portal/academics', label: 'Academic setup', hint: 'Years, classes, subjects' },
    can('timetable.view') && { to: '/portal/timetable', label: 'Timetable', hint: 'Periods and weekly schedules' },
    any(can, 'attendance.students.mark', 'attendance.students.view_all', 'attendance.staff.view') && { to: '/portal/attendance', label: 'Attendance', hint: 'Students and staff' },
    can('homework.manage') && { to: '/portal/homework', label: 'Homework', hint: 'Set and track work' },
    any(can, 'exams.manage', 'marks.enter', 'results.view_all') && { to: '/portal/exams', label: 'Exams & rankings', hint: 'Marks, results, report cards' },
    can('substitutions.manage') && { to: '/portal/substitutions', label: 'Substitutions', hint: 'Vacant periods' },
    can('homework.manage') && { to: '/portal/lessons', label: 'Lessons & materials', hint: 'Plans and shared files' },
    can('meetings.manage') && { to: '/portal/meetings', label: 'Parent meetings', hint: 'Offer and see bookings' },
    can('growth.manage') && { to: '/portal/support', label: 'Needs support', hint: 'Students to look at closely' },
  ]);
  add('safety', 'Safety', 'M12 21s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z', [
    can('safety.gate') && { to: '/portal/safety/gate', label: 'Gate desk', hint: 'Late, early, pickups' },
    can('safety.pickups.manage') && { to: '/portal/safety/pickups', label: 'Pickup approvals', hint: 'Who may collect a child' },
    can('incidents.report') && { to: '/portal/safety/incidents', label: 'Incidents', hint: 'Report and handle' },
  ]);
  add('finance', 'Finance', 'M4 7h16v12H4zM4 11h16M8 15h3', [
    any(can, 'fees.view', 'expenses.manage') && { to: '/portal/finance', label: 'Fees & accounts', hint: 'Collect, receipts, reports' },
    any(can, 'hr.manage', 'payroll.manage', 'payroll.approve') && { to: '/portal/hr', label: 'HR & payroll', hint: 'Recruitment, salaries' },
  ]);
  add('operations', 'Operations', 'M3 7h13v9H3zM16 10h3l2 3v3h-5M7 19a1.5 1.5 0 1 0 0-.01M18 19a1.5 1.5 0 1 0 0-.01', [
    any(can, 'transport.manage', 'transport.view') && { to: '/portal/transport', label: 'Transport', hint: 'Routes, vehicles, drivers' },
    any(can, 'library.manage', 'library.view') && { to: '/portal/library', label: 'Library', hint: 'Catalogue, loans, fines' },
    can('leave.apply') && { to: '/portal/leave', label: 'Leave', hint: 'Apply and approve' },
    { to: '/portal/my/payslips', label: 'My payslips', hint: 'Pay and documents' },
  ]);
  add('communication', 'Communication', 'M4 5h16v11H9l-5 4z', [
    can('messages.use') && { to: '/portal/messages', label: 'Messages', hint: 'Talk to parents' },
    any(can, 'complaints.submit', 'complaints.handle') && { to: '/portal/complaints', label: 'Complaints', hint: 'Concerns and their handling' },
    can('notices.manage') && { to: '/portal/notices', label: 'Notices', hint: 'Announcements to families' },
    can('enquiries.manage') && { to: '/portal/inbox/enquiries', label: 'Admission enquiries', hint: 'From the website' },
    can('enquiries.manage') && { to: '/portal/inbox/messages', label: 'Contact messages', hint: 'From the website' },
  ]);
  add('website', 'Website', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', [
    ...(can('cms.manage') ? entities.map((e) => ({ to: `/portal/content/${e.key}`, label: e.label, hint: e.group })) : []),
    can('settings.manage') && { to: '/portal/settings', label: 'Site settings', hint: 'Name, contact, privacy' },
  ]);
  add('admin', 'Admin', 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', [
    can('users.manage') && { to: '/portal/users', label: 'Users & roles', hint: 'Accounts and access' },
    can('reports.view') && { to: '/portal/reports', label: 'Reports', hint: 'Enrolment, workload, safety' },
    can('notifications.manage') && { to: '/portal/delivery', label: 'Message delivery', hint: 'Email, SMS, WhatsApp log' },
    can('audit.view') && { to: '/portal/audit', label: 'Audit log', hint: 'Who did what' },
  ]);
  return cats;
}

/** The category whose item best matches the current address (longest matching path wins). */
export function activeCategory(cats: NavCategory[], pathname: string): { cat?: NavCategory; item?: NavItem } {
  let best: { cat?: NavCategory; item?: NavItem; len: number } = { len: -1 };
  for (const c of cats) for (const i of c.items) {
    const hit = i.to === '/portal' ? pathname === '/portal' : pathname === i.to || pathname.startsWith(i.to + '/');
    if (hit && i.to.length > best.len) best = { cat: c, item: i, len: i.to.length };
  }
  return best;
}
