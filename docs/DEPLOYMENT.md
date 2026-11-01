# Deployment guide

The simplest way to run the school system is **one small Linux server** (2 CPU / 4 GB RAM is plenty for one school) running Docker. This starts three things together: the app, its PostgreSQL database, and a front door (Caddy) that gets and renews the HTTPS certificate by itself.

## What you need
1. A Linux server with **Docker** and the **Docker Compose** plugin installed (any VPS provider works).
2. A domain name (e.g. `school.example.org`) with its **DNS "A" record pointing at the server's IP address**. Ports 80 and 443 must be open.
3. A copy of this project on the server (`git clone`).

## First-time setup
```bash
cp deploy/.env.example .env      # then edit .env and fill in all three values
docker compose up -d --build     # builds and starts everything (first run takes a few minutes)
docker compose run --rm app node dist/scripts/create-admin.js    # creates the first administrator
```
Open `https://your-domain` — the website should load with a padlock. Sign in at `/login`, then immediately:
- turn on **two-step verification** (My account),
- fill in **Site settings** (school name, logo, address, phone, hero photo).

The database structure is created and updated automatically every time the app starts.

### The three values in `.env`
| Value | What it is | How to make one |
|---|---|---|
| `DOMAIN` | your website address, without `https://` | e.g. `school.example.org` |
| `DB_PASSWORD` | password for the database | `openssl rand -hex 24` |
| `APP_SECRET` | protects two-step-verification secrets | `openssl rand -hex 32` |

Keep `.env` private and **keep a copy of it somewhere safe** (a password manager). Losing `APP_SECRET` means staff must set up two-step verification again.

## Updating to a new version
```bash
git pull
docker compose up -d --build
```
Take a backup first (below). Visitors may see a few seconds of interruption.

## Backups (do this before launch, not after)
- `./scripts/backup.sh` saves the database and all uploaded files into `./backups` and keeps the newest 14.
- Run it every night: `crontab -e`, then add  
  `0 2 * * * cd /path/to/project && ./scripts/backup.sh >> backups/backup.log 2>&1`
- **A backup on the same server is not enough.** Set `BACKUP_COPY_TO` (any rsync destination) to copy each backup to another machine, or use your provider's server snapshots as well.
- **Practise a restore** on a spare server with `./scripts/restore.sh backups/db-<date>.dump`. A backup you have never restored is only a hope.

## Monitoring
- **Uptime:** point a free monitor (UptimeRobot, Better Stack, etc.) at `https://your-domain/api/ready` — it answers only when the app *and* the database are working. Alert to the principal's / IT person's phone.
- **Logs:** `docker compose logs -f app`. Logs are JSON, one line per request or event; personal-data fields are removed. Crashes and unexpected errors are logged at level `50`/`60` (`error`/`fatal`) — set your log service to alert on those. Containers restart automatically after a crash.
- **Disk space:** watch free space (uploads and backups grow). 
- **Security updates:** run `apt upgrade` on the server monthly and rebuild the app (`docker compose up -d --build`) to pick up new base images.

## Settings reference (advanced)
Set in `docker-compose.yml` under `app → environment` if you need to change them:
`SESSION_TTL_HOURS` (default 12), `SESSION_IDLE_MINUTES` (120), `LOGIN_RATE_LIMIT` (30 sign-in attempts per 15 min per IP), `API_RATE_LIMIT` (300 requests/min per IP).

## Without Docker
Node 22 + PostgreSQL 14+ + your own HTTPS proxy: set `NODE_ENV=production`, `PORT`, `DATABASE_URL`, `APP_SECRET`, `PUBLIC_ORIGIN` (must be `https://…`), `STORAGE_DIR` (a persistent disk), then `npm ci && npm run build && npm start`. The app trusts one proxy hop. In production it refuses to start with an `http://` address or a missing secret.

## Online trial on Vercel (temporary)
The repository also runs on Vercel for trials: `api/index.ts` is the entry point and `vercel.json` the routing. Settings needed: `DATABASE_URL` (Supabase pooler address, session mode), `APP_SECRET`, `PUBLIC_ORIGIN`, `STORAGE_DIR=/tmp/storage`, `DB_POOL_MAX=2`. Limits of the trial: uploaded files are not kept between visits and the daily reminder jobs do not run. Use the Docker setup above for the real server.
