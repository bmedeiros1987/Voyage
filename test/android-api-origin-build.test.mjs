import test from 'node:test';
import assert from 'node:assert/strict';
import { configureApiOriginHtml, normalizeApiOrigin } from '../app/scripts/configure-api-origin.mjs';

test('packaged API origin accepts only clean HTTPS origins', () => {
  assert.equal(normalizeApiOrigin('https://crewcheck.online'), 'https://crewcheck.online');
  for (const value of [
    '',
    'http://crewcheck.online',
    'https://user:pass@crewcheck.online',
    'https://crewcheck.online/voyage',
    'https://crewcheck.online?x=1',
    'javascript:alert(1)'
  ]) assert.throws(() => normalizeApiOrigin(value), /voyage_api_origin_/);
});

test('packaged API origin is injected into the trusted meta marker', () => {
  const html = '<head><meta name="voyage-api-origin" content="" /></head>';
  const configured = configureApiOriginHtml(html, 'https://crewcheck.online');
  assert.match(configured, /name="voyage-api-origin" content="https:\/\/crewcheck\.online"/);
  assert.doesNotMatch(configured, /name="voyage-api-origin" content=""/);
});

test('build fails closed if the trusted meta marker is missing', () => {
  assert.throws(
    () => configureApiOriginHtml('<head></head>', 'https://crewcheck.online'),
    /voyage_api_origin_meta_missing/
  );
});
