import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJourneyReadiness, journeyReadinessCapabilities } from '../src/journey-readiness.mjs';
import { buildJourneyCommandCenter, journeyCommandCenterCapabilities } from '../src/journey-command-center.mjs';
import { intelligenceHttpCapabilities } from '../src/intelligence-http.mjs';

test('journey readiness exposes travel health dimension without injecting an unevaluated health check into legacy trips', () => {
  const capabilities = journeyReadinessCapabilities();
  assert.ok(capabilities.dimensions.includes('TRAVEL_HEALTH'));

  const legacy = buildJourneyReadiness({
    documents: { valid: true },
    transport: { continuityComplete: true },
    lodging: { allNightsCovered: true },
    budget: { configured: true, remainingAmount: 3000 },
    localCash: { required: false },
    baggage: { checkedBag: false },
    airportConnections: { interAirportRequired: false },
    weather: { forecastFresh: true },
    offline: { tripPackCached: true, criticalMapsCached: true },
    emergency: { emergencyContactsConfigured: true }
  });

  assert.equal(legacy.status, 'READY');
  assert.equal(legacy.checks.some((check) => check.dimension === 'TRAVEL_HEALTH'), false);
});

test('missing mandatory vaccine becomes a readiness blocker through command center', () => {
  const command = buildJourneyCommandCenter({
    travelHealth: {
      rulesCoverageKnown: true,
      itinerary: [{ countryCode: 'GH', arrivalDate: '2026-10-10' }],
      requirements: [{
        vaccine: 'YELLOW_FEVER',
        classification: 'ENTRY_REQUIRED',
        countryCode: 'GH',
        applies: true,
        sourceFresh: true,
        certificateType: 'ICVP',
        source: { authority: 'WHO', observedAt: '2026-09-01' }
      }],
      vaccinationRecords: []
    },
    readiness: {
      documents: { valid: true },
      transport: { continuityComplete: true },
      lodging: { required: false },
      budget: { configured: true, remainingAmount: 1000 },
      localCash: { required: false },
      baggage: { checkedBag: false },
      airportConnections: { interAirportRequired: false }
    }
  });

  assert.equal(command.travelHealth.status, 'BLOCKED');
  assert.ok(command.readiness.blockers.includes('TRAVEL_HEALTH'));
  assert.ok(command.alerts.some((alert) => alert.type === 'TRAVEL_VACCINE_ENTRY_BLOCKER'));
  assert.ok(command.alerts.some((alert) => alert.type === 'READINESS_BLOCKER_TRAVEL_HEALTH'));
  assert.equal(command.mutationPolicy.automaticMutationAllowed, false);
});

test('unmet recommended vaccine warns but does not become entry blocker', () => {
  const readiness = buildJourneyReadiness({
    travelHealth: {
      evaluated: true,
      entryRequirementsSatisfied: true,
      requiredMissing: 0,
      recommendationsOutstanding: 1,
      clinicianReviewRequired: false,
      ruleVerificationRequired: false
    },
    documents: { valid: true },
    transport: { continuityComplete: true },
    lodging: { required: false },
    budget: { configured: true, remainingAmount: 1000 },
    localCash: { required: false },
    baggage: { checkedBag: false },
    airportConnections: { interAirportRequired: false }
  });

  assert.equal(readiness.status, 'ATTENTION');
  assert.ok(readiness.warnings.includes('TRAVEL_HEALTH'));
  assert.ok(readiness.nextActions.some((item) => item.action === 'REVIEW_RECOMMENDED_TRAVEL_VACCINES'));
});

test('unified intelligence API exposes travel health routes', () => {
  const api = intelligenceHttpCapabilities();
  assert.ok(api.getRoutes.includes('/api/v1/travel-health/capabilities'));
  assert.ok(api.postRoutes.includes('/api/v1/travel-health/plan'));
  assert.equal(api.policy.automaticItineraryMutationAllowed, false);
});

test('command center advertises travel health layer', () => {
  const capabilities = journeyCommandCenterCapabilities();
  assert.ok(capabilities.layers.includes('TRAVEL_HEALTH'));
});
