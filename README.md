# Security Projects UK – BS 7858 Onboarding & Screening Portal

Online onboarding and security screening for security officers, built around **BS 7858:2019** (*Screening of individuals working in a secure environment*) and the company's existing paper pack.

## What it does

**Applicants (guards)** register, then complete nine guided sections on phone or desktop, saving as they go:

1. Understanding the process + Letter of Authority (e-signature)
2. Application for employment: personal details, address history, education, a **continuous 5-year activity history with live gap detection**, references, declaration
3. ID verification: SIA licence, passport, NI, two proofs of address, DBS, right-to-work share code, with photo/PDF uploads for each
4. Declaration form (court orders / CCJs, three signed declarations)
5. Diversity monitoring (confidential; every question has "Prefer not to say")
6. Health screening questionnaire
7. 48-hour working-week opt-out
8. HMRC starter checklist or P45 upload
9. Bank details (pre-employment checklist)

**Screening staff** (super admin and screening officers):

- A dashboard with the 12-week completion deadline for each applicant, SIA expiry alerts and recent activity
- An applicant record with tabs for the full forms, a document gallery, screening checks, history & references, employer sections, authorisation, reports and the audit trail
- A screening check for each item (identity, address, right to work, SIA, UK sanctions, DBS, credit, 5-year history, references, interview), with links to the official services, a pass/fail/refer result, a reference and uploaded evidence:
  - UK Sanctions List (FCDO): https://search-uk-sanctions-list.service.gov.uk/
  - SIA Register of Licence Holders: https://services.sia.homeoffice.gov.uk/rolh
  - Right to work share code: https://www.gov.uk/view-right-to-work
  - DBS Update Service: https://www.gov.uk/dbs-update-service
- **Email requests to verify history and references.** Each employer or referee gets a secure link to a short online form. The app tracks letter codes (WR/ER/AR/DR/CL…), sent and chased dates, and confirmed dates.
- A documents register (copy / original / N/A), employer health comments, countersignature of the 48-hour opt-out, and a bank-details "checked by" record
- Authorisation of a Conditional, Confirmed or Declined decision, with signature and start date
- **A PDF screening file** that mirrors the company's BS 7858 screening record. It includes the cover page, verification log, checks, authorisation, all nine forms with e-signatures (with time and IP), ID images and the audit trail. A snapshot is saved automatically on submission and on every decision.
- **Contracts of employment.** Once documents are checked, staff open the officer's Contract tab. Name, reference and date are filled in automatically; staff confirm the position and rate, preview the PDF and send it. The officer signs on their phone or computer, and the signed PDF is emailed to both the officer and recruitment.
- **Settings** (super admin):
  - the contract wording (editable template with automatic fields) and its default values
  - the employer's signature
  - the reference request, verification and contract emails
  - an option to send reference requests automatically when an officer submits
  - a test email button
- An email outbox (with "Send now" for anything queued), staff user management, the audit log, and aggregated diversity statistics

**Email (Google Workspace):** set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=recruitment@securityprojectsltd.co.uk`, `SMTP_FROM` and `SMTP_PASS`. `SMTP_PASS` is a Google App Password for that mailbox, which requires 2-Step Verification. Until `SMTP_PASS` is set, emails are kept in the Outbox.

**Security**
- All form data and uploaded files are encrypted at rest (AES-256-GCM)
- Passwords are hashed with bcrypt, with CSRF protection, rate-limited login, secure session cookies and strict security headers
- File uploads are checked by content, not just by file extension
- Every view, change and decision is written to the audit log

## Run locally

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`, so no database server is needed).

```bash
npm install
npm start
```

Open http://localhost:3000.

- Super admin: `admin@securityprojects.uk` / `ChangeMe!2026` (override with `ADMIN_EMAIL` / `ADMIN_PASSWORD`)
- Applicants register at `/register`
- If SMTP is not configured, emails are not sent. They are saved in **Admin → Outbox**, where you can read them or send them by hand.

Data is stored in `./data` (database, encrypted uploads, report snapshots, and an auto-generated local encryption key).

## Deploy to Railway

1. Push this repository to GitHub, then in Railway choose **New Project → Deploy from GitHub repo**.
2. Add a **Volume** to the service mounted at `/data`.
3. Set the variables from `.env.example`. At minimum set `NODE_ENV=production`, `DATA_DIR=/data`, `APP_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD` and the `SMTP_*` settings.
4. Deploy. The health check is at `/healthz`.

> **Keep `ENCRYPTION_KEY` safe and never change it.** Without it the stored applications and documents cannot be decrypted. Back up the `/data` volume regularly.

## Configuration

Company details (address, offices, registration number, accreditations) are in `src/config.js`. The nine sections are defined declaratively in `src/schema.js`. Adding or changing a question there updates the form, the validation, the admin view and the PDF together.

## Project layout

```
src/
  server.js        Express app & security middleware
  config.js        Environment, company details, BS 7858 parameters, official check links
  schema.js        The nine onboarding sections (fields, rules, validation)
  timeline.js      5-year history coverage / gap analysis
  apps.js          Application, checks and verification domain logic
  report.js        PDF screening file generator
  routes/          auth, applicant, admin, referee
views/             EJS templates
public/            CSS, client JS (signature pad, uploads, live timeline), images
```
