# Azure Linux VM Deployment

The application runs as a normal Node.js server. Docker Compose provides the app, PostgreSQL, private upload storage, and Caddy HTTPS reverse proxy. There is no Cloudflare dependency in this deployment path.

## VM prerequisites

- Linux Azure VM supported by the official Node 24 and Docker images.
- Docker Engine and the Docker Compose plugin.
- A DNS name whose `A` record resolves to the VM's public IP.
- Azure NSG and host firewall allow inbound TCP ports 80 and 443. Restrict SSH to administrator networks.
- Sufficient VM disk for PostgreSQL and uploads, plus an off-VM backup destination.

The Compose stack publishes only Caddy ports 80/443. PostgreSQL and the Node app are on a private Docker network; do not add public port mappings for them.

## Configure and start

From the project directory on the VM:

```sh
cp .env.example .env
```

Generate two different secrets:

```sh
openssl rand -hex 32
openssl rand -hex 32
```

Set `.env` values:

```dotenv
SITE_HOST=applications.example.gov
POSTGRES_PASSWORD=first-generated-hex-value
APP_SESSION_SECRET=second-generated-hex-value
```

`POSTGRES_PASSWORD` is kept hexadecimal so it can safely be included in the Compose connection URL. Never commit `.env`, send it over chat, or reuse these secrets elsewhere.

Install Node.js 24 and pnpm 11.25.0 on the VM and create the admin login interactively:

```sh
corepack pnpm setup:admin
```

The script stores a salted scrypt password hash in `.env`. Never put the admin password into source control or paste it into chat.

Start the stack:

```sh
docker compose up --build -d
docker compose ps
docker compose logs -f app caddy
```

The app container waits for PostgreSQL, applies unapplied SQL migrations, then starts Vinext's production Node server. Caddy provisions and renews HTTPS certificates after DNS and port 80/443 are reachable. Browse to `https://SITE_HOST`. The private review dashboard is at `https://SITE_HOST/dashboard`. Check `https://SITE_HOST/api/health` for a database-backed health response.

Update the site after source changes:

```sh
docker compose up --build -d
docker compose logs --tail=100 app
```

## Local development

Set `DATABASE_URL`, `APP_SESSION_SECRET`, and `UPLOAD_DIR` in a local `.env` file, install Node 24 and pnpm 11.25.0, and create an admin account using `pnpm setup:admin`, then:

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

## Applicant and administrator access

Applicants do not sign in. A signed browser cookie links their draft and uploads to that browser. Submissions are immutable through the applicant API after submission.

The reviewer dashboard at `/dashboard` requires the configured administrator email and password. Admin sessions use an HTTP-only, SameSite=Strict cookie, expire after eight hours, and use Secure cookies in production. Passwords are stored as salted scrypt hashes. Five failed sign-in attempts from one network within 60 seconds trigger a 60-second lockout. A signed-in administrator can manually release an active lockout in the dashboard; the lockout list shows a pseudonymous network identifier, not the visitor's raw IP address. Dashboard APIs and private document downloads independently enforce the admin session; hiding the URL alone is not considered access control.

For an isolated private-network HTTP smoke test only, `APP_ALLOW_INSECURE_ADMIN_COOKIE=true` disables the Secure attribute on administrator and applicant session cookies. This sends session cookies and login traffic without transport encryption. Never enable this on a public or untrusted network; remove the setting and restart the app before exposing the site publicly.

Only staff who need access should be granted VM/Docker/DB access. These records contain personal data. Avoid copying application data into unsecured spreadsheets, logs, or chat.

## Backups and restore

Application submissions and uploads are two distinct data sets; back up both, encrypt backups, store them outside the VM, and test restoration. A database-only backup does not include applicant documents.

Create a PostgreSQL logical backup:

```sh
docker compose exec -T postgres pg_dump -U ai402 -d ai402 --format=custom > ai402-db-$(date +%F).dump
```

The upload directory is stored in the named volume `applicant_uploads`. Use the organization's approved Docker-volume backup method to copy that volume to protected off-VM storage. Do not remove volumes during routine updates. `docker compose down -v` deletes production data and must not be used.

Only staff who need access should be granted administrator credentials or VM/Docker/DB access. These records contain personal data. Avoid copying application data into unsecured spreadsheets, logs, or chat. Rotate the admin password with `pnpm setup:admin`; changing the password hash invalidates existing sessions.

The dashboard currently has a single administrator account. Enrollment status can be set to Enrolled or Not enrolled, with new submissions defaulting to Not enrolled; this does not change the applicant's submitted answers. Multiple staff roles and a broader admissions review/decision workflow are not implemented. Approve the privacy notice and staff access process before accepting real applications.

## Before accepting real applications

- Approve a privacy notice, purpose/consent wording, retention/deletion period, applicant support contact, and authorized staff list.
- Confirm backup encryption, access controls, recovery objectives, and restore testing.
- Confirm the VM, disk, and public DNS/TLS are monitored and patched.
- Test authenticated dashboard access and private document downloads using synthetic data.
- Build and security-test a protected reviewer workflow; avoid granting routine reviewers shell or Docker access.
- Decide a retention and cleanup policy for abandoned drafts and their uploads.
