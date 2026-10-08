# AI 402 Application Website

Applicant form for the AI 402 Advanced Technical Track. The production setup is a Node.js application on an Azure Linux VM, with PostgreSQL for application data and private VM-backed storage for uploaded documents.

## Quick start on the Azure Linux VM

Prerequisites: a Linux VM with Docker Engine and the Docker Compose plugin, a DNS name pointing to the VM's public IP, and Azure networking rules allowing inbound TCP 80 and 443.

1. Copy this project to the VM.
2. From the project directory, prepare secrets and the domain:

   ```sh
   cp .env.example .env
   openssl rand -hex 32
   ```

   Put one generated value in `POSTGRES_PASSWORD`, generate a second value for `APP_SESSION_SECRET`, and set `SITE_HOST` to the DNS name pointing at this VM. Keep `.env` private and do not commit it.
3. Install Node.js 24 and pnpm 11.25.0 on the VM. From the project directory, run `corepack pnpm setup:admin` and follow the prompts to create the administrator account. The password is stored as a salted scrypt hash in `.env`, not as plain text.
4. Start the application:

   ```sh
   docker compose up --build -d
   docker compose ps
   docker compose logs -f app caddy
   ```

   Caddy automatically obtains and renews HTTPS certificates. The app runs migrations when it starts. Open `https://YOUR-DOMAIN`.

See [START-HERE.md](./START-HERE.md) for local development, and [DEPLOYMENT.md](./DEPLOYMENT.md) for VM setup, backups, operations, and current deployment limitations.

## Private administrator dashboard

Open `/dashboard` directly and sign in with the account configured by `pnpm setup:admin`. The dashboard lists submitted applications, supports search and pagination, and provides authenticated downloads for uploaded nomination letters. Admins can export an individual application or all submitted applications to CSV, optionally filtered by submission dates. CSV files contain personal data; store and share them only through approved protected channels. Admins can mark each application **Enrolled** (green) or **Not enrolled** (red); new submissions default to **Not enrolled**. Admins can permanently delete an individual submission and its uploaded documents after confirming the action. Five failed sign-in attempts from the same network within one minute trigger a one-minute lockout. A signed-in administrator can manually release active lockouts from the dashboard. There is no dashboard link on the public application page, but the URL is not a security boundary: the dashboard API independently verifies the signed, HTTP-only, eight-hour admin session.

Do not accept real applications until the site is deployed over HTTPS, the production secrets and administrator credentials are unique and private, and the privacy, retention, and staff-access processes are approved.

## Applicant access and data

Applicants do not create accounts. The site assigns each browser a signed, HTTP-only session cookie so that drafts and uploaded files can be associated with that browser. Applicants can resume from the same browser while the cookie remains valid; clearing browser cookies or changing devices loses access to an unsubmitted draft. This is not an applicant identity check. Submitted applications are read-only; applicants cannot edit them after submission. After submission, applicants can print their confirmation or start a new application, which creates a fresh browser session without changing the previous submission.

Application details are stored in PostgreSQL. Uploaded documents are kept as private files in a Docker volume and are only served through owner-checked applicant routes or the authenticated admin download route. The database and upload volume are not published to the internet.

## Launch checklist

- Set DNS and Azure network rules, use a strong unique database password and session secret, configure the admin account, and verify HTTPS.
- Restrict SSH and administrative access to the VM; do not expose PostgreSQL or the app's internal port directly.
- Configure and test off-VM backups for both PostgreSQL and the applicant-upload volume.
- Approve the applicant privacy notice, retention period, support contact, and who can access records before accepting real submissions.
- Test the staff dashboard and application/document access using synthetic data before relying on online submissions for admissions operations.

## Project commands

- `pnpm install --frozen-lockfile`: install dependencies
- `pnpm setup:admin`: create or reset the administrator email and password interactively; stores a salted password hash in `.env`
- `docker compose -f docker-compose.dev.yml up -d`: start a private local PostgreSQL database
- `pnpm db:migrate` then `pnpm dev`: initialize the database and run the local development server
- `pnpm build`: production build
- `pnpm db:migrate`: apply pending PostgreSQL migrations
- `pnpm start`: migrate and start the production Node server
- Visit `/dashboard` and sign in to review submitted applications
- `docker compose up --build -d`: deploy the application, PostgreSQL, and HTTPS reverse proxy together
