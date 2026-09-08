import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Adaptive Home is present, local-first, and keeps the approved theme modes', async () => {
  const html = await text('app/www/index.html');
  const script = await text('app/www/adaptive-home.js');
  const css = await text('app/www/adaptive-home.css');

  assert.match(html, /adaptive-home\.css/);
  assert.match(html, /adaptive-home\.js/);
  assert.match(html, /data-action="manage-home"/);
  assert.match(script, /voyage-home-preferences-v1/);
  assert.match(script, /reorderCards/);
  assert.match(script, /data-home-pin/);
  assert.match(script, /data-home-visibility/);
  assert.match(script, /data-home-size/);
  assert.match(script, /data-home-reset/);
  assert.match(script, /SUGGESTION_TTL_MS/);
  assert.match(script, /migrateHomeState/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height:44px/);
});

test('Home does not ship fake journey, passenger, or operational facts', async () => {
  const html = await text('app/www/index.html');
  assert.doesNotMatch(html, /Itália 2027|Nova York|AF 457|Marina|João|R\$ 17\.420|14 set/);
  assert.match(html, /Nenhuma jornada importada/);
  assert.match(html, /Nenhum status está disponível agora/);
  assert.match(html, /Nenhuma conexão disponível/);
});

test('availability CTA is wired to the real preview route with explicit failure states', async () => {
  const html = await text('app/www/index.html');
  const app = await text('app/www/app.js');
  assert.match(html, /data-action="availability-search"/);
  assert.match(app, /\/api\/v1\/availability\/preview/);
  assert.match(app, /Consultando o servidor de disponibilidade/);
  assert.match(app, /A disponibilidade não está acessível neste momento/);
  assert.match(app, /Você está offline/);
  assert.match(app, /TimeoutError/);
});

test('offline shell caches Adaptive Home assets and expires old shell versions', async () => {
  const serviceWorker = await text('app/www/service-worker.js');
  assert.match(serviceWorker, /voyage-shell-v13-local-retention/);
  assert.match(serviceWorker, /'\.\/adaptive-home\.css'/);
  assert.match(serviceWorker, /'\.\/adaptive-home\.js'/);
  assert.match(serviceWorker, /SHARED_PDF_TTL_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
});

test('keyboard and assistive technology controls have named targets', async () => {
  const html = await text('app/www/index.html');
  const script = await text('app/www/adaptive-home.js');
  assert.match(html, /aria-label="Importar reservas e documentos"/);
  assert.match(html, /aria-label="Alterar tema"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(script, /aria-selected/);
  assert.match(script, /aria-pressed/);
  assert.match(script, /aria-label="Mover para cima"/);
  assert.match(script, /aria-label="Mover para baixo"/);
});
