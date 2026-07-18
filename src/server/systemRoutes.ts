import type { Express } from 'express';

type SystemRouteContext = {
  databaseStatus(): string;
  authStatus(): string;
  countAdmins(): Promise<number>;
  onError(error: unknown, response: any): void;
};

export function registerSystemRoutes(app: Express, context: SystemRouteContext) {
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
