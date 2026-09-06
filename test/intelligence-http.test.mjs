import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleIntelligenceHttp, intelligenceHttpCapabilities } from '../src/intelligence-http.mjs';

function request(method = 'GET', body = null, headers = {}) {
  const req = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = body === null ? headers : { 'content-type': 'application/json', ...headers };
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

async function call(path, method = 'GET', body = null) {
  const req = request(method, body);
  const res = response();
  const handled = await handleIntelligenceHttp(req, res, path);
  return { handled, res, payload: res.body ? JSON.parse(res.body) : null };
}

test('capabilities list the unified intelligence API without mutation permission', async () => {
  const direct = intelligenceHttpCapabilities();
  assert.ok(direct.getRoutes.includes('/api/v1/baggage/capabilities'));
  assert.ok(direct.postRoutes.includes('/api/v1/journey/command-center'));
  assert.equal(direct.policy.automaticItineraryMutationAllowed, false);

  const { handled, res, payload } = await call('/api/v1/intelligence/capabilities');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.policy.explicitUserApprovalRequiredForItineraryMutation, true);
});

test('lodging and baggage engines are exposed as preview/decision APIs', async () => {
  const lodging = await call('/api/v1/lodging/resolve', 'POST', {
    trip: { startDate: '2026-09-20', endDate: '2026-09-22', destinationId: 'RIO' },
    hostStays: [{ id: 'host-1', type: 'FRIEND_HOME', destinationId: 'RIO', locationId: 'private-base', confirmed: true, userProvided: true }]
  });
  assert.equal(lodging.res.statusCode, 200);
  assert.equal(lodging.payload.nights.length, 2);
  assert.equal(lodging.payload.nights[0].lodgingType, 'FRIEND_HOME');

  const baggage = await call('/api/v1/baggage/connection', 'POST', {
    connection: { departureAirport: 'GRU', finalDestinationAirport: 'BSB' },
    baggage: { hasCheckedBag: true },
    evidence: { throughChecked: true, bagTagDestination: 'BSB' },
    carousel: { name: '7A' }
  });
  assert.equal(baggage.payload.decision, 'THROUGH_CHECKED_DO_NOT_COLLECT');
  assert.equal(baggage.payload.rules.carouselDoesNotDetermineThroughCheck, true);
});

test('command center remains proposal-only until approval', async () => {
  const result = await call('/api/v1/journey/command-center', 'POST', {
    proposedChanges: [{ id: 'change-1', type: 'TRANSPORT_SWITCH', summary: 'Trocar táxi por metrô' }],
    userApproval: { approved: false }
  });
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.payload.mutationPolicy.automaticMutationAllowed, false);
  assert.notEqual(result.payload.mutationPolicy.executionState, 'APPROVED_CHANGE');
});

test('known intelligence paths reject wrong HTTP method', async () => {
  const result = await call('/api/v1/budget/capabilities', 'POST', {});
  assert.equal(result.handled, true);
  assert.equal(result.res.statusCode, 405);
  assert.equal(result.payload.error, 'method_not_allowed');
});

test('unknown route falls through to the main server', async () => {
  const { handled, res } = await call('/api/v1/not-a-real-module');
  assert.equal(handled, false);
  assert.equal(res.writableEnded, false);
});
