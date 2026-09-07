import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTravelHealthPlan, travelHealthIntelligenceCapabilities } from '../src/travel-health-intelligence.mjs';

const freshWhoRule = {
  id: 'yf-gh',
  vaccine: 'YELLOW_FEVER',
  classification: 'ENTRY_REQUIRED',
  countryCode: 'GH',
  applies: true,
  sourceFresh: true,
  certificateType: 'ICVP',
  validFromDaysAfter: 10,
  source: { authority: 'WHO', observedAt: '2026-09-01T00:00:00Z' }
};

test('capabilities separate legal entry rules from health recommendations', () => {
  const capabilities = travelHealthIntelligenceCapabilities();
  assert.ok(capabilities.classifications.includes('ENTRY_REQUIRED'));
  assert.ok(capabilities.classifications.includes('RECOMMENDED'));
  assert.equal(capabilities.yellowFever.primaryDoseValidAfterDays, 10);
  assert.equal(capabilities.yellowFever.certificateValidity, 'LIFETIME');
  assert.equal(capabilities.medicalTreatmentDecisionAllowedAutomatically, false);
});

test('missing required vaccine blocks travel readiness', () => {
  const result = buildTravelHealthPlan({
    now: '2026-09-07T12:00:00Z',
    itinerary: [{ countryCode: 'GH', arrivalDate: '2026-10-10' }],
    requirements: [freshWhoRule],
    vaccinationRecords: [],
    rulesCoverageKnown: true
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.entryBlockers.length, 1);
  assert.equal(result.entryBlockers[0].vaccine, 'YELLOW_FEVER');
  assert.ok(result.alerts.some((alert) => alert.type === 'TRAVEL_VACCINE_ENTRY_BLOCKER'));
});

test('yellow fever primary certificate must be valid by arrival date', () => {
  const result = buildTravelHealthPlan({
    now: '2026-09-07T12:00:00Z',
    itinerary: [{ countryCode: 'GH', arrivalDate: '2026-09-15' }],
    requirements: [freshWhoRule],
    vaccinationRecords: [{
      vaccine: 'YELLOW_FEVER',
      administeredAt: '2026-09-10',
      certificateType: 'ICVP',
      certificatePresent: true
    }],
    rulesCoverageKnown: true
  });

  assert.equal(result.status, 'BLOCKED');
  assert.match(result.requirements[0].summary, /ainda não estará válido/);
  assert.equal(result.requirements[0].validFrom, '2026-09-20');
});

test('old yellow fever vaccination can remain travel-valid when a proper ICVP is present', () => {
  const result = buildTravelHealthPlan({
    now: '2026-09-07T12:00:00Z',
    itinerary: [{ countryCode: 'GH', arrivalDate: '2026-10-10' }],
    requirements: [freshWhoRule],
    vaccinationRecords: [{
      vaccine: 'YELLOW_FEVER',
      administeredAt: '2012-05-03',
      certificateType: 'ICVP',
      certificatePresent: true
    }],
    rulesCoverageKnown: true
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.entryBlockers.length, 0);
  assert.equal(result.requirements[0].status, 'COMPLETE');
});

test('conditional transit rule stays unresolved until itinerary condition is known', () => {
  const result = buildTravelHealthPlan({
    itinerary: [{ countryCode: 'PA', arrivalDate: '2026-10-10', transit: true, transitHours: 8 }],
    requirements: [{
      vaccine: 'YELLOW_FEVER',
      classification: 'ENTRY_CONDITIONAL',
      countryCode: 'PA',
      appliesToTransit: true,
      conditionStatus: 'UNKNOWN',
      sourceFresh: true,
      source: { authority: 'National border authority', observedAt: '2026-09-01' }
    }],
    rulesCoverageKnown: true
  });

  assert.equal(result.status, 'ATTENTION');
  assert.equal(result.requirements[0].status, 'VERIFY_RULE');
  assert.equal(result.requirements[0].action, 'RESOLVE_CONDITIONAL_ENTRY_VACCINE_RULE');
});

test('recommended vaccine creates health action but not an entry blocker', () => {
  const result = buildTravelHealthPlan({
    itinerary: [{ countryCode: 'XX', arrivalDate: '2026-11-01' }],
    requirements: [{
      vaccine: 'HEPATITIS_A',
      classification: 'RECOMMENDED',
      countryCode: 'XX',
      applies: true,
      sourceFresh: true,
      source: { authority: 'CDC Travelers Health', observedAt: '2026-09-01' }
    }],
    vaccinationRecords: [],
    rulesCoverageKnown: true
  });

  assert.equal(result.status, 'ATTENTION');
  assert.equal(result.entryBlockers.length, 0);
  assert.equal(result.requirements[0].status, 'ACTION_NEEDED');
});

test('possible medical eligibility issue routes to clinician instead of prescribing vaccination', () => {
  const result = buildTravelHealthPlan({
    itinerary: [{ countryCode: 'GH', arrivalDate: '2026-10-10' }],
    requirements: [{ ...freshWhoRule, medicalEligibilityKnown: false }],
    vaccinationRecords: [],
    rulesCoverageKnown: true
  });

  assert.equal(result.status, 'ATTENTION');
  assert.equal(result.requirements[0].status, 'CLINICIAN_REVIEW');
  assert.equal(result.policy.medicalTreatmentDecisionAllowedAutomatically, false);
});

test('international itinerary with no loaded rule coverage fails safe', () => {
  const result = buildTravelHealthPlan({
    itinerary: [{ countryCode: 'ZA', arrivalDate: '2026-10-10' }],
    requirements: [],
    rulesCoverageKnown: false
  });

  assert.equal(result.status, 'NEEDS_RULE_DATA');
  assert.ok(result.alerts.some((alert) => alert.type === 'TRAVEL_HEALTH_RULE_DATA_REQUIRED'));
});
