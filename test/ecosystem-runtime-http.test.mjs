import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createMemoryPersistence } from '../src/persistence.mjs';
import { createSessionToken, persistIssuedSession } from '../src/auth-session.mjs';
import { handleEcosystemHttp } from '../src/ecosystem-http.mjs';

const SECRET = 'voyage-test-session-secret-0123456789abcdef';

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    writableEnded: false,
    body: Buffer.alloc(0),
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    end(value = '') { this.body = Buffer.from(String(value)); this.writableEnded = true; },
    get headers() { return headers; }
  };
}

function request({ method = 'GET', body = null, token = null } = {}) {
  const req = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = {
    ...(body == null ? {} : { 'content-type': 'application/json' }),
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
  return req;
}

async function authenticatedFixture(userId = 'gid_runtime_user') {
  const persistence = createMemoryPersistence();
  const token = createSessionToken({ userId, ttlSeconds: 3600 }, SECRET);
  await persistIssuedSession({ token, persistence });
  return { persistence, token, userId };
}

async function call(path, options, fixture) {
  const req = request({ ...options, token: fixture?.token });
  const res = response();
  const handled = await handleEcosystemHttp(req, res, path, {
    sessionSigningKey: SECRET,
    persistence: fixture?.persistence
  });
  return { handled, res, json: res.body.length ? JSON.parse(res.body.toString('utf8')) : null };
}

test('ecosystem runtime is private and never infers crew membership from caller input', async () => {
  const fixture = await authenticatedFixture();
  await assert.rejects(
    () => handleEcosystemHttp(request(), response(), '/api/v1/ecosystem/context', {
      sessionSigningKey: SECRET,
      persistence: fixture.persistence
    }),
    /authentication_required/
  );

  const result = await call('/api/v1/ecosystem/context', { method: 'GET' }, fixture);
  assert.equal(result.handled, true);
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.json.globalUserId, fixture.userId);
  assert.equal(result.json.crewCheckDetection.linkedAccountDetected, false);
  assert.equal(result.json.crewCheckDetection.mustNotPromptUser, true);
  assert.equal(result.json.memberships.CREWCHECK.state, 'NONE');
});

test('Voyage Premium + active CrewCheck membership unlocks capability but consent remains separate', async () => {
  const fixture = await authenticatedFixture('gid_premium');
  await fixture.persistence.putMembership({
    globalUserId: fixture.userId,
    product: 'CREWCHECK',
    active: true,
    seen: true,
    verifiedByProduct: true,
    productAccountId: 'crew-account-1',
    crewRole: 'CABIN_CREW'
  });
  await fixture.persistence.putSubscription({ globalUserId: fixture.userId, product: 'VOYAGE', state: 'ACTIVE' });

  const context = await call('/api/v1/ecosystem/context', { method: 'GET' }, fixture);
  assert.equal(context.json.crewCheckDetection.activeMember, true);
  assert.ok(context.json.entitlements.includes('VOYAGE_PREMIUM'));
  assert.ok(context.json.entitlements.includes('UNIFIED_CALENDAR'));
  assert.equal(context.json.unifiedCalendar.entitled, true);
  assert.deepEqual(context.json.unifiedCalendar.grantedBy, ['VOYAGE_PREMIUM']);
  assert.equal(context.json.consents.CREWCHECK_VOYAGE_CONNECTION, false);

  const blocked = await call('/api/v1/ecosystem/vacation-bridge', {
    method: 'POST',
    body: {
      crewCheckWindow: {
        start: '2027-01-10T00:00:00Z',
        end: '2027-01-20T23:59:59Z',
        DUTY_ROSTER: 'must-never-leak'
      },
      personalEvents: [{ id: 'trip-1', title: 'Roma', start: '2027-01-12T10:00:00Z' }]
    }
  }, fixture);
  assert.equal(blocked.json.available, false);
  assert.equal(blocked.json.reason, 'CONNECTION_CONSENT_REQUIRED');

  const consent = await call('/api/v1/ecosystem/consents/crewcheck-voyage', {
    method: 'POST',
    body: { granted: true }
  }, fixture);
  assert.equal(consent.json.granted, true);

  const untrusted = await call('/api/v1/ecosystem/vacation-bridge', {
    method: 'POST',
    body: {
      crewCheckWindow: {
        start: '2027-01-10T00:00:00Z',
        end: '2027-01-20T23:59:59Z',
        DUTY_ROSTER: 'must-never-leak'
      },
      personalEvents: [{ id: 'trip-1', title: 'Roma', start: '2027-01-12T10:00:00Z' }]
    }
  }, fixture);
  assert.equal(untrusted.res.statusCode, 409);
  assert.equal(untrusted.json.available, false);
  assert.equal(untrusted.json.reason, 'AUTHORIZED_VACATION_WINDOW_SOURCE_REQUIRED');
  assert.equal(untrusted.json.overlay, null);
  assert.doesNotMatch(JSON.stringify(untrusted.json), /2027-01-10|2027-01-20|must-never-leak|Roma/);
});

test('CrewCheck Premium alone does not unlock Unified Calendar until product policy explicitly says so', async () => {
  const fixture = await authenticatedFixture('gid_crewcheck_premium_only');
  await fixture.persistence.putMembership({
    globalUserId: fixture.userId,
    product: 'CREWCHECK',
    active: true,
    seen: true,
    verifiedByProduct: true,
    crewRole: 'CABIN_CREW'
  });
  await fixture.persistence.putSubscription({ globalUserId: fixture.userId, product: 'CREWCHECK', state: 'ACTIVE' });

  const context = await call('/api/v1/ecosystem/context', { method: 'GET' }, fixture);
  assert.ok(context.json.entitlements.includes('CREWCHECK_PREMIUM'));
  assert.equal(context.json.entitlements.includes('UNIFIED_CALENDAR'), false);
  assert.equal(context.json.unifiedCalendar.entitled, false);
});

test('visitor CrewCheck account stays invisible to the travel user', async () => {
  const fixture = await authenticatedFixture('gid_visitor');
  await fixture.persistence.putMembership({
    globalUserId: fixture.userId,
    product: 'CREWCHECK',
    active: false,
    seen: true,
    verifiedByProduct: true,
    productAccountId: 'visitor-1'
  });
  await fixture.persistence.putSubscription({ globalUserId: fixture.userId, product: 'VOYAGE', state: 'ACTIVE' });
  await fixture.persistence.setConsent(fixture.userId, 'CREWCHECK_VOYAGE_CONNECTION', true, { source: 'test' });

  const bridge = await call('/api/v1/ecosystem/vacation-bridge', {
    method: 'POST',
    body: {
      crewCheckWindow: { start: '2027-01-10T00:00:00Z', end: '2027-01-20T00:00:00Z' },
      personalEvents: []
    }
  }, fixture);
  assert.equal(bridge.json.available, false);
  assert.equal(bridge.json.reason, 'NO_ACTIVE_CREWCHECK_MEMBERSHIP');
  assert.equal(bridge.json.visibleToUser, false);
  assert.equal(bridge.json.mustNotPromptUser, true);
});


test('product account cannot be linked to two global users in memory', async () => {
  const persistence = createMemoryPersistence();
  await persistence.putMembership({
    globalUserId: 'gid_product_owner',
    product: 'CREWCHECK',
    active: true,
    seen: true,
    verifiedByProduct: true,
    productAccountId: 'crew-account-shared',
    crewRole: 'CABIN_CREW'
  });

  await assert.rejects(
    () => persistence.putMembership({
      globalUserId: 'gid_product_intruder',
      product: 'CREWCHECK',
      active: true,
      seen: true,
      verifiedByProduct: true,
      productAccountId: 'crew-account-shared',
      crewRole: 'CABIN_CREW'
    }),
    (error) => {
      assert.equal(error.code, 'product_account_owner_mismatch');
      assert.equal(error.statusCode, 409);
      return true;
    }
  );

  const owner = await persistence.getEcosystemProfile('gid_product_owner');
  const intruder = await persistence.getEcosystemProfile('gid_product_intruder');
  assert.equal(owner.memberships[0].productAccountId, 'crew-account-shared');
  assert.deepEqual(intruder.memberships, []);
});
