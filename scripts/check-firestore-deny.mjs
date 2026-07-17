import { readFile } from 'node:fs/promises';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT;

if (!emulatorHost || !projectId) {
  throw new Error('Run this check through the Firebase Firestore emulator.');
}

const firebaseConfig = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
const databaseId = firebaseConfig.firestore?.database || '(default)';
const documentUrl = `http://${emulatorHost}/v1/projects/${projectId}/databases/${encodeURIComponent(databaseId)}/documents/members/rules-smoke-test`;

async function expectDenied(method, body) {
  const response = await fetch(documentUrl, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status !== 403) {
    throw new Error(`Expected Firestore ${method} to be denied with 403, received ${response.status}.`);
  }
}

await expectDenied('GET');
await expectDenied('PATCH', { fields: { name: { stringValue: 'Blocked browser write' } } });
console.log('Firestore server-only rules deny direct browser reads and writes.');
