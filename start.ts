import 'dotenv/config';
import { createSaccoApp } from './server';

const port = Number(process.env.PORT || 3000);

async function start() {
  const app = await createSaccoApp();
  app.listen(port, '0.0.0.0', () => {
    console.log(`[Sacco Ledger OS] Express full-stack server listening on http://0.0.0.0:${port}`);
  });
}

void start().catch(error => {
  console.error('[Sacco Ledger OS] Server startup failed.', error);
  process.exitCode = 1;
});
