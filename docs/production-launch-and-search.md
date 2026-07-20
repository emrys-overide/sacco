# Sowetamu Sacco production launch and search visibility

This checklist separates the work already built into the application from the
external facts and accounts that only the SACCO can supply. Complete the
production items in order; do not enable bank callbacks merely to make the
site appear more complete in search.

## Included in the application

- Public `/about` page with human-readable SACCO operations content.
- `/robots.txt` and `/sitemap.xml`, generated from `APP_URL`.
- Search metadata, title, canonical URL, social metadata, and `WebSite`
  structured data.
- `/api/**` is explicitly `noindex, nofollow` and `no-store`, so protected
  member, financial, and bank endpoints are not crawlable.
- A public link to the About page from the sign-in screen.

## You must complete before go-live

1. **Choose and connect the permanent domain.** Buy or use the SACCO-owned
   domain, add it in Render, and point its DNS record to Render. Use the final
   HTTPS address, not a temporary `onrender.com` address. Render's Custom
   Domains panel gives the exact DNS record and verification step.
2. **Set production secrets in Render.** Create a paid, always-on web service
   from the merged `main` branch. Set `APP_URL` to the exact final HTTPS domain,
   `TRUST_PROXY=true`, the production Supabase `DATABASE_URL`,
   `DATABASE_SSL=true`, SMTP credentials, and long unique secrets for
   `JWT_SECRET` and `MEMBER_OTP_PEPPER`. Keep development fallback variables
   false.
3. **Use a separate production database.** Apply all migrations through
   `017`, verify `npm run db:status`, and enable database backups. Do not use
   test data or seed records as live SACCO data.
4. **Test the deployed URL.** Check `/api/health`, sign in as each role, create
   a non-sensitive test member, test recovery email, and repeat the UAT list.
   Delete or deactivate test accounts through normal SACCO controls when done.
5. **Keep Co-op Bank IPN disabled until bank onboarding is complete.** A bank
   callback requires the SACCO's approved account numbers, final credentials,
   authentication rules, a controlled callback test, and an always-on host.

## Search ranking actions you own

1. Create a Google Search Console property for the final domain and verify it
   using DNS. Submit `https://YOUR-DOMAIN/sitemap.xml` after `APP_URL` is set.
2. If the SACCO is eligible for a Business Profile, create or claim it using
   the real legal name, category, address/service area, phone, website, opening
   hours, and photographs. Keep these details identical on the SACCO website,
   social pages, maps listing, stationery, and directories.
3. Publish useful, truthful public content regularly: membership requirements,
   official service contacts, branch/location details, notices, FAQs, and
   community updates. Only publish claims, rates, registration details, and
   addresses approved by the SACCO; never add them as placeholders.
4. Ask genuine members and partners for honest Google reviews. Do not buy
   reviews, create fake listings, or use keyword-stuffed text.
5. Build legitimate local links: official county/community pages, member
   organisations, transport associations, press coverage, and the SACCO’s
   verified social profiles should link to the final domain.

## Re-check after launch

- Open `/robots.txt` and `/sitemap.xml` in a browser; the sitemap must use the
  final HTTPS domain, not an example or Render URL.
- In Search Console, inspect the homepage and `/about`; request indexing after
  the domain and content are final.
- Run Lighthouse on mobile and prioritise the reported Core Web Vitals issues.
- Check Render health alerts, database backups, recovery-email delivery, and
  error logs at least weekly during the first month.

## Official guides

- [Render: connect and verify a custom domain](https://render.com/docs/custom-domains)
- [Google Search Console: submit and monitor a sitemap](https://support.google.com/webmasters/answer/7451001)
- [Google: add or claim a Business Profile](https://support.google.com/business/answer/2911778)
- [Google: Business Profile eligibility](https://support.google.com/business/answer/13763036)
- [Supabase: database backups and recovery](https://supabase.com/docs/guides/platform/backups)
