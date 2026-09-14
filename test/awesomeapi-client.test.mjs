import test from 'node:test';
import assert from 'node:assert/strict';
import { awesomeApiCapabilities, createAwesomeApiClient, quoteForBudget } from '../src/awesomeapi-client.mjs';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test('capabilities prefer x-api-key and forbid token in URLs', () => {
  const caps = awesomeApiCapabilities();
  assert.equal(caps.auth.preferred, 'X_API_KEY_HEADER');
  assert.equal(caps.auth.queryStringTokenAllowedByProviderButDisabledHere, true);
  assert.equal(caps.privacy.apiKeyAllowedInUrl, false);
});

test('latestFx sends secret only in x-api-key and normalizes quotes with provenance', async () => {
  const calls = [];
  const client = createAwesomeApiClient({
    apiKey: 'secret-test-key',
    now: () => Date.parse('2026-09-06T12:00:00Z'),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        USDBRL: {
          code: 'USD', codein: 'BRL', name: 'Dólar Americano/Real Brasileiro',
          bid: '5.1000', ask: '5.1200', high: '5.2', low: '5.0', pctChange: '0.5', timestamp: '1788692400'
        },
        EURBRL: {
          code: 'EUR', codein: 'BRL', name: 'Euro/Real Brasileiro',
          bid: '5.6000', ask: '5.6400', high: '5.7', low: '5.5', pctChange: '-0.2', timestamp: '1788692400'
        }
      });
    }
  });
  const result = await client.latestFx(['USD-BRL', 'EUR-BRL']);
  assert.equal(result.ok, true);
  assert.equal(result.quotes.length, 2);
  assert.equal(result.quotes.find((q) => q.pair === 'USDBRL'), undefined);
  assert.equal(result.quotes.find((q) => q.pair === 'USD-BRL').mid, 5.11);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/json\/last\/USD-BRL,EUR-BRL$/);
  assert.doesNotMatch(calls[0].url, /token=/i);
  assert.equal(calls[0].options.headers['x-api-key'], 'secret-test-key');
});

test('latestFx uses fresh cache and stale-if-error fallback', async () => {
  let now = Date.parse('2026-09-06T12:00:00Z');
  let calls = 0;
  let fail = false;
  const client = createAwesomeApiClient({
    apiKey: 'secret',
    now: () => now,
    fxTtlMs: 60_000,
    staleFxMs: 3_600_000,
    fetchImpl: async () => {
      calls += 1;
      if (fail) throw Object.assign(new Error('network'), { code: 'NETWORK_DOWN' });
      return jsonResponse({ USDBRL: { code: 'USD', codein: 'BRL', bid: '5.10', ask: '5.12', timestamp: '1788692400' } });
    }
  });
  const first = await client.latestFx('USD-BRL');
  assert.equal(first.status, 'LIVE');
  now += 30_000;
  const cached = await client.latestFx('USD-BRL');
  assert.equal(cached.cache.hit, true);
  assert.equal(calls, 1);
  fail = true;
  now += 90_000;
  const stale = await client.latestFx('USD-BRL');
  assert.equal(stale.status, 'STALE_IF_ERROR');
  assert.equal(stale.cache.stale, true);
  assert.equal(stale.warning, 'NETWORK_DOWN');
});

test('quoteForBudget supports direct and inverse conversion without inventing a rate', async () => {
  const client = createAwesomeApiClient({
    fetchImpl: async () => jsonResponse({ EURBRL: { code: 'EUR', codein: 'BRL', bid: '6.00', ask: '6.20', timestamp: '1788692400' } })
  });
  const result = await client.latestFx('EUR-BRL');
  const eurToBrl = quoteForBudget(result, 'EUR', 'BRL');
  const brlToEur = quoteForBudget(result, 'BRL', 'EUR');
  assert.equal(eurToBrl.rate, 6.1);
  assert.equal(brlToEur.rate, Number((1 / 6.1).toFixed(8)));
  assert.equal(quoteForBudget(result, 'USD', 'JPY'), null);
});

test('lookupCep normalizes CEP and provider coordinates without treating them as exact entrance proof', async () => {
  const calls = [];
  const client = createAwesomeApiClient({
    apiKey: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        cep: '01001000', address_type: 'Praça', address_name: 'da Sé', address: 'Praça da Sé',
        state: 'SP', district: 'Sé', lat: '-23.5502784', lng: '-46.6342179', city: 'São Paulo', city_ibge: '3550308', ddd: '11'
      });
    }
  });
  const result = await client.lookupCep('01001-000');
  assert.equal(result.ok, true);
  assert.equal(result.address.cep, '01001000');
  assert.equal(result.address.formattedCep, '01001-000');
  assert.equal(result.address.city, 'São Paulo');
  assert.equal(result.address.latitude, -23.5502784);
  assert.equal(result.address.precision, 'PROVIDER_COORDINATE');
  assert.match(result.disclaimer, /does not prove/i);
  assert.doesNotMatch(calls[0].url, /token=/i);
  assert.equal(calls[0].options.headers['x-api-key'], 'secret');
});

test('invalid CEP fails closed without provider call', async () => {
  let calls = 0;
  const client = createAwesomeApiClient({ fetchImpl: async () => { calls += 1; return jsonResponse({}); } });
  const result = await client.lookupCep('123');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_CEP');
  assert.equal(calls, 0);
});
