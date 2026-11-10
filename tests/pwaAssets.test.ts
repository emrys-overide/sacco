import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('ships a Chrome-installable web app manifest and service worker', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const serviceWorker = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
  const pwaClient = await readFile(new URL('../src/lib/pwa.ts', import.meta.url), 'utf8');
  const appShell = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.equal(manifest.name, 'Sowetamu Sacco');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.prefer_related_applications, false);
  assert.ok(manifest.icons.some((icon: any) => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon: any) => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.match(serviceWorker, /addEventListener\('fetch'/);
  assert.match(serviceWorker, /sowetamu-shell-v4/);
  assert.doesNotMatch(pwaClient, /beforeinstallprompt[\s\S]{0,200}preventDefault/);
  assert.match(appShell, /<PwaInstallPrompt showInstallButton=\{false\} \/>/);
});
