import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDietaryTravelCard,
  buildGroupDietarySummary,
  dietaryCapabilities,
  evaluateFoodCandidate,
  normalizeDietaryProfile
} from '../src/dietary-profile.mjs';

test('normalizes dietary restrictions and severe allergy safety flags', () => {
  const profile = normalizeDietaryProfile({
    restrictions: [
      { code: 'PEANUT', severity: 'SEVERE_ALLERGY' },
      { code: 'LACTOSE', severity: 'INTOLERANCE' },
      { code: 'VEGETARIAN', severity: 'PREFERENCE' }
    ]
  });
  assert.equal(profile.avoidsCrossContact, true);
  assert.equal(profile.requiresStaffConfirmation, true);
  assert.equal(profile.restrictions.length, 3);
});

test('food candidate fails closed when allergen status or cross-contact is unknown', () => {
  const result = evaluateFoodCandidate({
    title: 'Café',
    dietary: { PEANUT: 'UNKNOWN' },
    crossContact: 'UNKNOWN',
    dietaryConfidence: 'USER_REPORTED'
  }, {
    restrictions: [{ code: 'PEANUT', severity: 'SEVERE_ALLERGY' }]
  });

  assert.equal(result.safe, false);
  assert.equal(result.eligibleForAutomaticRecommendation, false);
  assert.ok(result.blockers.includes('ALLERGEN_STATUS_UNKNOWN:PEANUT'));
  assert.ok(result.blockers.includes('CROSS_CONTACT_UNKNOWN'));
});

test('verified supported preference can be ranked while allergy conflict is blocked', () => {
  const preference = evaluateFoodCandidate({
    dietary: { VEGAN: 'SUPPORTED' },
    crossContact: 'UNKNOWN',
    dietaryConfidence: 'MENU_VERIFIED'
  }, { restrictions: [{ code: 'VEGAN', severity: 'PREFERENCE' }] });
  assert.equal(preference.safe, true);
  assert.ok(preference.matchedPreferences.includes('VEGAN'));

  const allergy = evaluateFoodCandidate({
    dietary: { EGG: 'CONTAINS' },
    crossContact: 'SAFE',
    dietaryConfidence: 'MENU_VERIFIED'
  }, { restrictions: [{ code: 'EGG', severity: 'ALLERGY' }] });
  assert.equal(allergy.safe, false);
  assert.ok(allergy.blockers.includes('KNOWN_CONFLICT:EGG'));
});

test('group summary keeps strictest shared constraint without exposing private detail', () => {
  const summary = buildGroupDietarySummary([
    { travellerId: 'a', profile: { restrictions: [{ code: 'GLUTEN', severity: 'INTOLERANCE' }] } },
    { travellerId: 'b', profile: { restrictions: [{ code: 'GLUTEN', severity: 'ALLERGY' }, { code: 'HALAL', severity: 'PREFERENCE' }] } }
  ]);
  assert.deepEqual(summary.hardConstraints, [{ code: 'GLUTEN', severity: 'ALLERGY' }]);
  assert.ok(summary.preferences.includes('HALAL'));
  assert.match(summary.privacyPolicy, /explicit sharing/i);
});

test('offline dietary travel card and capabilities are available', () => {
  const card = buildDietaryTravelCard({ restrictions: [{ code: 'TREE_NUT', severity: 'ALLERGY' }] }, 'pt-BR');
  assert.equal(card.designedForOfflineAccess, true);
  assert.equal(card.serious.length, 1);
  assert.equal(dietaryCapabilities().supportsCrossContact, true);
});
