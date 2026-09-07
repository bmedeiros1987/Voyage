import test from 'node:test';
import assert from 'node:assert/strict';
import { gateFeature, resolveEntitlements } from '../src/entitlements.mjs';

const CREW_ACTIVE = { CREWCHECK: { state: 'ACTIVE' } };

test('Voyage Premium alone unlocks Unified Calendar', () => {
  const resolved = resolveEntitlements({ subscriptions: [{ product: 'VOYAGE', state: 'ACTIVE' }] });
  assert.ok(resolved.entitlements.includes('VOYAGE_PREMIUM'));
  assert.equal(resolved.unifiedCalendar.entitled, true);
  assert.deepEqual(resolved.unifiedCalendar.grantedBy, ['VOYAGE_PREMIUM']);
});

test('Voyage Premium + CrewCheck Free is a supported combination', () => {
  const resolved = resolveEntitlements({
    subscriptions: [{ product: 'VOYAGE', state: 'ACTIVE' }],
    memberships: CREW_ACTIVE
  });
  assert.equal(resolved.entitlements.includes('CREWCHECK_PREMIUM'), false);
  assert.equal(resolved.unifiedCalendar.entitled, true);
});

test('CrewCheck Premium alone also unlocks Unified Calendar', () => {
  const resolved = resolveEntitlements({
    subscriptions: [{ product: 'CREWCHECK', state: 'ACTIVE' }],
    memberships: CREW_ACTIVE
  });
  assert.deepEqual(resolved.unifiedCalendar.grantedBy, ['CREWCHECK_PREMIUM']);
  assert.equal(resolved.unifiedCalendar.entitled, true);
});

test('CrewCheck Premium without an active CrewCheck membership grants nothing', () => {
  const resolved = resolveEntitlements({
    subscriptions: [{ product: 'CREWCHECK', state: 'ACTIVE' }],
    memberships: { CREWCHECK: { state: 'VISITOR' } }
  });
  assert.equal(resolved.entitlements.includes('CREWCHECK_PREMIUM'), false);
  assert.equal(resolved.unifiedCalendar.entitled, false);
});

test('no premium subscription means no Unified Calendar', () => {
  const resolved = resolveEntitlements({ subscriptions: [{ product: 'VOYAGE', state: 'EXPIRED' }] });
  assert.equal(resolved.unifiedCalendar.entitled, false);
  const gate = gateFeature('UNIFIED_CALENDAR', { entitlements: resolved.entitlements, consents: {} });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, 'ENTITLEMENT_REQUIRED');
});

test('a subscription is never consent: entitled but unconnected is still blocked', () => {
  const resolved = resolveEntitlements({ subscriptions: [{ product: 'VOYAGE', state: 'ACTIVE' }] });
  const gate = gateFeature('UNIFIED_CALENDAR', { entitlements: resolved.entitlements, consents: {} });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, 'CONNECTION_CONSENT_REQUIRED');
  assert.equal(gate.consentRequired, true);
});

test('entitlement plus explicit opt-in consent allows the feature', () => {
  const resolved = resolveEntitlements({ subscriptions: [{ product: 'VOYAGE', state: 'ACTIVE' }] });
  const gate = gateFeature('UNIFIED_CALENDAR', {
    entitlements: resolved.entitlements,
    consents: { CREWCHECK_VOYAGE_CONNECTION: true }
  });
  assert.equal(gate.allowed, true);
});

test('a grace-period subscription still entitles', () => {
  const resolved = resolveEntitlements({ subscriptions: [{ product: 'VOYAGE', state: 'GRACE' }] });
  assert.equal(resolved.unifiedCalendar.entitled, true);
});
