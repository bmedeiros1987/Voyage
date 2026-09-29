import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reviewFields } from '../app/www/launch.js';

test('structured route, date and time leaves are editable without relabelling mentions as departure facts', () => {
  const facts = { category: 'BOARDING_PASS', route: { origin: 'GRU', destination: 'GIG' }, dateMentions: ['18/09/2026', '19/09/2026'], timeMentions: ['10:20', '12:30'], confirmed: false, itemCount: 0, seat: null };
  const original = structuredClone(facts);
  const fields = reviewFields(facts);
  const values = Object.fromEntries(fields.map(({ key, value }) => [key, value]));
  assert.deepEqual(values, { category: 'BOARDING_PASS', route_origin: 'GRU', route_destination: 'GIG', dateMentions_1: '18/09/2026', dateMentions_2: '19/09/2026', timeMentions_1: '10:20', timeMentions_2: '12:30', confirmed: 'false', itemCount: '0', seat: '' });
  assert.match(fields.find(field => field.key === 'dateMentions_1').label, /mencionada/);
  assert.deepEqual(facts, original);
  for (const field of fields) assert.match(field.key, /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);
});

test('nested segment arrays preserve each route and time, never stringify to object Object', () => {
  const fields = reviewFields({ segments: [{ route: { origin: 'BSB', destination: 'GRU' }, times: ['08:00'] }, { route: { origin: 'GRU', destination: 'FLN' }, times: ['12:00'] }] });
  assert.equal(fields.length, 6);
  assert.equal(fields.find(field => field.key === 'segments_2_route_destination').value, 'FLN');
  assert.equal(fields.find(field => field.key === 'segments_1_times_1').value, '08:00');
});

test('review rejects ambiguous keys, unsupported values and limits rather than silently losing facts', () => {
  assert.throws(() => reviewFields({ route_origin: 'BSB', route: { origin: 'GRU' } }), /ambíguos/);
  assert.throws(() => reviewFields(JSON.parse('{"__proto__":{"polluted":true}}')), /inválido/);
  assert.equal({}.polluted, undefined);
  for (const value of [NaN, Infinity, undefined, new Date(), () => {}, Symbol('x')]) assert.throws(() => reviewFields({ value }));
  const cycle = {}; cycle.loop = cycle; assert.throws(() => reviewFields(cycle));
  assert.throws(() => reviewFields({ a: new Array(2) }), /inválida/);
  assert.throws(() => reviewFields({ a: 'x'.repeat(2001) }), /limites/);
  assert.throws(() => reviewFields(Object.fromEntries(Array.from({length: 60}, (_, i) => [`field${i}`, 'v']))), /limites/);
  assert.equal(reviewFields(Object.fromEntries(Array.from({length: 59}, (_, i) => [`field${i}`, 'v']))).length, 59);
  assert.deepEqual(reviewFields({}), []);
  assert.deepEqual(reviewFields({ dates: [], route: {} }).map(field => field.value), ['', '']);
});

test('launch assets resolve within the worker scope at root and voyage subpath', async () => {
  const html = await readFile(new URL('../app/www/launch.html', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../app/www/service-worker.js', import.meta.url), 'utf8');
  const core = [...worker.matchAll(/['"]\.\/([^'"]+)['"]/g)].map(match => match[1]);
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  for (const base of ['https://voyage.example/', 'https://voyage.example/voyage/']) {
    for (const asset of assets) {
      const url = new URL(asset, base);
      assert.ok(url.href.startsWith(base), `${asset} must stay inside ${base}`);
      assert.ok(core.some(path => new URL(path, base).href === url.href), `${asset} must be precached`);
    }
  }
});

test('the actual upload/review/save/detail UI preserves corrected structured facts', async () => {
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.events = {}; this.value = ''; this.hidden = false; this.checked = false; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, callback) { this.events[name] = callback; }
    querySelectorAll(tag) { return this.children.flatMap(child => [ ...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag) ]); }
    reset() { this.value = ''; }
  }
  const nodes = Object.fromEntries(['notice','signed-in','signed-out','review','facts','journeys','detail','login','logout','upload','pdf','confirmed','notes','title','review-note'].map(id => [id, new Element()]));
  const fixture = { importId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', facts: { route: { origin: 'GRU', destination: 'GIG' }, dateMentions: ['18/09/2026'], timeMentions: ['10:20'] }, review: { required: true } };
  const previous = new Map(['document','location','fetch','sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let saved = null;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  try {
    Object.assign(globalThis, {
      document: { getElementById: id => nodes[id], querySelector: () => null, createElement: tag => new Element(tag) },
      location: { origin: 'https://voyage.example', pathname: '/voyage/', search: '', hash: '' },
      sessionStorage: { getItem: () => 'synthetic-session', setItem() {}, removeItem() {} },
      fetch: async (path, options = {}) => {
        if (path.endsWith('/imports/pdf')) return new Response(JSON.stringify(fixture), { status: 201 });
        if (path === '/api/v1/journeys' && options.method === 'POST') { saved = { ...JSON.parse(options.body), id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }; return new Response(JSON.stringify(saved), { status: 201 }); }
        if (path === '/api/v1/journeys') return new Response(JSON.stringify({ journeys: saved ? [saved] : [] }));
        if (path.startsWith('/api/v1/journeys/')) return new Response(JSON.stringify(saved));
        return new Response(JSON.stringify({ enabled: true }));
      }
    });
    await import('../app/www/launch.js?dom-review-regression'); await tick();
    nodes.pdf.files = [{ size: 100 }];
    nodes.upload.events.submit({ preventDefault() {}, submitter: new Element('button') }); await tick();
    const inputs = nodes.facts.querySelectorAll('input');
    assert.equal(inputs.length, 4);
    assert.equal(inputs.find(input => input.dataset.fact === 'route_origin').value, 'GRU');
    inputs.find(input => input.dataset.fact === 'route_destination').value = 'BSB';
    inputs.find(input => input.dataset.fact === 'timeMentions_1').value = '11:20';
    nodes.title.value = 'Minha viagem'; nodes.confirmed.checked = true;
    nodes.review.events.submit({ preventDefault() {}, submitter: new Element('button') }); await tick();
    assert.deepEqual(saved.facts, { route_origin: 'GRU', route_destination: 'BSB', dateMentions_1: '18/09/2026', timeMentions_1: '11:20' });
    await nodes.journeys.children[0].events.click();
    assert.deepEqual(nodes.detail.querySelectorAll('dd').map(element => element.textContent), ['GRU','BSB','18/09/2026','11:20']);
    assert.deepEqual(fixture.facts.route, { origin: 'GRU', destination: 'GIG' });
  } finally {
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
