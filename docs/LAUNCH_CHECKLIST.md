# Go-live checklist

Tick every line before announcing the site to parents. Items marked **(owner)** need a decision or content from the school.

## Content and legal
- [ ] **(owner)** Real school name, logo, address, phone, email, hero photo in *Site settings*
- [ ] **(owner)** Pages reviewed and edited: About, Principal's message, Admissions, Fees, Contact, etc.
- [ ] **(owner)** Privacy notice and consent wording **reviewed by a legal adviser** (DPDP Act 2023)
- [ ] **(owner)** Retention period for enquiries and applications decided (*Site settings → Privacy*)
- [ ] **(owner)** Student-ID format confirmed (default `YYYY-NNNN`) **before** the first student is registered — it cannot be changed for existing students
- [ ] **(owner)** Fee heads, fee structure per class, concessions, bank/UPI details for offline payment set up
- [ ] **(owner)** Academic year, classes, sections, subjects, periods and timetable entered

## Accounts and access
- [ ] Demo data is **not** loaded (never run `seed:demo` on the live database)
- [ ] First administrator created; two-step verification **on** for every administrator, principal and accounts user
- [ ] Each staff member has their own login with the correct role (no shared logins)
- [ ] Temporary passwords were handed out privately; everyone changed theirs at first sign-in
- [ ] Test parent login with a real student ID; confirmed they see **only** their own child(ren)

## Server
- [ ] `https://your-domain` shows a padlock; `http://` redirects to `https://`; `www.` redirects to the main address
- [ ] `.env` is private and a copy is stored safely; `APP_SECRET` backed up
- [ ] Uptime monitor on `/api/ready` alerting a real phone
- [ ] Nightly backup running **and an off-server copy exists**
- [ ] **A restore has been practised** successfully
- [ ] Firewall allows only ports 22 (ideally key-only), 80, 443; database port is **not** public
- [ ] Server clock/time zone correct (reports and receipts use dates)

## Final checks
- [ ] Phone check: open the site, the menu, sign-in and a parent screen on a real phone
- [ ] Submit a test enquiry and a test application; confirm staff can see them (then delete the test records)
- [ ] Record a test payment and receipt; confirm numbering starts correctly (then reverse/delete per school policy)
- [ ] Decide who is on call for problems in the first two weeks

## Not included yet (planned, needs provider accounts)
SMS / WhatsApp / email delivery, and an online payment gateway. Until then, notices appear in the portals and bell; parents pay at the counter or by transfer and submit a payment claim for staff to verify.
