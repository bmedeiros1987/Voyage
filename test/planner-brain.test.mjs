import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessPlanQuality,
  buildPlanningBrief,
  buildPlanningStrategy,
  buildPreferenceLearningEvent,
  buildReplanDecision,
  plannerBrainCapabilities
} from '../src/planner-brain.mjs';

test('planner brain uses a full travel planning method instead of attraction list', () => {
  const capabilities = plannerBrainCapabilities();
  assert.ok(capabilities.phases.includes('LOCK_HARD_ANCHORS'));
  assert.ok(capabilities.phases.includes('PLACE_MEALS_WORK_REST'));
  assert.ok(capabilities.phases.includes('MONITOR_AND_REPLAN'));
});

test('brief treats imported Maps places as intent signals and asks only high impact missing inputs', () => {
  const brief = buildPlanningBrief({
    trip: { destination: 'Roma', startDate: '2027-05-12', endDate: '2027-05-14', arrivalAt: '2027-05-12T10:00:00Z', departureAt: '2027-05-14T18:00:00Z' },
    intent: { style: 'RELAXED', interests: ['food', 'culture'], foodInterest: 0.9 },
    importedPlaces: [{ title: 'Coliseu', source: 'GOOGLE_MAPS', userPinned: true }]
  });
  assert.equal(brief.status, 'READY_FOR_RESEARCH');
  assert.equal(brief.importedPlaces[0].userPinned, true);
  assert.equal(brief.dayTypes[0].type, 'ARRIVAL');
  assert.equal(brief.dayTypes.at(-1).type, 'DEPARTURE');
  assert.ok(brief.researchNeeds.includes('FOOD_DISCOVERY'));
});

test('strategy protects free time for relaxed users and prioritizes feasibility', () => {
  const strategy = buildPlanningStrategy({
    trip: { destination: 'Lisboa', startDate: '2027-06-10', endDate: '2027-06-12' },
    intent: { style: 'RELAXED', protectFreeTime: true, foodInterest: 0.8 }
  });
  assert.equal(strategy.freeTimePolicy.protect, true);
  assert.equal(strategy.freeTimePolicy.recommendedDailyMinutes, 150);
  assert.equal(strategy.priorities[0].dimension, 'HARD_CONSTRAINT_COMPLIANCE');
});

test('plan quality fails when hard constraints or impossible transitions exist', () => {
  const quality = assessPlanQuality({
    items: [
      { id: 'flight', hardConstraintViolated: true },
      { id: 'museum', previousLocationId: 'hotel', travelTimeKnown: false, requiresOpeningHours: true, openingHoursKnown: false },
      { id: 'dinner', transitionMinutes: -15 }
    ]
  });
  assert.equal(quality.feasible, false);
  assert.equal(quality.grade, 'REPLAN');
  assert.ok(quality.violations.some((item) => item.startsWith('HARD_CONSTRAINT')));
  assert.ok(quality.violations.some((item) => item.startsWith('IMPOSSIBLE_TRANSITION')));
});

test('replanning repairs smallest scope and preserves locked items', () => {
  const decision = buildReplanDecision({ changeType: 'RUNNING_LATE', lockedItems: [{ id: 'show' }] });
  assert.deepEqual(decision.preserve, ['SHOW']);
  assert.ok(decision.actions.includes('REMOVE_LOWEST_VALUE_OPTIONAL_STOP'));
  assert.match(decision.policy, /smallest affected scope/i);
});

test('explicit preference learning outranks inferred behavior and remains reversible', () => {
  const explicit = buildPreferenceLearningEvent({ source: 'EXPLICIT_PREFERENCE', dimension: 'PACE', value: 'RELAXED' });
  const inferred = buildPreferenceLearningEvent({ source: 'SKIPPED', dimension: 'NIGHTLIFE', value: false });
  assert.equal(explicit.confidence, 1);
  assert.ok(inferred.confidence < explicit.confidence);
  assert.equal(inferred.mayOverrideHardPreference, false);
  assert.equal(explicit.reversible, true);
});
