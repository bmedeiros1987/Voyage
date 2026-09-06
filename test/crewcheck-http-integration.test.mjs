import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleCrewCheckIntegrationHttp } from '../src/crewcheck-http-integration.mjs';

function request({ method = 'POST', headers = {}, body = null } = {}) {
  const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.headers = headers;
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

test('CrewCheck capabilities endpoint exposes no secret', async () => {
  const original = process.env.CREWCHECK_SHARED_SERVICES_TOKEN;
  process.env.CREWCHECK_SHARED_SERVICES_TOKEN = 'shared-regression-secret';
  try {
    const req = request({ method: 'GET' });
    const res = response();
    const handled = await handleCrewCheckIntegrationHttp(req, res, '/api/v1/integrations/crewcheck/capabilities');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.configured, true);
    assert.equal(payload.surfaceName, 'Voyage integrado');
    assert.ok(!res.body.includes('shared-regression-secret'));
  } finally {
    if (original === undefined) delete process.env.CREWCHECK_SHARED_SERVICES_TOKEN;
    else process.env.CREWCHECK_SHARED_SERVICES_TOKEN = original;
  }
});

test('CrewCheck preview rejects missing service token', async () => {
  const original = process.env.CREWCHECK_SHARED_SERVICES_TOKEN;
  process.env.CREWCHECK_SHARED_SERVICES_TOKEN = 'shared-regression-secret';
  try {
    const req = request({ body: { userApprovedShare: true } });
    const res = response();
    await handleCrewCheckIntegrationHttp(req, res, '/api/v1/integrations/crewcheck/preview');
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error, 'crewcheck_bridge_unauthorized');
  } finally {
    if (original === undefined) delete process.env.CREWCHECK_SHARED_SERVICES_TOKEN;
    else process.env.CREWCHECK_SHARED_SERVICES_TOKEN = original;
  }
});

test('CrewCheck preview accepts minimized approved roster context', async () => {
  const original = process.env.CREWCHECK_SHARED_SERVICES_TOKEN;
  process.env.CREWCHECK_SHARED_SERVICES_TOKEN = 'shared-regression-secret';
  try {
    const req = request({
      headers: { 'x-crewcheck-service-token': 'shared-regression-secret' },
      body: {
        userApprovedShare: true,
        profile: { baseAirport: 'BSB', timeZone: 'America/Sao_Paulo' },
        roster: { year: 2026, month: 9, days: [{ date: '2026-09-20', type: 'FOLGA' }] }
      }
    });
    const res = response();
    await handleCrewCheckIntegrationHttp(req, res, '/api/v1/integrations/crewcheck/preview');
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.bridge.surface, 'VOYAGE_INTEGRATED');
    assert.deepEqual(payload.bridge.context.availability.explicitFreeDates, ['2026-09-20']);
    assert.equal(payload.bridge.context.approval.itineraryMutationApproved, false);
  } finally {
    if (original === undefined) delete process.env.CREWCHECK_SHARED_SERVICES_TOKEN;
    else process.env.CREWCHECK_SHARED_SERVICES_TOKEN = original;
  }
});

test('CrewCheck preview rejects secret and identity-like forbidden fields', async () => {
  const original = process.env.CREWCHECK_SHARED_SERVICES_TOKEN;
  process.env.CREWCHECK_SHARED_SERVICES_TOKEN = 'shared-regression-secret';
  try {
    const req = request({
      headers: { 'x-crewcheck-service-token': 'shared-regression-secret' },
      body: { userApprovedShare: true, profile: { baseAirport: 'BSB', cpf: '00000000000' } }
    });
    const res = response();
    await handleCrewCheckIntegrationHttp(req, res, '/api/v1/integrations/crewcheck/preview');
    assert.equal(res.statusCode, 400);
    const payload = JSON.parse(res.body);
    assert.equal(payload.error, 'crewcheck_bridge_forbidden_field');
    assert.equal(payload.field, 'profile.cpf');
  } finally {
    if (original === undefined) delete process.env.CREWCHECK_SHARED_SERVICES_TOKEN;
    else process.env.CREWCHECK_SHARED_SERVICES_TOKEN = original;
  }
});
