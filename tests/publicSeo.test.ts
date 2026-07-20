import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAboutPage, buildRobotsTxt, buildSitemapXml, getPublicSiteUrl } from '../src/server/publicSeo';

test('normalizes a public site URL without retaining a deployment path or query', () => {
  assert.equal(getPublicSiteUrl('https://sowetamu.example/app?preview=true#top'), 'https://sowetamu.example');
  assert.equal(getPublicSiteUrl('notaurl'), null);
  assert.equal(getPublicSiteUrl('ftp://sowetamu.example'), null);
});

test('generates robots and sitemap documents that exclude private API endpoints', () => {
  const siteUrl = 'https://sowetamu.example';
  assert.match(buildRobotsTxt(siteUrl), /Disallow: \/api\//);
  assert.match(buildRobotsTxt(siteUrl), /Sitemap: https:\/\/sowetamu\.example\/sitemap\.xml/);

  const sitemap = buildSitemapXml(siteUrl, new Date('2026-07-20T00:00:00.000Z'));
  assert.match(sitemap, /<loc>https:\/\/sowetamu\.example\/</);
  assert.match(sitemap, /<loc>https:\/\/sowetamu\.example\/about</);
  assert.match(sitemap, /<lastmod>2026-07-20<\/lastmod>/);
});

test('creates a public about page without member or financial record data', () => {
  const page = buildAboutPage('https://sowetamu.example');
  assert.match(page, /<h1>Secure management for SACCO members, vehicles, collections, and reporting\.<\/h1>/);
  assert.match(page, /<link rel="canonical" href="https:\/\/sowetamu\.example\/about"/);
  assert.match(page, /"@type":"WebSite"/);
  assert.doesNotMatch(page, /api\/members|transaction id|account number/i);
});
