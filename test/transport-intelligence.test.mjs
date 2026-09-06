import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTransportChoice,
  normalizeTransportPreferences,
  transportIntelligenceCapabilities
} from '../src/transport-intelligence.mjs';

test('ordinary passenger excludes flight unless the user explicitly asks for it', () => {
  const result = buildTransportChoice({
    preferences: { userType: 'PASSENGER' },
    options: [
      { id: 'metro', modes: ['WALK', 'METRO'], doorToDoorMinutes: 38, costAmount: 3, transfers: 1, reliabilityScore: 0.9 },
      { id: 'flight', modes: ['RIDESHARE', 'FLIGHT'], doorToDoorMinutes: 55, costAmount: 90, transfers: 1, reliabilityScore: 0.8 }
    ]
  });
  assert.equal(result.recommended.id, 'metro');
  assert.ok(result.excluded.some((item) => item.id === 'flight' && item.reasons.includes('FLIGHT_NOT_REQUESTED_FOR_PASSENGER')));
});

test('passenger can explicitly opt in to flight comparison', () => {
  const preferences = normalizeTransportPreferences({ userType: 'PASSENGER', includeFlight: true });
  assert.equal(preferences.flightEligible, true);
  assert.equal(preferences.explicitFlightOptIn, true);
});

test('crew member may compare flight without making it the automatic default', () => {
  const result = buildTransportChoice({
    preferences: { userType: 'CREW_MEMBER' },
    options: [
      { id: 'rail', modes: ['TRAIN'], doorToDoorMinutes: 70, costAmount: 25, transfers: 0, reliabilityScore: 0.92, comfortScore: 0.8, provider: 'synthetic' },
      { id: 'air', modes: ['RIDESHARE', 'FLIGHT'], doorToDoorMinutes: 72, costAmount: 60, transfers: 1, reliabilityScore: 0.8, comfortScore: 0.7, provider: 'synthetic' }
    ]
  });
  assert.equal(result.excluded.length, 0);
  assert.equal(result.recommended.id, 'rail');
});

test('multimodal comparison can identify different best options instead of forcing one answer', () => {
  const result = buildTransportChoice({
    preferences: { userType: 'PASSENGER', priorities: { time: 1.2, cost: 0.8, simplicity: 0.9 } },
    options: [
      { id: 'metro', title: 'Caminhada + metrô', modes: ['WALK', 'METRO'], doorToDoorMinutes: 35, costAmount: 4, transfers: 1, walkingMinutes: 9, reliabilityScore: 0.92, weatherExposure: 'MEDIUM', provider: 'synthetic' },
      { id: 'taxi', title: 'Táxi', modes: ['TAXI'], doorToDoorMinutes: 25, costAmount: 22, transfers: 0, walkingMinutes: 1, reliabilityScore: 0.78, weatherExposure: 'LOW', provider: 'synthetic' },
      { id: 'bus', title: 'Ônibus', modes: ['BUS'], doorToDoorMinutes: 42, costAmount: 2, transfers: 0, walkingMinutes: 4, reliabilityScore: 0.86, weatherExposure: 'LOW', provider: 'synthetic' }
    ]
  });
  assert.equal(result.highlights.fastestId, 'taxi');
  assert.equal(result.highlights.lowestCostId, 'bus');
  assert.ok(result.recommended);
  assert.ok(result.alternatives.length >= 1);
});

test('unknown transport facts remain provider needs instead of being invented', () => {
  const result = buildTransportChoice({
    preferences: { userType: 'PASSENGER' },
    options: [{ id: 'train', modes: ['TRAIN'], provider: 'synthetic' }]
  });
  assert.ok(result.providerNeeds.includes('DOOR_TO_DOOR_TIME'));
  assert.ok(result.providerNeeds.includes('FARE_OR_PRICE'));
  assert.equal(result.recommended.doorToDoorMinutes, null);
  assert.equal(result.recommended.costAmount, null);
});

test('transport intelligence never books or mutates itinerary without user approval', () => {
  const result = buildTransportChoice({
    options: [{ id: 'walk', modes: ['WALK'], doorToDoorMinutes: 12, costAmount: 0, reliabilityScore: 0.95 }]
  });
  assert.equal(result.decisionPolicy.bookingAllowedAutomatically, false);
  assert.equal(result.decisionPolicy.itineraryMutationAllowed, false);
  assert.equal(result.decisionPolicy.userApprovalRequired, true);
});

test('capabilities are multimodal and explicitly ground-first for passengers', () => {
  const capabilities = transportIntelligenceCapabilities();
  assert.ok(capabilities.modes.includes('METRO'));
  assert.ok(capabilities.modes.includes('TRAIN'));
  assert.ok(capabilities.modes.includes('RIDESHARE'));
  assert.equal(capabilities.flightPolicy.passengerDefault, 'EXCLUDED_UNLESS_USER_OPT_IN');
});
