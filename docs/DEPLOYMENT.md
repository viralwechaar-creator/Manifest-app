# Deployment

1. **Server**: any Linux VM or container host with Node 20+ and a managed PostgreSQL 14+ (with automated daily backups and point-in-time recovery enabled).
2. **Environment** (set as real environment variables / secret store, never committed):
   - `NODE_ENV=production`, `PORT`
   - `DATABASE_URL` (use TLS: `?sslmode=require` if the provider requires it)
   - `APP_SECRET` – 64 hex chars (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Encrypts MFA secrets; losing it forces MFA re-enrolment.
   - `PUBLIC_ORIGIN` – the public https URL, e.g. `https://school.example.org`
   - `STORAGE_DIR` – persistent disk (or mounted volume) for uploads; **back it up**.
3. **HTTPS**: terminate TLS at a reverse proxy (Caddy/nginx/cloud load balancer) forwarding to the Node port. Cookies are `Secure` automatically in production; the app trusts one proxy hop (`trust proxy = 1`).
4. `npm ci && npm run build && npm start` (migrations run automatically on start; they can also be run with `npm run migrate`).
5. First admin: `ADMIN_LOGIN=… ADMIN_NAME=… ADMIN_PASSWORD=… npm run create-admin`.
6. **Backups**: database snapshots + `STORAGE_DIR`. Test a restore before launch.
7. **Monitoring**: logs are JSON on stdout (personal data fields redacted); ship to your log service. `GET /api/health` for uptime checks. Error tracking (e.g. Sentry) will be added in Phase 10.

## Before going live (owner actions)
- Replace the privacy notice text in *Site settings → Privacy* with wording reviewed by a legal adviser for DPDP Act 2023 obligations.
- Turn on two-step verification for all admin accounts (*My account*).
- Decide the retention period for enquiries (Site settings → Privacy).
