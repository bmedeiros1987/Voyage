import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJourneyReadiness, journeyReadinessCapabilities } from '../src/journey-readiness.mjs';

test('capabilities expose end-to-end readiness dimensions', () => {
  const capabilities = journeyReadinessCapabilities();
  assert.ok(capabilities.dimensions.includes('TRANSPORT_CONTINUITY'));
  assert.ok(capabilities.dimensions.includes('LOCAL_CASH'));
  assert.ok(capabilities.dimensions.includes('OFFLINE_ACCESS'));
});

test('missing inter-airport transfer blocks readiness', () => {
  const result = buildJourneyReadiness({
    documents: { valid: true },
    transport: { continuityComplete: true },
    lodging: { allNightsCovered: true },
    budget: { configured: true, remainingAmount: 1000 },
    airportConnections: { interAirportRequired: true, transferResolved: false }
  });

  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes('AIRPORT_CONNECTIONS'));
  assert.equal(result.nextActions[0].action, 'RESOLVE_INTER_AIRPORT_CONNECTION');
});

test('international trip without local cash produces warning not blocker', () => {
  const result = buildJourneyReadiness({
    documents: { valid: true },
    transport: { continuityComplete: true },
    lodging: { allNightsCovered: true },
    budget: { configured: true, remainingAmount: 5000 },
    localCash: { internationalTrip: true, localCurrencyAvailable: false },
    airportConnections: { interAirportRequired: false }
  });

  assert.equal(result.status, 'ATTENTION');
  assert.ok(result.warnings.includes('LOCAL_CASH'));
  assert.ok(result.nextActions.some((item) => item.action === 'ASK_USER_TO_DEFINE_LOCAL_CASH_RESERVE'));
});

test('checked bag with unresolved connection pickup rule produces baggage warning', () => {
  const result = buildJourneyReadiness({
    documents: { valid: true },
    transport: { continuityComplete: true },
    lodging: { required: false },
    budget: { configured: true, remainingAmount: 1200 },
    baggage: { checkedBag: true, connectionRequiresDecision: true, pickupRuleKnown: false },
    airportConnections: { interAirportRequired: false },
    localCash: { required: false }
  });

  assert.equal(result.status, 'ATTENTION');
  assert.ok(result.warnings.includes('BAGGAGE'));
  assert.ok(result.nextActions.some((item) => item.action === 'VERIFY_BAGGAGE_PICKUP_RULE'));
});

test('trip near departure without offline pack generates actionable warning', () => {
  const result = buildJourneyReadiness({
    documents: { valid: true },
    transport: { continuityComplete: true },
    lodging: { required: false },
    budget: { configured: true, remainingAmount: 1500 },
    localCash: { required: false },
    baggage: { checkedBag: false },
    airportConnections: { interAirportRequired: false },
    weather: { forecastFresh: true },
    offline: { departureWithinHours: 8, tripPackCached: false }
  });

  assert.equal(result.status, 'ATTENTION');
  assert.ok(result.warnings.includes('OFFLINE_ACCESS'));
  assert.ok(result.nextActions.some((item) => item.action === 'CACHE_CRITICAL_TRIP_DATA'));
});

test('fully resolved journey is ready and never auto-mutates itinerary', () => {
  const result = buildJourneyReadiness({
    documents: { valid: true },
    transport: { continuityComplete: true },
    lodging: { allNightsCovered: true },
    budget: { configured: true, remainingAmount: 3000 },
    localCash: { internationalTrip: true, localCurrencyAvailable: true, emergencyReserveCovered: true },
    baggage: { checkedBag: true, pickupRuleKnown: true },
    airportConnections: { interAirportRequired: true, transferResolved: true },
    weather: { forecastFresh: true },
    offline: { tripPackCached: true, criticalMapsCached: true },
    emergency: { emergencyContactsConfigured: true }
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.score, 100);
  assert.equal(result.automaticChangesAllowed, false);
  assert.equal(result.userApprovalRequiredForItineraryMutation, true);
});
