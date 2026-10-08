# AI 402 Application Website — Start Here

This project is prepared to run on an Azure Linux VM using Docker Compose. It does not require Cloudflare or Google services.

## Run locally on Windows

Use Node.js 24 or newer and pnpm 11.25.0. PostgreSQL must be running locally or in Docker. From PowerShell in this project folder:

```powershell
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

Start the local PostgreSQL container (Docker Desktop must be running):

```powershell
docker compose -f docker-compose.dev.yml up -d
```

Edit `.env` and set a local PostgreSQL `DATABASE_URL`, an `APP_SESSION_SECRET` with at least 32 characters, and a local `UPLOAD_DIR`. For example:

```text
DATABASE_URL=postgresql://ai402:localpassword@localhost:5432/ai402
APP_SESSION_SECRET=local-development-secret-at-least-32-characters
UPLOAD_DIR=./data/uploads
```

Set up your private admin account. The password is entered without being displayed and saved only as a salted hash in `.env`:

```powershell
pnpm setup:admin
```

Create the local `ai402` database, then:

```powershell
pnpm db:migrate
pnpm dev
```

Open `http://localhost:5173`. The public applicant flow does not require sign-in. Uploaded files and application data use the configured local PostgreSQL and upload directory.

## Deploy on an Azure Linux VM

The simplest deployment is Docker Compose:

1. Provision a Linux VM and install Docker Engine plus the Docker Compose plugin.
2. Configure a DNS `A` record for the intended site name to point to the VM's public IP.
3. Allow inbound TCP 80 and 443 in the Azure NSG and host firewall. Restrict SSH to approved administrator IPs. Do not expose port 3000 or PostgreSQL port 5432.
4. Copy the project to the VM, copy `.env.example` to `.env`, generate two different secrets with `openssl rand -hex 32`, and set `SITE_HOST`, `POSTGRES_PASSWORD`, and `APP_SESSION_SECRET` in `.env`.
5. Install Node.js 24 and pnpm 11.25.0, then run `pnpm setup:admin` and follow the prompts to set the private administrator login. Never share the password or commit `.env`.
6. Run:

   ```sh
   docker compose up --build -d
   docker compose ps
   docker compose logs -f app caddy
   ```

   Caddy obtains and renews HTTPS certificates. The app waits for PostgreSQL, applies database migrations, and starts the Node server. Visit `https://SITE_HOST`; open `https://SITE_HOST/dashboard` for the private admin login.

Full operating details and backup commands are in [DEPLOYMENT.md](./DEPLOYMENT.md).

## How applicant access works

Applicants open the public site and fill it in without making an account. A signed, HTTP-only browser cookie links their drafts and uploads to that browser. The cookie lasts 30 days; drafts cannot be recovered after the cookie is cleared or from another browser/device. This does not verify the applicant's identity.

After submitting, applicants can print their confirmation or select **Start a new application**. This creates a new browser session for the next applicant while preserving the submitted application.

## Where submissions are stored

- PostgreSQL stores the application fields, status, reference number, and timestamps.
- The private `applicant_uploads` Docker volume stores the uploaded nomination documents.
- The private reviewer dashboard is at `/dashboard`; it requires the configured admin account. Applicants cannot edit a submission after it is submitted.

Do not accept live applications until the organization's privacy/retention terms, staff access process, backups, and support contact are approved.
