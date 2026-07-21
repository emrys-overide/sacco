const siteDescription = 'Sowetamu Sacco provides secure member accounts, vehicle records, daily collections, expenses, loans, and financial reporting for SACCO operations.';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value: string) {
  return escapeHtml(value);
}

/**
 * APP_URL is supplied by the deployment rather than baked into the client so
 * production metadata always follows the SACCO's chosen public domain.
 */
export function getPublicSiteUrl(value: unknown): string | null {
  const rawValue = String(value || '').trim();
  if (!rawValue) return null;

  try {
    const url = new URL(rawValue);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function buildRobotsTxt(publicSiteUrl: string | null) {
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /offline.html'
  ];
  if (publicSiteUrl) lines.push(`Sitemap: ${publicSiteUrl}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

export function buildSitemapXml(publicSiteUrl: string, generatedAt = new Date()) {
  const lastModified = generatedAt.toISOString().slice(0, 10);
  const pages = [
    { path: '/', priority: '1.0' },
    { path: '/about', priority: '0.8' }
  ];
  const urls = pages.map(page => `  <url>\n    <loc>${escapeXml(`${publicSiteUrl}${page.path}`)}</loc>\n    <lastmod>${lastModified}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${page.priority}</priority>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function buildAboutPage(publicSiteUrl: string | null) {
  const pageUrl = publicSiteUrl ? `${publicSiteUrl}/about` : null;
  const imageUrl = publicSiteUrl ? `${publicSiteUrl}/icons/sacco-icon-512.png` : null;
  const websiteSchema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Sowetamu Sacco',
    alternateName: 'Sowetamu Sacco Management System',
    ...(publicSiteUrl ? { url: `${publicSiteUrl}/` } : {}),
    description: siteDescription
  }).replace(/</g, '\\u003c');
  const canonical = pageUrl ? `<link rel="canonical" href="${escapeHtml(pageUrl)}" />` : '';
  const openGraphUrl = pageUrl ? `<meta property="og:url" content="${escapeHtml(pageUrl)}" />` : '';
  const openGraphImage = imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(siteDescription)}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <meta name="theme-color" content="#052e2b" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Sowetamu Sacco" />
    <meta property="og:title" content="Sowetamu Sacco | Member, Fleet &amp; Financial Management" />
    <meta property="og:description" content="${escapeHtml(siteDescription)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="Sowetamu Sacco | Member, Fleet &amp; Financial Management" />
    <meta name="twitter:description" content="${escapeHtml(siteDescription)}" />
    ${canonical}
    ${openGraphUrl}
    ${openGraphImage}
    <script type="application/ld+json">${websiteSchema}</script>
    <title>About Sowetamu Sacco | Member, Fleet &amp; Financial Management</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #102a43; background: #f6fbfa; }
      * { box-sizing: border-box; }
      body { margin: 0; line-height: 1.6; }
      header { background: linear-gradient(135deg, #052e2b, #087266); color: white; padding: 3.5rem 1.25rem; }
      main, header > div { max-width: 52rem; margin: 0 auto; }
      .brand { font-weight: 800; letter-spacing: -.02em; font-size: 1.25rem; }
      h1 { max-width: 46rem; font-size: clamp(2rem, 6vw, 3.5rem); line-height: 1.1; margin: 1.25rem 0 1rem; letter-spacing: -.04em; }
      h2 { color: #064e3b; margin-top: 2.5rem; font-size: 1.45rem; }
      p, li { font-size: 1.05rem; }
      main { padding: 2.75rem 1.25rem 4rem; }
      .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); padding: 0; list-style: none; }
      .grid li { background: white; border: 1px solid #d6ebe6; border-radius: 1rem; padding: 1.1rem; box-shadow: 0 4px 16px rgba(4, 78, 65, .06); }
      .grid strong { display: block; color: #064e3b; margin-bottom: .35rem; }
      a { color: #047857; font-weight: 700; }
      .button { display: inline-block; margin-top: 1rem; border-radius: .75rem; background: #059669; color: white; padding: .8rem 1.05rem; text-decoration: none; }
      footer { border-top: 1px solid #d6ebe6; padding: 1.5rem 1.25rem 2.5rem; color: #52616b; }
      footer > div { max-width: 52rem; margin: 0 auto; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <div class="brand">Sowetamu Sacco</div>
        <h1>Secure management for SACCO members, vehicles, collections, and reporting.</h1>
        <p>${escapeHtml(siteDescription)}</p>
        <a class="button" href="/">Open secure member access</a>
      </div>
    </header>
    <main>
      <h2>Built for day-to-day SACCO operations</h2>
      <p>Sowetamu Sacco brings core operational records into one secure workspace. Members and authorised officers use role-specific access, while financial actions remain protected behind account sign-in.</p>
      <ul class="grid">
        <li><strong>Member accounts</strong>Manage registered member profiles, secure access, savings records, and statements.</li>
        <li><strong>Fleet records</strong>Maintain vehicle and driver records that support organised transport operations.</li>
        <li><strong>Collections and expenses</strong>Record daily collections, operating expenses, and accountable ledger activity.</li>
        <li><strong>Loans and reporting</strong>Support staged loan reviews and produce operational and financial reports.</li>
      </ul>
      <h2>Private by design</h2>
      <p>Financial records, member information, reports, and bank workflows are available only after authentication and according to the user’s role. Public search pages never expose account, transaction, or member data.</p>
      <h2>Member and officer access</h2>
      <p>Existing members can create an online account using the details already held on their active SACCO record. Officers use the secure access provided by the SACCO administrator.</p>
      <p><a href="/">Go to the Sowetamu Sacco sign-in page</a>.</p>
    </main>
    <footer><div>© ${new Date().getUTCFullYear()} Sowetamu Sacco. Secure member and financial operations.</div></footer>
  </body>
</html>`;
}

/**
 * A deliberately non-sensitive guide which is available before sign-in. The
 * operational and security runbooks stay in the private repository instead.
 */
export function buildDocumentationPage(publicSiteUrl: string | null) {
  const pageUrl = publicSiteUrl ? `${publicSiteUrl}/documentation` : null;
  const canonical = pageUrl ? `<link rel="canonical" href="${escapeHtml(pageUrl)}" />` : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Sowetamu Sacco user guide and Technical Department support contact." />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="theme-color" content="#052e2b" />
    ${canonical}
    <title>Sowetamu Sacco Documentation and Help</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #102a43; background: #f6fbfa; }
      * { box-sizing: border-box; }
      body { margin: 0; line-height: 1.6; }
      header { background: linear-gradient(135deg, #052e2b, #087266); color: white; padding: 3.25rem 1.25rem; }
      main, header > div, footer > div { max-width: 52rem; margin: 0 auto; }
      .brand { font-weight: 800; letter-spacing: -.02em; font-size: 1.25rem; }
      h1 { max-width: 46rem; font-size: clamp(2rem, 6vw, 3.25rem); line-height: 1.1; margin: 1.25rem 0 1rem; letter-spacing: -.04em; }
      h2 { color: #064e3b; margin-top: 2.5rem; font-size: 1.45rem; }
      h3 { color: #102a43; margin-bottom: .25rem; }
      p, li { font-size: 1.02rem; }
      main { padding: 2.75rem 1.25rem 4rem; }
      .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); padding: 0; list-style: none; }
      .grid li, .contact { background: white; border: 1px solid #d6ebe6; border-radius: 1rem; padding: 1.1rem; box-shadow: 0 4px 16px rgba(4, 78, 65, .06); }
      .grid strong { display: block; color: #064e3b; margin-bottom: .35rem; }
      a { color: #047857; font-weight: 700; }
      .button { display: inline-block; margin-top: 1rem; border-radius: .75rem; background: #059669; color: white; padding: .8rem 1.05rem; text-decoration: none; }
      .note { border-left: 4px solid #059669; background: #ecfdf5; padding: .9rem 1rem; border-radius: .25rem .75rem .75rem .25rem; }
      footer { border-top: 1px solid #d6ebe6; padding: 1.5rem 1.25rem 2.5rem; color: #52616b; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <div class="brand">Sowetamu Sacco</div>
        <h1>Documentation and help</h1>
        <p>Simple guidance for members and officers using the SACCO management system.</p>
        <a class="button" href="/">Open secure member access</a>
      </div>
    </header>
    <main>
      <h2>Getting started</h2>
      <ul class="grid">
        <li><strong>Members</strong>Use your registered phone number or email to create and access your account. Your details must match an active SACCO member record.</li>
        <li><strong>Officers</strong>The Chairman creates officer accounts and assigns the correct role. Never share an officer account or password.</li>
        <li><strong>Loans</strong>Use the Loans area to submit an application, track its review stage, read any rejection reason, and reapply after resolving the stated issue.</li>
      </ul>

      <h2>Passwords and account access</h2>
      <p>If you forget your password, select <strong>Request password reset</strong> on the sign-in screen, then contact the Chairman or SACCO Administrator directly. The system sends them an in-app notification for a valid request. After identity verification, sign in with the temporary password and immediately choose a private replacement password.</p>
      <p class="note">Do not send passwords, one-time codes, bank details, or a full ID number to anyone by email, SMS, or WhatsApp. The Technical Department will not ask for your password.</p>

      <h2>Notifications and records</h2>
      <p>Notifications appear through the bell while the application is connected to the internet. If you are offline, the notification remains in your account and appears after you reconnect and sign in.</p>
      <p>Members can view their own profile, vehicle information, transactions, receipts, payments, and loans. Officers see only the areas allowed by their assigned role. Use the Roles &amp; Responsibilities page in the application for the full role guide.</p>

      <h2>Technical help</h2>
      <div class="contact">
        <h3>Technical Department</h3>
        <p>Email: <a href="mailto:emryspaul7@gmail.com">emryspaul7@gmail.com</a><br />Phone: <a href="tel:+254759670456">0759670456</a></p>
        <p>When reporting a problem, include your role, the page you were using, what happened, the time it happened, and a screenshot if possible. Do not include your password or other secret information.</p>
      </div>

      <p><a href="/">Return to the secure sign-in page</a>.</p>
    </main>
    <footer><div>© ${new Date().getUTCFullYear()} Sowetamu Sacco. Internal user guidance.</div></footer>
  </body>
</html>`;
}
