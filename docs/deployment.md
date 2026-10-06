# How to deploy this for $0/month

Four free services, each doing one job:

| Service | Job | Free tier (checked Oct 2026) |
|---|---|---|
| **GitHub** | Code; **Actions** runs the log sync every 30 min | Public repos: unlimited Actions minutes |
| **Supabase** | PostgreSQL database | 500 MB database, 2 projects; pauses after 7 days with no queries |
| **Cloudflare Workers** | Hosts the website (static files) + the `/api` Worker | 100k Worker requests/day, 10 ms CPU per request, 3 MiB Worker; static files free and unlimited |
| **Cloudflare Hyperdrive** | Connection pooling from the Worker to Supabase | 100k queries/day on the free plan |
| **WiseHosting** | Your Minecraft server (already paid for); we only read its logs over SFTP | — |

> **Order matters.** Do the steps top to bottom. Each one says what to save for later.

---

## 1. GitHub repository

1. Make the repository **public**: Settings → General → Danger zone → Change visibility.
   Public repos get unlimited Actions minutes. Private repos get 2,000 min/month,
   which is too little for a sync every 30 minutes.
2. Nothing secret is ever committed. Real logs (`samples/`, `logs/`) and `.env*`
   files are gitignored.

## 2. Supabase project

1. Sign in at <https://supabase.com> → **New project**.
   - Name: e.g. `smp-analytics`. Region: **East US** (closest to you).
   - Set a **database password** and save it in a password manager. You'll need it below.
   - Plan: **Free**.
2. Once it's ready, click **Connect** (top bar) and copy two connection strings:
   - **Session pooler**: `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`.
     This becomes **`DATABASE_URL`** for GitHub Actions. GitHub's runners only speak
     IPv4, which the session pooler supports.
   - **Direct connection**: `postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres`.
     You'll adapt it for Hyperdrive in step 6.

**What Supabase is:** a hosted PostgreSQL database with extras (auth, storage, a REST
API) that we don't use. We only use the database itself. Our tables live in a schema
called `smp`, which Supabase's auto-generated REST API doesn't expose.

## 3. Create the database tables

From your machine, in the repo:

```bash
npm install
# PowerShell: $env:DATABASE_URL="<session pooler string>"; npm run db:migrate
DATABASE_URL="<session pooler string>" npm run db:migrate
```

You should see `Applying migration 0001_initial_schema…`. Running it again prints
"Nothing to apply". Each sync also runs migrations automatically, so new migrations
apply themselves after you pull an update.

Then give the read-only API role a password. In Supabase, open **SQL Editor** and run:

```sql
alter role smp_reader with login password 'choose-a-long-random-password';
```

Save that password too.

## 4. WiseHosting SFTP credentials

**What SFTP is:** file transfer over SSH, encrypted with a username and password.
WiseHosting runs an SFTP server for your Minecraft server, so the sync can download
log files exactly like an FTP client would. It only lists and downloads; it never
writes.

In the WiseHosting panel, open your server's **SFTP / File access** details and note:

| Value | Becomes |
|---|---|
| Host / address | `SFTP_HOST` |
| Port | `SFTP_PORT` |
| Username (often `something.serverid`) | `SFTP_USERNAME` |
| Password (usually your panel password) | `SFTP_PASSWORD` |

The logs folder is normally `logs` at the SFTP root, next to `server.properties`.
If it's somewhere else, set `SFTP_LOG_DIR`.

**Test it locally** before touching GitHub. Create `.env.local` in the repo root
(it's gitignored):

```ini
DATABASE_URL=<session pooler string>
SFTP_HOST=...
SFTP_PORT=...
SFTP_USERNAME=...
SFTP_PASSWORD=...
```

Then run the **first historical import**:

```bash
npm run import:logs
```

Expected output: `Found N log file(s) including latest.log`, one line per file, then
`Rebuilt … session(s) for … player(s)` and `Sync complete`. If it fails to connect,
see Troubleshooting in the README.

## 5. GitHub Actions secrets

**What GitHub Actions is:** GitHub starts a fresh Linux machine on a schedule, checks
out this repo, runs `npm run sync`, and throws the machine away. Credentials reach it
as encrypted **secrets**, which never appear in the code and are masked in logs.

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `DATABASE_URL` | Supabase **session pooler** string (with password) |
| `SFTP_HOST` | From step 4 |
| `SFTP_PORT` | From step 4 |
| `SFTP_USERNAME` | From step 4 |
| `SFTP_PASSWORD` | From step 4 |
| `CLOUDFLARE_API_TOKEN` | From step 6 |
| `CLOUDFLARE_ACCOUNT_ID` | From step 6 |

Optional **variables** (same page, *Variables* tab). The defaults are already right
for you:

| Variable | Default |
|---|---|
| `SFTP_LOG_DIR` | `logs` |
| `SERVER_LOG_TIMEZONE` | `UTC` |
| `STATS_TIMEZONE` | `America/New_York` |

Then go to **Actions → Sync server logs → Run workflow** to start the first automated
sync. After that it runs every 30 minutes.

## 6. Cloudflare (website + API)

**What Cloudflare Workers is:** code that runs on Cloudflare's servers worldwide. Our
Worker does two jobs:
- It serves the static website files (HTML, JS, CSS) built by Next.js.
- It answers `/api/*` requests by querying Supabase.

**Hyperdrive** sits between the Worker and Supabase. It keeps database connections
warm and caches identical queries.

1. Create a free account at <https://dash.cloudflare.com>.
2. In the repo, log wrangler (Cloudflare's CLI) into your account:
   ```bash
   cd apps/api
   npx wrangler login
   ```
3. Create the Hyperdrive config. Use the **direct** connection string from step 2,
   but connect as the read-only role:
   ```bash
   npx wrangler hyperdrive create smp-db --connection-string="postgresql://smp_reader:<reader password>@db.<ref>.supabase.co:5432/postgres"
   ```
   If that fails to connect, use the session pooler host instead, with user
   `smp_reader.<ref>`.
   Copy the printed **id** into `apps/api/wrangler.jsonc` in place of
   `REPLACE_WITH_HYPERDRIVE_ID`, and commit it. The id is not a secret.
4. Create an **API token**: My Profile → API Tokens → Create token → template
   **"Edit Cloudflare Workers"** → Create. Save it as the GitHub secret
   `CLOUDFLARE_API_TOKEN`.
5. Copy your **Account ID** (Workers & Pages overview, right sidebar) into the GitHub
   secret `CLOUDFLARE_ACCOUNT_ID`.
6. Push to `main`, or run **Actions → Deploy → Run workflow**. The workflow builds the
   site and runs `wrangler deploy`. The site appears at
   `https://smp-analytics.<your-subdomain>.workers.dev`.
   - Want a nicer name? Rename `"name"` in `wrangler.jsonc`.
   - Already have a domain on Cloudflare? Add a custom domain to the Worker in the dashboard.

### Reliable 30-minute syncs (Cloudflare → GitHub)

GitHub's own `schedule:` trigger is best-effort and often skips runs, so the
Worker starts the sync instead. A Cloudflare **Cron Trigger** (free: 5 per
account) fires every 30 minutes and calls GitHub's `workflow_dispatch` API.
GitHub's schedule stays as an hourly backup.

1. GitHub → your profile → **Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories** → this repo.
   - Permissions → Repository permissions → **Actions: Read and write**.
   - Expiration: up to a year. Set a reminder to renew it.
2. Store it in the Worker (you'll be prompted to paste it; it's never committed):
   ```bash
   cd apps/api
   npx wrangler secret put GITHUB_DISPATCH_TOKEN
   ```
3. Check it: Cloudflare dashboard → Workers & Pages → smp-analytics → **Logs**
   should show "Triggered GitHub log sync" every 30 minutes, and GitHub →
   Actions should show *workflow_dispatch* runs at :00 and :30.

## 7. Verify everything works

| Check | Expected |
|---|---|
| `https://<site>/api/meta` | JSON with `lastSuccessfulSyncAt` within the last ~30 min |
| `https://<site>/` | Timeline with your players |
| Actions → Sync server logs | Green runs every ~30 min, each ending with `Sync complete` |
| Supabase → Table editor → schema `smp` → `sync_runs` | One `success` row per run |
| Supabase → `smp.parse_issues` | Ideally empty. Rows here usually mean a new death message to add |

## Free-tier limits to know about

- **GitHub schedules are best-effort** and skip runs when GitHub is busy, which is why
  the Worker's Cron Trigger starts the sync instead (see "Reliable 30-minute syncs").
  The GitHub token it uses expires; renew it when GitHub emails you.
- **Public repos: schedules are disabled after 60 days with no repository activity.**
  GitHub emails you first. The sync workflow re-enables itself monthly to reduce this,
  but if it ever stops: Actions → Sync server logs → **Enable workflow**.
- **Supabase pauses projects after 7 days without queries.** The 30-minute sync
  prevents this. If syncing breaks for a week, the project pauses; restore it with
  one click in the dashboard (no data is lost).
- **Workers: 100k requests/day.** Only `/api/*` calls count; static files are free.
  A handful of friends will use well under 1%.
- **Workers: 10 ms CPU per request.** Statistics are precomputed during sync, so API
  requests are simple lookups. The current Worker bundle is about 42 KiB (limit 3 MiB).
- **Supabase: 500 MB.** A busy year of logs for a small group is a few MB.

Nothing here requires a credit card.
