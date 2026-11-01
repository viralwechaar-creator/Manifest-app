# School Website & Management Platform

One school, one system: public website, staff/parent/student portals and school operations on a single secure platform.

**Status: Phases 1 and 2 complete** (foundation + public website with admin-editable content). See `docs/ARCHITECTURE.md` for the roadmap.

## Stack
React + TypeScript + Vite (web) · Node + Express + TypeScript (server) · PostgreSQL · `motion` for animation.

## Run locally
Requires Node 20+ and PostgreSQL 14+.

```bash
npm install
createdb school            # or: create a database and user of your choice
cp server/.env.example server/.env   # then edit DATABASE_URL and APP_SECRET
npm run migrate
ADMIN_LOGIN=you@school.org ADMIN_NAME="Your Name" ADMIN_PASSWORD='a-long-password-1' npm run create-admin
npm run dev:server         # API on :4000
npm run dev:web            # website on :5173 (proxies /api)
```
Sign in at `/login`, then fill in **Site settings** and the content sections.

## Production
```bash
npm run build              # builds web/dist and server/dist
NODE_ENV=production npm start
```
The server serves the built website and API on one port. See `docs/DEPLOYMENT.md`.

## Tests
`createdb school_test` (owner `school`), then `npm test`. Covers login, lockout, CSRF, role permissions, public data exposure, consent capture and upload validation.
