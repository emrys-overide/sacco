# Co-operative Bank hosting plan

Run the Express application and PostgreSQL on an always-on host with a stable HTTPS URL, deployment secrets, persistent logs, backups, and monitoring. Do not use a frontend-only host or a service that sleeps through bank callbacks.

The callback is `https://your-domain.example/api/integrations/coop/ipn`. Apply migrations through `010`, keep `COOP_OBSERVE_ONLY=true` and `COOP_AUTO_POSTING_ENABLED=false`, then follow the controlled onboarding and activation checklist in [docs/integrations/cooperative-bank-ipn.md](docs/integrations/cooperative-bank-ipn.md).

Do not deploy, change DNS or billing, or send the URL/credentials to Co-operative Bank without explicit SACCO authorization.
