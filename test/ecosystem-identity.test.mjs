import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoOperationalLeak, buildEcosystemIdentity, isCrewCheckMember, normalizeMembership } from '../src/ecosystem-identity.mjs';

test('a globalUserId is issued and memberships stay independent per product', () => {
  const identity = buildEcosystemIdentity({
    memberships: [
      { product: 'VOYAGE', verifiedByProduct: true, active: true },
      { product: 'CREWCHECK', seen: true }
    ]
  });
  assert.match(identity.globalUserId, /^gid_/);
  assert.equal(identity.memberships.VOYAGE.state, 'ACTIVE');
  assert.equal(identity.memberships.CREWCHECK.state, 'VISITOR');
});

test('an unverified CrewCheck visitor is never treated as a member', () => {
  const identity = buildEcosystemIdentity({
    memberships: [{ product: 'CREWCHECK', seen: true, active: true, crewRole: 'PILOT' }]
  });
  assert.equal(identity.memberships.CREWCHECK.state, 'VISITOR');
  assert.equal(isCrewCheckMember(identity), false);
  // An unverified caller must not be able to assert a crew role.
  assert.equal(identity.memberships.CREWCHECK.crewRole, null);
});

test('a verified active CrewCheck membership is detected silently, never by prompting', () => {
  const identity = buildEcosystemIdentity({
    memberships: [{ product: 'CREWCHECK', verifiedByProduct: true, active: true, crewRole: 'CABIN_CREW' }]
  });
  assert.equal(isCrewCheckMember(identity), true);
  assert.equal(identity.crewCheckDetection.detectionMethod, 'SILENT_IDENTITY_GRAPH');
  assert.equal(identity.crewCheckDetection.mustNotPromptUser, true);
});

test('a user with no CrewCheck account exposes no detection signal', () => {
  const identity = buildEcosystemIdentity({ memberships: [{ product: 'VOYAGE', verifiedByProduct: true, active: true }] });
  assert.equal(identity.crewCheckDetection.linkedAccountDetected, false);
  assert.equal(identity.crewCheckDetection.detectionMethod, null);
});

test('nothing is shared across products by default', () => {
  const identity = buildEcosystemIdentity({});
  assert.deepEqual(identity.dataBoundary.sharedByDefault, []);
  assert.equal(identity.dataBoundary.requiresExplicitConnectionConsent, true);
});

test('CrewCheck operational fields are rejected from a Voyage personal record', () => {
  assert.equal(assertNoOperationalLeak({ personal_trips: [] }).ok, true);
  const leak = assertNoOperationalLeak({ DUTY_ROSTER: [], personal_trips: [] });
  assert.equal(leak.ok, false);
  assert.deepEqual(leak.leaked, ['DUTY_ROSTER']);
});

test('an unknown product is not turned into a membership', () => {
  assert.equal(normalizeMembership({ product: 'AIRLINE_X', verifiedByProduct: true, active: true }), null);
});
