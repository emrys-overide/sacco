import { defineJsonSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const runtimeSecrets = defineJsonSecret('SACCO_RUNTIME_SECRETS');
const region = 'africa-south1';

const allowedSecretKeys = new Set([
  'DATABASE_URL',
  'JWT_SECRET',
  'TOTP_ENCRYPTION_KEY',
  'FIREBASE_WEB_API_KEY',
  'MEMBER_OTP_PEPPER',
  'MEMBER_OTP_DELIVERY_WEBHOOK_URL',
  'MEMBER_OTP_DELIVERY_AUTHORIZATION',
  'COOP_IPN_TOKEN',
  'COOP_IPN_BASIC_USERNAME',
  'COOP_IPN_BASIC_PASSWORD',
  'COOP_ALLOWED_ACCOUNT_NUMBERS'
]);

function applyRuntimeSecrets() {
  const values = runtimeSecrets.value() as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    if (allowedSecretKeys.has(key) && typeof value === 'string' && value) {
      process.env[key] = value;
    }
  }
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    throw new Error('SACCO_RUNTIME_SECRETS must contain DATABASE_URL and JWT_SECRET.');
  }
}

type ServerModule = typeof import('../../server');
let serverModulePromise: Promise<ServerModule> | undefined;

function loadServerModule() {
  applyRuntimeSecrets();
  serverModulePromise ??= import('../../server');
  return serverModulePromise;
}

let expressAppPromise: ReturnType<ServerModule['createSaccoApp']> | undefined;

export const saccoApi = onRequest(
  {
    region,
    secrets: [runtimeSecrets],
    memory: '512MiB',
    timeoutSeconds: 60,
    minInstances: 1,
    maxInstances: 3,
    concurrency: 20
  },
  async (request, response) => {
    const server = await loadServerModule();
    expressAppPromise ??= server.createSaccoApp({
      serveFrontend: false,
      runBackgroundProcessor: false
    });
    const app = await expressAppPromise;
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        response.off('finish', finish);
        response.off('close', finish);
        resolve();
      };
      response.once('finish', finish);
      response.once('close', finish);
      try {
        app(request, response);
      } catch (error) {
        response.off('finish', finish);
        response.off('close', finish);
        reject(error);
      }
    });
  }
);

// A callback is acknowledged only after its PostgreSQL inbox row is durable.
// This scheduled retry recovers work if a serverless instance is frozen after
// the HTTP response or a prior processing attempt fails.
export const processPendingCoopBankEvents = onSchedule(
  {
    schedule: 'every 1 minutes',
    region,
    secrets: [runtimeSecrets],
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 1
  },
  async () => {
    const server = await loadServerModule();
    await server.resumePendingCoopBankEvents();
  }
);
