# Architecture

**Single-school** deployment (`schools` table is constrained to one row). One Node process serves the REST API and the built React app. PostgreSQL is the only datastore. No microservices.

```
server/src
  config.ts, db.ts, migrate.ts, logger.ts, jobs.ts
  middleware/   auth (sessions, CSRF, permission checks), errors
  lib/          password (scrypt), crypto (AES-GCM, hashing), totp, audit
  modules/      auth, users, inbox, staff (dashboard/audit/notifications), uploads, cms/{entities,admin,public}
server/migrations   forward-only SQL, applied in order and recorded
web/src
  site/ public website · portal/ staff portal · components/ design system · styles/
```

## Security model (implemented)
- Passwords: scrypt (N=32768). Sessions: random token in an `HttpOnly`, `SameSite=Lax`, `Secure` (prod) cookie; only a SHA-256 hash is stored. Absolute and idle expiry.
- CSRF: Origin check plus per-session token header on every signed-in mutation.
- Lockout after 5 failures (15 min) + per-IP rate limits on login, forms and the API. Generic login errors; dummy hash to equalise timing.
- RBAC: roles → permissions, enforced in the backend on every route (`requirePermission`). Users may hold several roles. Only a Super Admin can grant/modify Super Admin; the last active Super Admin is protected.
- Optional TOTP two-step verification (secret encrypted at rest).
- Uploads: type decided by file signature (JPG/PNG/WebP/PDF only), size limits, random file names, no SVG. `storage/private` is reserved for sensitive documents and is never served statically.
- All SQL parameterised; content/field names come from a server-side registry. Admin text is rendered as text, never HTML. Helmet CSP and security headers.
- Privacy: forms capture purpose-specific consent with the notice version; inbox views are audit-logged; closed enquiries are purged after a configurable retention period; logs redact personal fields.

## Content management
`server/src/modules/cms/entities.ts` is the single definition of every editable content type. The admin forms, list tables, validation and public read endpoints are all generated from it. Adding a content type = one migration + one entry.

## Roles (seeded)
Super Admin, School Admin, Principal, Department Head, Teacher, Student, Parent, Accounts, Admission, HR, Transport, Librarian. Permissions are added per module by later migrations.

## Roadmap
| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: stack, schema, auth, RBAC, design system, routing | Done |
| 2 | Public website + editable content, gallery, calendar, enquiry/contact forms | Done (online application form arrives in Phase 6) |
| 3 | Students, teachers, classes/sections, subjects, academic years, departments, admin dashboard | Done (student ID issued on registration, reused by admissions in Phase 6) |
| 4 | Timetable and periods, student and staff attendance, leave, vacant periods and substitutions, homework, exams, marks, class and section rankings, report cards, analytics | Done (parent and student views of this data arrive in Phase 5) |
| 5 | Parent and student portals: student-ID login, sibling linking, attendance, results and rankings (own rank only), homework, timetable, notices, remarks, leave | Done (fees and transport tiles are placeholders until Phases 6 and 7; complaints and parent-teacher messaging arrive in Phase 7) |
| 6 | Online admission workflow, fees, payments, receipts, concessions, refunds, reports | |
| 7 | HR, transport, library, communication, complaints | |
| 8 | SMS / WhatsApp / email / payment gateway integrations, scheduled reminders | needs provider accounts |
| 9 | Full security, permission, isolation, performance and UI test pass | |
| 10 | Production hardening, monitoring/error tracking, backups, launch checklist | |

## Planned schema (later phases)
academic_years ✔ · classes, sections, subjects, class_subjects · students, guardians, student_guardians (parent↔child link used for every parent query) · staff/teachers, teacher_assignments · attendance, timetable_slots · assignments, submissions · exams, exam_subjects, results · fee_structures, fee_invoices, payments, receipts, concessions, refunds, expenses · applications, application_documents · vehicles, drivers, routes, stops, transport_assignments · books, copies, loans, fines · notices, complaints, leave_requests · documents (private storage) · consents, data_requests.
Parent/student/teacher data access will be enforced in SQL-level scoping (`student_id in (linked children)`, `class_id in (assigned classes)`), never by hiding UI.

## Phase 4 rules worth knowing
- A teacher cannot be booked in two classes in the same period (enforced by the database and checked with a friendly message).
- A **vacant period** is a timetable entry whose teacher is marked absent, or has approved leave, on that date. Approving leave marks the teacher on leave for each working day (not Sundays).
- **Substitutes** must be free that period (no own class, not absent, not already covering). They are ranked: teaches the subject, same department, fewest covers that day. The substitute is notified. Marking the teacher present later removes the now-unneeded substitution.
- **Attendance:** the class teacher marks their own class; admins and principals can see every class. Future dates and Sundays are refused.
- **Marks:** teachers enter marks only for sections and subjects assigned to them, never above the maximum. Publishing is blocked while any mark is missing. Once published, only administrators can correct marks (audited).
- **Ranking:** total marks across all subjects; equal totals share a rank (1, 2, 2, 4). Only students with every subject entered are ranked; others show as pending. Ranks are given within the section and within the class, and per subject. Grade scale is a constant in `exams.ts` (A+ 90, A 80, B 70, C 60, D 50, E 40, F below) and can be made configurable.

## Phase 5 rules worth knowing
- **Logins.** The parent's username is a child's student ID. One parent account is reached by every linked child's ID (stored as aliases), so a parent with several children signs in once and switches between them. Parent accounts are matched by phone number, so siblings share one guardian record. Students may also have their own login (`<student ID>-S`). Both are issued by staff with `family_accounts.manage`, with a one-time temporary password that must be changed at first sign-in.
- **Isolation.** Every family endpoint resolves the child through one guard (`childOf`): a child that is not linked to the signed-in account is answered with "not found", the same as a child that does not exist. Family accounts hold no staff permissions, so every staff endpoint refuses them, and staff accounts are refused by the family API. Covered by automated tests, including the sibling case.
- **Results.** Parents and students see only *published* exams, only their own marks and their own rank (never other students' names or marks). Subject comparison uses the class average only.
- **Notifications.** Parents are notified when a child is marked absent, results are published, homework is set, a teacher shares a remark, a notice is published for them, or a leave request is decided.
- **Leave.** Parents apply; the class teacher (or an administrator) decides. Approved days appear as "excused" in attendance and are pre-filled in the teacher's attendance sheet.
- **Sign-in protection.** `LOGIN_RATE_LIMIT` (default 30 attempts per IP per 15 minutes), account lockout after 5 wrong passwords, optional two-step verification from My account.
