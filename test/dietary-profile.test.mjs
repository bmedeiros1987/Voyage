import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDietaryTravelCard,
  buildFoodDiscoveryQuery,
  buildGroupDietarySummary,
  dietaryCapabilities,
  evaluateFoodCandidate,
  normalizeDietaryProfile
} from '../src/dietary-profile.mjs';

test('dietary profile defaults to food discovery, with optional safety mode for allergy', () => {
  const preference = normalizeDietaryProfile({ restrictions: ['VEGAN', 'LACTOSE'] });
  assert.equal(preference.primaryPurpose, 'FOOD_DISCOVERY');
  assert.equal(preference.safetyMode, false);

  const allergy = normalizeDietaryProfile({ restrictions: [{ code: 'PEANUT', severity: 'SEVERE_ALLERGY' }] });
  assert.equal(allergy.safetyMode, true);
  assert.equal(allergy.avoidsCrossContact, true);
});

test('food discovery ranks supported restrictions without turning unknown preference into a medical blocker', () => {
  const result = evaluateFoodCandidate({
    title: 'Café',
    cuisine: 'ITALIAN',
    dietary: { VEGAN: 'SUPPORTED', LACTOSE: 'UNKNOWN' },
    dietaryConfidence: 'MENU_VERIFIED'
  }, {
    restrictions: ['VEGAN', 'LACTOSE'],
    preferredCuisines: ['ITALIAN']
  });

  assert.equal(result.discoveryEligible, true);
  assert.equal(result.safe, null);
  assert.ok(result.matchedPreferences.includes('VEGAN'));
  assert.ok(result.discoverySignals.includes('CUISINE_MATCH:ITALIAN'));
  assert.ok(result.warnings.includes('DIETARY_STATUS_UNKNOWN:LACTOSE'));
});

test('explicit allergy safety mode can still fail closed', () => {
  const result = evaluateFoodCandidate({
    dietary: { PEANUT: 'UNKNOWN' },
    crossContact: 'UNKNOWN',
    dietaryConfidence: 'USER_REPORTED'
  }, {
    restrictions: [{ code: 'PEANUT', severity: 'SEVERE_ALLERGY' }]
  });
  assert.equal(result.safetyMode, true);
  assert.equal(result.discoveryEligible, false);
  assert.ok(result.blockers.includes('ALLERGEN_STATUS_UNKNOWN:PEANUT'));
});

test('food discovery query targets restaurants and culinary places with itinerary ranking signals', () => {
  const query = buildFoodDiscoveryQuery({
    restrictions: ['VEGETARIAN'],
    preferredCuisines: ['ITALIAN'],
    preferredFoodPlaceTypes: ['RESTAURANT', 'CAFE']
  }, { meal: 'LUNCH', near: 'Museu do Prado' });

  assert.equal(query.purpose, 'FIND_FOOD_PLACES');
  assert.deepEqual(query.preferredFoodPlaceTypes, ['RESTAURANT', 'CAFE']);
  assert.ok(query.rankingSignals.includes('travel_time'));
  assert.ok(query.rankingSignals.includes('dietary_fit'));
});

test('group summary combines food discovery preferences while preserving optional hard allergy constraints', () => {
  const summary = buildGroupDietarySummary([
    { travellerId: 'a', profile: { restrictions: ['VEGETARIAN'] } },
    { travellerId: 'b', profile: { restrictions: [{ code: 'GLUTEN', severity: 'ALLERGY' }, { code: 'HALAL', severity: 'PREFERENCE' }] } }
  ]);
  assert.deepEqual(summary.hardConstraints, [{ code: 'GLUTEN', severity: 'ALLERGY' }]);
  assert.ok(summary.preferences.includes('VEGETARIAN'));
  assert.ok(summary.preferences.includes('HALAL'));
  assert.match(summary.privacyPolicy, /food-planning/i);
});

test('offline food preference card and capabilities are available', () => {
  const card = buildDietaryTravelCard({ restrictions: ['VEGAN'] }, 'pt-BR');
  assert.equal(card.designedForOfflineAccess, true);
  assert.equal(card.title, 'Preferências alimentares');
  assert.equal(dietaryCapabilities().primaryPurpose, 'FOOD_DISCOVERY_AND_RANKING');
});
