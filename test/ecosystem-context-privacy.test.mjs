import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createMemoryPersistence } from '../src/persistence.mjs';
import { createSessionToken, persistIssuedSession } from '../src/auth-session.mjs';
import { handleEcosystemHttp } from '../src/ecosystem-http.mjs';

const SIGNING_KEY = 'synthetic-ecosystem-privacy-key-32-bytes';
async function fixture() {
  const persistence = createMemoryPersistence();
  const userId = 'gid_privacy_test';
  const token = createSessionToken({ userId }, SIGNING_KEY);
  await persistIssuedSession({ token, persistence });
  await persistence.putSubscription({ globalUserId: userId, product: 'VOYAGE', state: 'ACTIVE' });
  return { persistence, userId, token };
}
async function context({ persistence, token }) {
  const req = Readable.from([]);
  req.method = 'GET'; req.headers = { authorization: `Bearer ${token}` };
  let body;
  const res = { statusCode: 0, setHeader() {}, end(value) { body = String(value); this.writableEnded = true; } };
  const handled = await handleEcosystemHttp(req, res, '/api/v1/ecosystem/context', { sessionSigningKey: SIGNING_KEY, persistence });
  assert.equal(handled, true); assert.equal(res.statusCode, 200);
  return JSON.parse(body);
}

for (const [name, membership] of [
  ['verified visitor', { active: false, seen: true, verifiedByProduct: true }],
  ['unverified claimed member', { active: true, seen: true, verifiedByProduct: false }],
  ['absent member with residual metadata', { active: false, seen: false, verifiedByProduct: false }]
]) {
  test(`context redacts ${name} at every public path without deleting history`, async () => {
    const f = await fixture();
    const absent = await context(f);
    await f.persistence.putMembership({ globalUserId: f.userId, product: 'CREWCHECK', ...membership, productAccountId: 'private-crew-account', linkedAt: '2026-09-01T03:21:00Z', crewRole: 'CABIN_CREW' });
    await f.persistence.putSubscription({ globalUserId: f.userId, product: 'CREWCHECK', state: 'ACTIVE', renewsAt: '2027-06-01T00:00:00Z' });
    const stored = await f.persistence.getEcosystemProfile(f.userId);
    for (const granted of [null, true, false]) {
      if (granted !== null) await f.persistence.setConsent(f.userId, 'CREWCHECK_VOYAGE_CONNECTION', granted, { source: 'test' });
      const actual = await context(f);
      assert.deepEqual(actual.memberships.CREWCHECK, absent.memberships.CREWCHECK);
      assert.deepEqual(actual.identity.memberships.CREWCHECK, absent.identity.memberships.CREWCHECK);
      assert.deepEqual(actual.crewCheckDetection, absent.crewCheckDetection);
      assert.deepEqual(actual.identity.crewCheckDetection, absent.identity.crewCheckDetection);
      assert.deepEqual(actual.subscriptions, absent.subscriptions);
      assert.deepEqual(actual.entitlements, absent.entitlements);
      assert.deepEqual(actual.unifiedCalendar, absent.unifiedCalendar);
      assert.equal(actual.consents.CREWCHECK_VOYAGE_CONNECTION, granted === true);
      assert.doesNotMatch(JSON.stringify(actual), /private-crew-account|2026-09-01T03:21|2027-06-01|VISITOR/);
    }
    const after = await f.persistence.getEcosystemProfile(f.userId);
    assert.deepEqual(after.memberships, stored.memberships);
    assert.deepEqual(after.subscriptions, stored.subscriptions);
  });
}

test('active membership keeps the intended capability and revocation redacts it again', async () => {
  const f = await fixture();
  const membership = { globalUserId: f.userId, product: 'CREWCHECK', active: true, seen: true, verifiedByProduct: true, productAccountId: 'active-crew-account', crewRole: 'CABIN_CREW' };
  await f.persistence.putMembership(membership);
  await f.persistence.putSubscription({ globalUserId: f.userId, product: 'CREWCHECK', state: 'ACTIVE' });
  const active = await context(f);
  assert.equal(active.memberships.CREWCHECK.state, 'ACTIVE');
  assert.equal(active.crewCheckDetection.activeMember, true);
  assert.ok(active.entitlements.includes('CREWCHECK_PREMIUM'));
  assert.ok(active.entitlements.includes('UNIFIED_CALENDAR'));
  assert.equal(active.consents.CREWCHECK_VOYAGE_CONNECTION, false);
  assert.equal(active.unifiedCalendar.stillRequiresConnectionConsent, true);
  await f.persistence.putMembership({ ...membership, active: false });
  const revoked = await context(f);
  assert.equal(revoked.memberships.CREWCHECK.state, 'NONE');
  assert.equal(revoked.memberships.CREWCHECK.productAccountId, null);
  assert.equal(revoked.crewCheckDetection.linkedAccountDetected, false);
  assert.equal(revoked.entitlements.includes('CREWCHECK_PREMIUM'), false);
});
