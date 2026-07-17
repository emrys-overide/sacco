# No-cost Firebase static preview and GitHub deployment

## What this preview does

`firebase.static-preview.json` deploys only `dist/client` to Firebase Hosting.
It contains no Functions, Firestore, secrets, or `/api/**` backend rewrite. The
single-page app works for visual review and client-side navigation; API requests
receive a Hosting 404 and the UI explains that sign-in and data are unavailable.

This is safe to run on Firebase Spark. It is not an end-to-end SACCO deployment:
member login, account creation, dashboards, payments, and Co-op Bank callbacks
need the Express Function and PostgreSQL, which require the Blaze deployment
path.

## Local build and preview deployment

Build the static preview:

```bash
npm run firebase:prepare:static-preview
```

After authenticating the Firebase CLI and selecting a Spark Firebase project,
create a seven-day preview URL:

```bash
DEBUG= npx firebase-tools@15.24.0 --config firebase.static-preview.json \
  hosting:channel:deploy static-preview --expires 7d --project PROJECT_ID
```

This command intentionally does not deploy Functions, rules, indexes, or
secrets. The existing `firebase.json` remains the production Firebase
Hosting/Functions configuration and must not be used for this no-cost test.

## Keyless GitHub deployment

The workflow `.github/workflows/firebase-static-preview.yml` runs on `main` and
on manual dispatch. It builds the static preview and deploys it to the same
seven-day Hosting channel.

It uses GitHub OIDC and Google Workload Identity Federation (WIF), not
`firebase init hosting:github`. Firebase's built-in GitHub setup stores a
service-account JSON key as a GitHub secret; do not use that approach here.

Create a GitHub Environment named `firebase-static-preview`, then add these
Environment variables (not secrets):

- `FIREBASE_PROJECT_ID`
- `GCP_WIF_PROVIDER` — full WIF provider resource name
- `FIREBASE_DEPLOYER_SERVICE_ACCOUNT` — the service-account email used only for
  Hosting deployment

In Google Cloud IAM, create a WIF pool/provider for GitHub OIDC and restrict it
to this repository's numeric identity:

- GitHub repository ID: `1294630849`
- GitHub owner ID: `80041441`

Restrict production deployment to the `main` branch. Grant the deployer only
`roles/firebasehosting.admin`, then grant the federated GitHub principal
`roles/iam.workloadIdentityUser` on that deployer account. Do not create a
service-account key.

After the WIF configuration is complete, push this workflow to `main`. Every
future `main` push will publish the static preview automatically and expose its
URL in the GitHub Actions log.

## Required human-boundary step

The local Firebase CLI currently has no authenticated Google account, and the
Google Cloud project has no configured WIF provider. Only a project owner can
authorize one of these external identities or enable billing. No password,
private key, Firebase token, or database URL is required in this repository.
