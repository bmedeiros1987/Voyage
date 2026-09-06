import test from 'node:test';
import assert from 'node:assert/strict';
import { createTravelDataBroker, travelDataBrokerCapabilities } from '../src/travel-data-broker.mjs';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test('broker declares CrewCheck shared service precedence', () => {
  const caps = travelDataBrokerCapabilities();
  assert.equal(caps.strategy, 'CREWCHECK_SHARED_FIRST_THEN_VOYAGE_NATIVE');
  assert.ok(caps.capabilities.includes('CURRENCY'));
  assert.ok(caps.capabilities.includes('BRAZIL_CEP'));
});

test('broker prefers CrewCheck shared FX service and sends only service token', async () => {
  const calls = [];
  const broker = createTravelDataBroker({
    sharedBaseUrl: 'https://crewcheck.example',
    sharedToken: 'service-secret',
    awesomeApiKey: 'provider-secret',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).startsWith('https://crewcheck.example')) {
        return response({ ok: true, provider: 'AWESOMEAPI', status: 'LIVE', quotes: [{ pair: 'USD-BRL', from: 'USD', to: 'BRL', mid: 5.1 }] });
      }
      throw new Error('native provider should not be called');
    }
  });
  const result = await broker.latestFx('USD-BRL');
  assert.equal(result.ok, true);
  assert.equal(result.broker.route, 'SHARED_CREWCHECK_SERVICE');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/shared\/v1\/fx\/latest\?pairs=USD-BRL$/);
  assert.equal(calls[0].options.headers['x-crewcheck-service-token'], 'service-secret');
  assert.doesNotMatch(calls[0].url, /secret|token=/i);
});

test('broker falls back to Voyage-native AwesomeAPI when CrewCheck shared endpoint fails', async () => {
  const calls = [];
  const broker = createTravelDataBroker({
    sharedBaseUrl: 'https://crewcheck.example',
    sharedToken: 'service-secret',
    awesomeApiKey: 'provider-secret',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).startsWith('https://crewcheck.example')) return response({ ok: false }, 503);
      if (String(url).startsWith('https://economia.awesomeapi.com.br')) {
        return response({ USDBRL: { code: 'USD', codein: 'BRL', bid: '5.10', ask: '5.12', timestamp: '1788692400' } });
      }
      throw new Error('unexpected URL');
    }
  });
  const result = await broker.latestFx('USD-BRL');
  assert.equal(result.ok, true);
  assert.equal(result.broker.route, 'VOYAGE_NATIVE_AWESOMEAPI');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers['x-api-key'], 'provider-secret');
  assert.doesNotMatch(calls[1].url, /token=/i);
});

test('broker uses CrewCheck shared CEP service and normalizes path input', async () => {
  const calls = [];
  const broker = createTravelDataBroker({
    sharedBaseUrl: 'https://crewcheck.example/',
    sharedToken: 'service-secret',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return response({ ok: true, provider: 'AWESOMEAPI', address: { cep: '01001000', city: 'São Paulo', state: 'SP' } });
    }
  });
  const result = await broker.lookupCep('01001-000');
  assert.equal(result.ok, true);
  assert.equal(result.broker.route, 'SHARED_CREWCHECK_SERVICE');
  assert.match(calls[0].url, /\/api\/shared\/v1\/cep\/01001000$/);
});
