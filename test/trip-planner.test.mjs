import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAutomaticPlan,
  buildExportManifest,
  collaborationCapabilities,
  normalizeExternalItinerary,
  plannerCapabilities
} from '../src/trip-planner.mjs';

test('planner asks about flexible breakfast and builds meal/work/fitness skeleton', () => {
  const result = buildAutomaticPlan({
    trip: { title: 'Lisboa', startDate: '2027-06-10', endDate: '2027-06-11', timeZone: 'Europe/Lisbon' },
    profile: {
      pace: 'RELAXED',
      breakfastMode: 'FLEXIBLE',
      mealWindows: { lunch: { start: '12:30', end: '14:00' } },
      workNeeds: { enabled: true, requiresQuietPlace: true },
      fitness: { enabled: true, gymRequired: true, preferredDurationMinutes: 50 }
    },
    workBlocks: [{ title: 'Reunião', startsAt: '2027-06-10T14:00:00Z', endsAt: '2027-06-10T15:00:00Z' }]
  });

  assert.equal(result.trip.title, 'Lisboa');
  assert.equal(result.daySkeletons.length, 2);
  assert.ok(result.questions.some((item) => item.id === 'BREAKFAST_PREFERENCE'));
  assert.ok(result.daySkeletons[0].anchors.some((item) => item.kind === 'LUNCH'));
  assert.ok(result.daySkeletons[0].anchors.some((item) => item.kind === 'WORK'));
  assert.ok(result.daySkeletons[0].anchors.some((item) => item.kind === 'FITNESS'));
});

test('planner ranks verified community and preference signals without inventing distance', () => {
  const result = buildAutomaticPlan({
    trip: { startDate: '2027-06-10', endDate: '2027-06-10' },
    profile: { preferredActivityTypes: ['CULTURE'], interestTags: ['ART'] },
    candidates: [
      { id: 'museum', title: 'Museu', type: 'CULTURE', locationId: 'M', rating: 4.7, communityRating: 4.8, communityCount: 400, tags: ['ART'] },
      { id: 'mall', title: 'Shopping', type: 'SHOPPING', locationId: 'S', rating: 4.9 }
    ],
    startLocationId: 'H'
  });

  assert.equal(result.recommendations.rankedCandidates[0].id, 'museum');
  assert.equal(result.recommendations.routeSuggestion.stops[0].candidateId, 'museum');
  assert.equal(result.recommendations.routeSuggestion.stops[0].travelTimeKnown, false);
  assert.equal(result.recommendations.routeSuggestion.requiresDistanceProvider, false);
});

test('route preview uses supplied travel matrix and prefers reasonable next stop', () => {
  const result = buildAutomaticPlan({
    trip: { startDate: '2027-06-10', endDate: '2027-06-10' },
    profile: { pace: 'BALANCED', preferredActivityTypes: ['FOOD'] },
    candidates: [
      { id: 'near', title: 'Perto', type: 'FOOD', locationId: 'N', rating: 4.5 },
      { id: 'far', title: 'Longe', type: 'FOOD', locationId: 'F', rating: 4.7 }
    ],
    startLocationId: 'H',
    travelMinutes: { 'H|N': 5, 'H|F': 90, 'N|F': 100 }
  });

  assert.equal(result.recommendations.routeSuggestion.stops[0].candidateId, 'near');
  assert.equal(result.recommendations.routeSuggestion.stops[0].travelFromPreviousMinutes, 5);
});

test('external itinerary importer accepts shared-map and export-file sources', () => {
  const result = normalizeExternalItinerary({
    sourceType: 'GOOGLE_MAPS_SHARE',
    sourceUrl: 'https://maps.google.com/?q=Lisbon',
    items: [{ title: 'Praça do Comércio', address: 'Lisboa, Portugal' }]
  });
  assert.equal(result.status, 'READY_FOR_MATCHING');
  assert.equal(result.itemCount, 1);
  assert.match(result.resolverPolicy, /official provider APIs/i);
});

test('collaboration and export contracts cover cowork planning and office formats', () => {
  const collaboration = collaborationCapabilities();
  const exports = buildExportManifest({ formats: ['PDF', 'DOCX', 'XLSX'] });
  assert.ok(collaboration.permissions.EDITOR.includes('propose'));
  assert.deepEqual(exports.formats, ['PDF', 'DOCX', 'XLSX']);
  assert.ok(exports.xlsx.sheets.includes('Roteiro'));
  assert.ok(plannerCapabilities().externalItinerarySources.includes('GPX'));
});
