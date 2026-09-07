import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleTravelDataHttp } from '../src/travel-data-http.mjs';

function request(url) {
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = url;
  req.headers = {};
  return req;
}

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    writableEnded: false,
    body: '',
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    end(value = '') { this.body = String(value); this.writableEnded = true; },
    get headers() { return headers; }
  };
}

async function withSharedEnvironment(fn) {
  const before = {
    base: process.env.CREWCHECK_SHARED_API_BASE_URL,
    token: process.env.CREWCHECK_SHARED_SERVICES_TOKEN,
    awesome: process.env.AWESOMEAPI_API_KEY,
    fetch: globalThis.fetch
  };
  process.env.CREWCHECK_SHARED_API_BASE_URL = 'https://crewcheck.example';
  process.env.CREWCHECK_SHARED_SERVICES_TOKEN = 'service-secret';
  process.env.AWESOMEAPI_API_KEY = 'awesome-secret';
  try { return await fn(); }
  finally {
    if (before.base === undefined) delete process.env.CREWCHECK_SHARED_API_BASE_URL; else process.env.CREWCHECK_SHARED_API_BASE_URL = before.base;
    if (before.token === undefined) delete process.env.CREWCHECK_SHARED_SERVICES_TOKEN; else process.env.CREWCHECK_SHARED_SERVICES_TOKEN = before.token;
    if (before.awesome === undefined) delete process.env.AWESOMEAPI_API_KEY; else process.env.AWESOMEAPI_API_KEY = before.awesome;
    globalThis.fetch = before.fetch;
  }
}

test('data capabilities report shared Cirium readiness without exposing secrets', async () => withSharedEnvironment(async () => {
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(options.headers['x-crewcheck-service-token'], 'service-secret');
    assert.doesNotMatch(String(url), /service-secret|awesome-secret/);
    return { ok: true, status: 200, async json() { return { ok: true, capability: 'FLIGHT_STATUS', provider: 'cirium-sky', configured: true, secretsExposed: false }; } };
  };
  const req = request('/api/v1/data/capabilities');
  const res = response();
  const handled = await handleTravelDataHttp(req, res, '/api/v1/data/capabilities');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.sharedCrewCheckConfigured, true);
  assert.equal(payload.sharedFlightStatus.provider, 'cirium-sky');
  assert.equal(payload.sharedFlightStatus.configured, true);
  assert.equal(payload.secretsExposed, false);
  assert.doesNotMatch(res.body, /service-secret|awesome-secret/);
}));

test('flight status route proxies shared CrewCheck facts and strips secrets', async () => withSharedEnvironment(async () => {
  globalThis.fetch = async (url, options = {}) => {
    assert.match(String(url), /\/api\/shared\/v1\/flight\/status\?/);
    assert.equal(options.headers['x-crewcheck-service-token'], 'service-secret');
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          provider: 'cirium-sky',
          status: 'LIVE',
          debugToken: 'must-not-leak',
          flights: [{ resources: { arrivalGate: '205', baggage: '7A' } }]
        };
      }
    };
  };
  const url = '/api/v1/data/flight-status?carrier=LA&flight=3000&date=2026-09-20';
  const req = request(url);
  const res = response();
  await handleTravelDataHttp(req, res, '/api/v1/data/flight-status');
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.flights[0].resources.baggage, '7A');
  assert.equal(payload.flights[0].resources.arrivalGate, '205');
  assert.equal(payload.secretsExposed, false);
  assert.equal(payload.debugToken, undefined);
  assert.doesNotMatch(res.body, /service-secret|must-not-leak/);
}));
