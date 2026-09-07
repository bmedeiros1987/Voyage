import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MARKUP_SOURCES = [
  'app/www/index.html',
  'app/www/app.js',
  'app/www/import-enhancements.js',
  'app/www/signature-experience.js',
  'app/www/native-pdf-share.js'
];

test('the shell contains nothing the restrictive CSP would silently drop', async () => {
  for (const path of MARKUP_SOURCES) {
    const source = await read(path);
    assert.doesNotMatch(source, /\sstyle="/, `${path} must not carry a style attribute: style-src 'self' drops it and the layout degrades silently`);
    assert.doesNotMatch(source, /<style[\s>]/, `${path} must not inject a style element`);
    assert.doesNotMatch(source, /\bnew Function\b|\beval\(/, `${path} must not need unsafe-eval`);
    assert.doesNotMatch(source, /\son(click|load|error|change|submit|input|focus|blur)=/, `${path} must not use an inline event handler`);
    assert.doesNotMatch(source, /["'`]javascript:/, `${path} must not build a javascript: URL`);
  }
});

test('the import call to action keeps its layout through a stylesheet rule', async () => {
  const markup = await read('app/www/app.js');
  const styles = await read('app/www/imports.css');
  assert.match(markup, /class="button button--gold import-dropzone__cta"/);
  const rule = /\.import-dropzone__cta\s*\{([^}]*)\}/.exec(styles);
  assert.ok(rule, 'imports.css must define .import-dropzone__cta');
  for (const declaration of ['display:grid', 'place-items:center', 'min-height:44px', 'max-width:260px']) {
    assert.match(rule[1].replaceAll(' ', ''), new RegExp(declaration.replaceAll(' ', '')), `the CTA must keep ${declaration}`);
  }
});

test('the readiness ring gets its score from CSS and CSSOM, not from a style attribute', async () => {
  const markup = await read('app/www/signature-experience.js');
  const styles = await read('app/www/signature-experience.css');
  assert.match(markup, /class="signature-ring" data-signature-ring>/);
  assert.match(styles, /\.signature-ring\{--score:0/, 'the ring must default to 0 in CSS');
  assert.match(markup, /ring\.style\.setProperty\('--score'/, 'the live score must be written through CSSOM, which CSP allows');
});

test('every script the shell loads is same-origin, as script-src self requires', async () => {
  const markup = await read('app/www/index.html');
  const sources = [...markup.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(sources.length > 0, 'the shell must load its modules by src');
  for (const src of sources) {
    assert.match(src, /^\.\//, `${src} must be same-origin`);
  }
});

function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}
