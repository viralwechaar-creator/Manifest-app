# System audit, gap analysis and implementation (Phase 11)

How to read the status words used below:
- **Done**: built, connected to the database, permission-checked, and exercised by an automated test or a browser walkthrough.
- **Partial**: works, but a part of the requirement is not covered (stated).
- **Missing**: not built. The reason is given.
- **N/A**: does not apply to this product by design.
- **Needs provider**: the structure is built; it cannot work until you supply an outside account. Not tested against the live service.

---

## A. Audit report: what existed before this phase

A single-school system (React + TypeScript front end, Node + TypeScript API, PostgreSQL, 12 migrations, 24 server modules, 49 screens, 12 roles with permissions stored in the database). Before this phase it had:

- Public website (23 pages, editable), enquiry and contact forms, online admission with tracking.
- Student, parent, guardian and staff records; class and section history; promotion; status changes with reasons.
- Timetable, periods, student and staff attendance, leave, vacant-period substitution.
- Homework (set by teachers, read by families), exams, marks, rankings, report cards, performance trends.
- Fees: structure, charges, concessions, receipts, refunds (two-person), expenses, claims, reminders.
- Transport, library, HR, payroll, recruitment; messaging, complaints, notices.
- Parent and student portals (own children only, several children under one login).
- Security: scrypt passwords, lockout, optional two-step sign-in, database sessions, CSRF protection, rate limits, audit log, private file storage, retention job.
- 92 automated tests, including an automatic check that every API route is guarded and that no family can reach another family's child.

Checks run for this audit (not assumed): every route's authorisation (automatic), every child-specific route against another family's child (automatic), upload handling, dependency vulnerabilities (none), database indexes (added), accessibility of 19 screens (two kinds of problem, fixed), mobile layout of 40+ screens (fixed earlier).

## B. Gap report: what was missing or weak

| # | Gap | Who it affects | Priority |
|---|---|---|---|
| 1 | No incident, bullying or harassment reporting with confidential handling | Students, teachers, principal | Student safety |
| 2 | No authorised-pickup control; no record of late arrivals, early departures or collections | Parents, gate staff | Student safety |
| 3 | No emergency contacts | Parents, school | Student safety |
| 4 | No parent-teacher meeting booking (parents had to phone) | Parents, teachers | Parent and teacher experience |
| 5 | Homework could be set but not handed in or marked | Students, parents, teachers | Broken core academic workflow |
| 6 | No lesson plans; no learning materials | Teachers, families | Teacher experience |
| 7 | Development reduced to marks: no activities, achievements, observations, support flags | Teachers, families | Academic and development |
| 8 | Notifications were in-app only: no email/SMS/WhatsApp, no preferences, no delivery status | Everyone | Essential operations |
| 9 | One hard-coded grading scale; no board setting | Schools following different boards | India-specific |
| 10 | No late fees | Accounts | Essential operations |
| 11 | No admissions waiting list | Admissions | Essential operations |
| 12 | No way to give a family a copy of a student's data on request | School (DPDP) | Privacy |
| 13 | No robots.txt, sitemap or page-level search tags | Public website | Optional |
| 14 | Only English | Parents | Accessibility |
| 15 | Reports missing: teacher workload, enrolment and retention, transport use, safety | Principal | Analytics |
| 16 | Low colour contrast on small status badges; attendance calendar not readable by screen readers | Users of assistive tools | Accessibility |

No critical security or privacy defect was found in the existing code. The automatic route-guard and family-isolation tests were extended to cover every new route.

## C. Implementation report: what was built

All of it is additive (migration `013_school_ecosystem.sql` only adds tables, columns' allowed values and permissions). Nothing was deleted or rewritten, and existing data is untouched.

| Gap | What was built | Main files |
|---|---|---|
| 1 | Incident reporting (kind, severity, students and roles, location), confidential by default and always for bullying/harassment; reporters see only their own; managers see all, assign, add notes, must write a resolution to close; the school chooses whether and what to tell a family; opening a confidential report is audited | `modules/school/wellbeing.ts`, `portal/Safety.tsx` |
| 2 | Pickup people: families request, school approves/declines/removes; gate desk records late arrival, early departure, collection (collection only by a guardian or an approved, unexpired person); family is notified; full ID numbers refused | `wellbeing.ts`, `portal/Safety.tsx`, `family/Family3.tsx` |
| 3 | Emergency contacts: parents add; sensitive-access staff read (audited); Indian mobile validation | `wellbeing.ts`, `portal/StudentExtras.tsx` |
| 4 | Teachers offer meeting times; parents book only with their own child's teachers; one booking per slot (races resolved), cancel frees the slot, both sides notified | `meetings.ts`, `portal/Teaching2.tsx`, `family/Family3.tsx` |
| 5 | Homework hand-in (text and/or PDF/photo, private storage, file type checked by content), lateness shown, teacher marking with marks limit and feedback, "return for changes", marked work is final, family notified | `classwork.ts`, `portal/Teaching2.tsx`, `family/Family3.tsx` |
| 6 | Lesson plans (only for classes you teach), learning materials (file or link, shared with that class only) | `classwork.ts`, `portal/Teaching2.tsx` |
| 7 | Activities and achievements (sport, arts, clubs, competitions, leadership, community), teacher observations (private unless shared), "may need support" list (teacher flag, attendance under 75% in 30 days, latest exam under 40%) limited to your own classes; families see only what is marked for them | `growth.ts`, `portal/StudentExtras.tsx`, `portal/Teaching2.tsx` |
| 8 | Preferences (email, SMS, WhatsApp opt-in; mute topics except safety), delivery queue with retries, failure state, retry button, de-duplication per person/channel/day, masked log, signed webhook to your relay | `lib/delivery.ts`, `platform.ts`, `portal/Reports.tsx`, `portal/Prefs.tsx`, `docs/NOTIFICATIONS.md` |
| 9 | Board setting and three grading scales (percentage letters, CBSE-style 9-point, grade points) chosen in Site settings; applied to results and report cards | `lib/grading.ts`, `cms/entities.ts` |
| 10 | Late fee: amount and grace days in settings; "Apply late fees" adds one late-fee adjustment per overdue fee (never twice), notifies the family; off until an amount is set | `fees.ts`, `portal/Finance.tsx` |
| 11 | "Waiting list" action (note required), approval still possible later, applicants see their status | `admissions.ts`, `portal/Admissions.tsx`, `site/Admission.tsx` |
| 12 | Authorised people can download everything held about a student (JSON); audited | `platform.ts`, `portal/StudentExtras.tsx` |
| 13 | `robots.txt`, `sitemap.xml` (public pages only), per-page titles, descriptions, share tags, school structured data | `modules/seo.ts`, `site/SiteLayout.tsx`, `vercel.json` |
| 14 | Hindi/English switch on sign-in, public menu and the parent portal (menus, new pages); framework ready for more languages | `web/src/i18n.tsx` |
| 15 | Reports page: enrolment and retention, teacher workload, transport use and vehicle papers due, safety | `reports.ts`, `portal/Reports.tsx` |
| 16 | Contrast and calendar markup fixed; accessibility scan of 38 screens: zero violations | `styles/*.css`, `family/Family.tsx` |

## D. Remaining requirements

**Needs your accounts or decisions**
- **Email, SMS, WhatsApp delivery**: needs a provider and a small relay (see `docs/NOTIFICATIONS.md`). Indian SMS and WhatsApp also need registered sender names and approved templates.
- **Online payment gateway**: not built; payments carry a `gateway` source for it. Needs a gateway account (Razorpay, PayU, Cashfree or similar).
- **Live GPS tracking**: not built (needs vehicle devices and infrastructure). Not claimed.
- **Legal review** of the privacy notice, consent wording, retention periods and child-data obligations under the DPDP Act and its rules. I did not verify current legal text; no compliance is claimed.
- **Erasure on request**: deliberately not built. Deleting a student's record conflicts with fee, audit and statutory retention duties; the rules must be decided with legal advice first. Export is built.

**Not built (designed but not yet implemented)**
- Classroom/room allocation; academic calendar that drives holidays; transport boarding/drop attendance; student documents after enrolment; transfer-certificate generation; staff performance reviews and onboarding checklist; GST/tax handling on fees (education is generally exempt; some items may not be; needs accounting advice); exam reminders; bank-statement reconciliation; student voice and career exploration; structured accessibility/learning-support plans; more Indian languages; multi-campus (single-school by design: needs a campus column across tables).

**Limits of the trial site on Vercel**
- Requests are limited to 4.5 MB there, below the app's 5 MB upload limit; uploaded files are not kept between visits; background jobs (reminders, message delivery) do not run: use the Docker setup on your real server.
- Migration 013 applies itself to the trial database the next time the app starts after deployment.

## E. Verification report

Run on 2 November 2026 against a local PostgreSQL; nothing tested against live SMS/WhatsApp/payment services.

| Check | Result |
|---|---|
| Server automated tests | 116 passed (92 existing + 24 new), 9 files |
| Type checks (server, web) | no errors |
| Every API route refuses an unauthenticated caller; staff routes refuse family accounts and vice versa; a low-privilege staff account sees nothing extra | passed, including every new route (automatic) |
| Every child-specific family route returns "not found" for another family's child | passed, including the new ones (automatic) |
| New workflows by test: pickups and gate, incidents, meetings (race and cancel), homework hand-in and marking, file type spoofing, lesson plans and materials, development records and support list, reports and their permissions, delivery (opt-in, mute, safety unmutable, signed request, dedupe, retry, failure, masking), grading scale change, late fees (off by default, once only), waiting list, export permission and audit, robots/sitemap | passed |
| Browser walkthrough with real sign-ins (administrator, teacher, parent): 27 checks per run, at desktop, tablet and phone sizes | all passed; no browser errors |
| Accessibility scan (WCAG A/AA/2.1 AA), 38 screens including all new ones | 0 violations after fixes (2 kinds found before) |
| Layout: no sideways overflow on 40+ phone-width screens | passed (earlier phase) |
| Database migration on an empty database and on the demo database | applied cleanly |
| Dependency audit | 0 known vulnerabilities |

Not verified: behaviour with a real email/SMS/WhatsApp provider; a backup restore; performance under load.

## F. Final feature matrix

| Area | Requirement | Status |
|---|---|---|
| **A. Administration** | School setup and settings | Done |
| | Multiple academic years / sessions | Done |
| | Classes, sections, grades, subjects, curriculum | Done |
| | School calendar | Partial (events and notices; no holiday-driven calendar) |
| | Timetable and substitutions | Done |
| | Classroom allocation | Missing |
| | Policies and announcements | Done |
| | Staff and departments | Done |
| | Multiple campuses | N/A (single school by design) |
| **B. Admissions** | Enquiry, online application, tracking | Done |
| | Follow-ups | Partial (notes and events; no reminders) |
| | Documents and verification | Done |
| | Approval, enrolment, class allocation | Done |
| | Waiting list | Done (new) |
| | Applicant communication | Partial (status notes shown; no automatic email) |
| | Onboarding, parent accounts | Done |
| **C. Students** | Profiles, guardians, history, promotion, leave | Done |
| | Emergency contacts | Done (new) |
| | Medical / accessibility information | Partial (restricted notes; no structured needs) |
| | Student documents | Missing |
| | Transfer / withdrawal | Partial (status and reason; no certificate) |
| | Activities and achievements | Done (new) |
| **D. Parents** | Attendance, results, progress, fees, receipts, notices | Done |
| | Homework, hand-in and marks | Done (new) |
| | Teacher feedback and shared observations | Done |
| | Book parent-teacher meetings | Done (new) |
| | Leave, concerns, messaging, several children | Done |
| | Exam schedule before results | Partial |
| | Transport (route, stop, driver) | Done; live tracking N/A |
| **E. Teachers** | Classes, attendance, marks, homework, timetable | Done |
| | Lesson plans, learning materials | Done (new) |
| | Identify students needing support | Done (new) |
| | Create own assessments | Partial (marks entry yes; exam set-up by school staff) |
| **F. Academics** | Exams, marks, rankings, report cards, analytics | Done |
| | Configurable grading | Done (new) |
| | Promotion and retention | Done |
| | Learning-gap analysis by topic | Partial |
| **G. Development** | Activities, observations, portfolio timeline | Done (new); file portfolios Missing |
| | Student voice, career exploration, support plans | Missing |
| **H. Safety** | Attendance alerts | Done |
| | Late / early / pickup records, authorised pickups | Done (new) |
| | Incident, bullying and harassment reporting | Done (new) |
| | Confidential complaints | Done |
| | Emergency broadcast | Missing |
| | Escalation workflow | Partial (assignment, status; no timers) |
| **I. Fees** | Structure, installments, concessions, receipts, refunds, reports, reminders | Done |
| | Late fees | Done (new) |
| | Payment gateway | Needs provider |
| | Tax handling | Missing |
| | Bank reconciliation | Partial |
| **J. Staff / HR** | Profiles, attendance, leave, payroll, documents | Done |
| | Onboarding checklist, performance records | Missing |
| **K. Transport** | Routes, stops, vehicles, drivers, allocation, utilisation | Done |
| | Boarding / drop attendance | Missing |
| | GPS tracking | N/A (needs infrastructure) |
| **L. Communication** | Notices, messages, in-app notifications | Done |
| | Email / SMS / WhatsApp | Needs provider (built, tested against a test relay only) |
| | Preferences, delivery status, de-duplication | Done (new) |
| | Exam reminders | Missing |
| **M. Reports** | Attendance, academic, fees, outstanding, progress | Done |
| | Workload, enrolment and retention, transport, safety | Done (new) |
| | Admissions funnel | Partial |
| **N. Website** | Public site, forms, gallery, policies | Done |
| | Search engine tags, sitemap, robots | Done (new) |
| **O. Accessibility** | Mobile layout, keyboard use, screen reader, contrast | Done (scan clean) |
| | Hindi / English | Partial (sign-in, public menu, parent portal; staff screens English) |
| | Low bandwidth | Partial (compressed images, split code; no offline mode) |
| **India** | Board and grading configuration | Done (new) |
| | INR, Indian dates, mobile number validation on new forms | Done / Partial (older forms not all validated) |
| | DPDP: consent on forms, notice versions, retention of enquiries, access export | Partial; erasure and consent register not built; legal review needed |
| **Security** | Authentication, sessions, roles, API authorisation, parent-child and teacher-class limits | Done (automatic tests) |
| | Uploads, input validation, injection, XSS, CSRF, rate limits, audit log | Done |
| | School-level tenant isolation | N/A (single school) |
| | Database-level access controls | Partial (one application role; no row-level security) |
| | Backup scripts, restore | Partial (scripts written; restore not practised here) |
| | Data deletion | Missing by design (needs legal decision) |
