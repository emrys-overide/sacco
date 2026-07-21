# Submission readiness checklist

Use this checklist before tomorrow's demonstration or assessment. It separates
the evidence already in the repository from the live checks that must be done
on the final deployed environment.

## Evidence in the repository

- [ ] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and confirm there are no accidental secrets or
  unfinished local changes.
- [ ] Read the role guide, security-readiness statement, free-tier operating
  model, Chairman recovery procedure, and user guide.

## Demonstration flow

- [ ] Create the first Chairman privately, then sign in and show the guided
  first-Chairman setup tour.
- [ ] Create a Secretary account and show the Roles & Responsibilities page.
- [ ] Register a member, create the member account, add a vehicle, and record
  a daily collection with its receipt.
- [ ] Submit a loan application, show the Secretary and Treasurer review
  stages, reject one with a written reason, and show the member reapplication
  option.
- [ ] Submit a member reset request and show that only the Chairman sees it.
- [ ] Submit a Chairman recovery request and show that only the Secretary sees
  it in **Chairman Recovery**. Verify identity, issue a temporary password,
  then show the forced password-change screen.
- [ ] Show the notification bell while online, Documentation & Help, and the
  restricted Developer Errors page (if configured).

## Deployment evidence

- [ ] `APP_URL`, `DATABASE_URL`, `DATABASE_SSL`, `JWT_SECRET`, and
  `MEMBER_OTP_PEPPER` are stored as Render secrets, never committed.
- [ ] All database migrations through `023` are applied; record the output of
  `npm run db:status`.
- [ ] Co-op Bank IPN remains disabled on the sleeping free Render service.
- [ ] Explain that a free Render service can take time to wake and that durable
  data and notifications remain in Supabase.
- [ ] State whether MFA is enabled. If enabled, set and protect
  `TOTP_ENCRYPTION_KEY`, then demonstrate an officer login with an authenticator
  code.
- [ ] Take or prepare screenshots of the sign-in page, onboarding tour, role
  guide, loan decision with reason, recovery screen, reports, and test results.

## Submission statement

Describe the system as a **secure, role-based SACCO management application
ready for a controlled pilot**. Do not claim it is a certified banking system,
an independently penetration-tested product, or suitable for live bank
callbacks on free sleeping hosting.
