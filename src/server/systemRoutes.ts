import type { Express } from 'express';
import { buildAboutPage, buildRobotsTxt, buildSitemapXml, getPublicSiteUrl } from './publicSeo';

type SystemRouteContext = {
  databaseStatus(): string;
  authStatus(): string;
  countAdmins(): Promise<number>;
  onError(error: unknown, response: any): void;
};

export function registerSystemRoutes(app: Express, context: SystemRouteContext) {
  const publicSiteUrl = getPublicSiteUrl(process.env.APP_URL);

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(buildRobotsTxt(publicSiteUrl));
  });

  app.get('/sitemap.xml', (_req, res) => {
    if (!publicSiteUrl) return res.status(503).type('text/plain').send('Sitemap is unavailable until APP_URL is configured.');
    res.type('application/xml').send(buildSitemapXml(publicSiteUrl));
  });

  app.get('/about', (_req, res) => {
    res.type('html').send(buildAboutPage(publicSiteUrl));
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      database: context.databaseStatus(),
      auth: context.authStatus(),
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/auth/onboarding-status', async (_req, res) => {
    try {
      res.json({ needsFirstAdmin: (await context.countAdmins()) === 0 });
    } catch (error) {
      context.onError(error, res);
    }
  });
}
