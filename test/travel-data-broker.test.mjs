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
  assert.ok(caps.capabilities.includes('FLIGHT_STATUS'));
  assert.ok(caps.capabilities.includes('BAGGAGE_CAROUSEL'));
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

test('broker reuses CrewCheck Cirium flight status including gate terminal and baggage carousel', async () => {
  const calls = [];
  const broker = createTravelDataBroker({
    sharedBaseUrl: 'https://crewcheck.example',
    sharedToken: 'service-secret',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return response({
        ok: true,
        provider: 'cirium-sky',
        status: 'LIVE',
        flights: [{
          carrier: 'LA',
          flightNumber: '3000',
          resources: { departureGate: '22', arrivalGate: '205', arrivalTerminal: '2', baggage: '7A' },
          freshness: { updatedAt: '2026-09-20T12:55:00.000Z', ageMinutes: 2 }
        }],
        secretsExposed: false
      });
    }
  });
  const result = await broker.latestFlightStatus({ carrier: 'LA', flight: 'LA3000', date: '2026-09-20' });
  assert.equal(result.ok, true);
  assert.equal(result.broker.route, 'SHARED_CREWCHECK_SERVICE');
  assert.equal(result.flights[0].resources.baggage, '7A');
  assert.equal(result.flights[0].resources.arrivalGate, '205');
  assert.match(calls[0].url, /\/api\/shared\/v1\/flight\/status\?/);
  assert.match(calls[0].url, /carrier=LA/);
  assert.match(calls[0].url, /flight=3000/);
  assert.match(calls[0].url, /date=2026-09-20/);
  assert.equal(calls[0].options.headers['x-crewcheck-service-token'], 'service-secret');
  assert.doesNotMatch(calls[0].url, /service-secret|token=/i);
});

test('broker fails closed for flight status instead of duplicating Cirium when shared service is unavailable', async () => {
  const broker = createTravelDataBroker({
    sharedBaseUrl: 'https://crewcheck.example',
    sharedToken: 'service-secret',
    awesomeApiKey: 'provider-secret',
    fetchImpl: async () => response({ ok: false }, 503)
  });
  const result = await broker.latestFlightStatus({ carrier: 'LA', flight: '3000', date: '2026-09-20' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SHARED_FLIGHT_STATUS_UNAVAILABLE');
  assert.equal(result.broker.route, 'NEEDS_SHARED_CREWCHECK_SERVICE');
  assert.deepEqual(result.providerNeeds, ['CREWCHECK_SHARED_FLIGHT_STATUS']);
});
