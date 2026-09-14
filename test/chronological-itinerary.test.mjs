import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChronologicalItinerary,
  chronologicalItineraryCapabilities
} from '../src/chronological-itinerary.mjs';

// Privacy note: these fixtures are synthetic/redacted. They reproduce structural
// patterns found in real user-authorized travel sources without storing personal
// booking codes, names, addresses or source-document identifiers.

test('capabilities require a chronological door-to-door itinerary with meals and explicit approval', () => {
  const capabilities = chronologicalItineraryCapabilities();
  assert.ok(capabilities.includes.includes('BREAKFAST'));
  assert.ok(capabilities.includes.includes('MULTIMODAL_TRANSFERS'));
  assert.equal(capabilities.mutationPolicy.automaticMutationAllowed, false);
  assert.equal(capabilities.mutationPolicy.userApprovalRequired, true);
});

test('multimodal leisure pattern builds start-to-finish chronology with flight, bus, meals and return continuity', () => {
  const result = buildChronologicalItinerary({
    trip: {
      startDate: '2027-04-03',
      endDate: '2027-04-05',
      originLocationId: 'HOME',
      finalLocationId: 'HOME',
      interStopArrivalBufferMinutes: 0,
      startArrivalBufferMinutes: 0
    },
    fixedItems: [
      { id: 'flight-out-1', kind: 'FLIGHT', title: 'Voo até conexão', startsAt: '2027-04-03T08:00:00Z', endsAt: '2027-04-03T09:20:00Z', fromLocationId: 'AIRPORT_A', toLocationId: 'AIRPORT_HUB', locationId: 'AIRPORT_HUB', locked: true, source: 'AIRLINE' },
      { id: 'flight-out-2', kind: 'FLIGHT', title: 'Voo até destino', startsAt: '2027-04-03T10:30:00Z', endsAt: '2027-04-03T11:45:00Z', fromLocationId: 'AIRPORT_HUB', toLocationId: 'AIRPORT_DEST', locationId: 'AIRPORT_DEST', locked: true, source: 'AIRLINE' },
      { id: 'hotel-checkin', kind: 'CHECK_IN', title: 'Check-in', startsAt: '2027-04-03T15:00:00Z', endsAt: '2027-04-03T15:15:00Z', locationId: 'HOTEL_DEST', locked: true, source: 'LODGING' },
      { id: 'bus-daytrip', kind: 'BUS', title: 'Ônibus para cidade próxima', startsAt: '2027-04-04T05:20:00Z', endsAt: '2027-04-04T07:00:00Z', fromLocationId: 'BUS_TERMINAL_DEST', toLocationId: 'BUS_TERMINAL_DAYTRIP', locationId: 'BUS_TERMINAL_DAYTRIP', locked: true, source: 'BUS_PROVIDER' },
      { id: 'flight-home-1', kind: 'FLIGHT', title: 'Voo de retorno', startsAt: '2027-04-05T14:30:00Z', endsAt: '2027-04-05T15:45:00Z', fromLocationId: 'AIRPORT_DEST', toLocationId: 'AIRPORT_HUB', locationId: 'AIRPORT_HUB', locked: true, source: 'AIRLINE' },
      { id: 'flight-home-2', kind: 'FLIGHT', title: 'Voo final', startsAt: '2027-04-05T17:00:00Z', endsAt: '2027-04-05T18:30:00Z', fromLocationId: 'AIRPORT_HUB', toLocationId: 'AIRPORT_A', locationId: 'AIRPORT_A', locked: true, source: 'AIRLINE' }
    ],
    activityCandidates: [
      { id: 'historic-center', title: 'Centro histórico', kind: 'ATTRACTION', locationId: 'CENTER_DAYTRIP', localDate: '2027-04-04', durationMinutes: 120, verified: true, priority: 8, source: 'PLACES_PROVIDER' }
    ],
    routes: [
      { fromLocationId: 'HOME', toLocationId: 'AIRPORT_HUB', durationMinutes: 35, mode: 'RIDESHARE', verified: true, provider: 'ROUTES' },
      { fromLocationId: 'HOME', toLocationId: 'AIRPORT_A', durationMinutes: 35, mode: 'RIDESHARE', verified: true, provider: 'ROUTES' },
      { fromLocationId: 'AIRPORT_HUB', toLocationId: 'AIRPORT_DEST', durationMinutes: 70, mode: 'FLIGHT', verified: true, provider: 'AIRLINE' },
      { fromLocationId: 'AIRPORT_DEST', toLocationId: 'HOTEL_DEST', durationMinutes: 25, mode: 'RIDESHARE', verified: true, provider: 'ROUTES' },
      { fromLocationId: 'HOTEL_DEST', toLocationId: 'BUS_TERMINAL_DEST', durationMinutes: 20, mode: 'RIDESHARE', verified: true, provider: 'ROUTES' },
      { fromLocationId: 'BUS_TERMINAL_DAYTRIP', toLocationId: 'CENTER_DAYTRIP', durationMinutes: 15, mode: 'WALK', verified: true, provider: 'ROUTES' },
      { fromLocationId: 'CENTER_DAYTRIP', toLocationId: 'AIRPORT_DEST', durationMinutes: 70, mode: 'BUS', verified: true, provider: 'ROUTES' },
      { fromLocationId: 'AIRPORT_HUB', toLocationId: 'AIRPORT_A', durationMinutes: 80, mode: 'FLIGHT', verified: true, provider: 'AIRLINE' },
      { fromLocationId: 'AIRPORT_A', toLocationId: 'HOME', durationMinutes: 30, mode: 'RIDESHARE', verified: true, provider: 'ROUTES' }
    ]
  });

  assert.equal(result.days.length, 3);
  assert.ok(result.days.every((day) => day.meals.some((item) => item.kind === 'BREAKFAST')));
  assert.ok(result.days.every((day) => day.meals.some((item) => item.kind === 'LUNCH')));
  assert.ok(result.days.every((day) => day.meals.some((item) => item.kind === 'DINNER')));
  assert.ok(result.timeline.some((item) => item.kind === 'BUS'));
  assert.ok(result.timeline.some((item) => item.id === 'historic-center'));
  assert.equal(result.approval.automaticMutationAllowed, false);
});

test('meal planner reserves breakfast lunch and dinner around fixed commitments instead of omitting human needs', () => {
  const result = buildChronologicalItinerary({
    trip: { startDate: '2027-06-10', endDate: '2027-06-10', originLocationId: 'HOTEL', finalLocationId: 'HOTEL' },
    fixedItems: [
      { id: 'morning-tour', kind: 'TOUR', startsAt: '2027-06-10T09:00:00Z', endsAt: '2027-06-10T11:30:00Z', locationId: 'OLD_TOWN', locked: true },
      { id: 'evening-show', kind: 'ATTRACTION', startsAt: '2027-06-10T20:30:00Z', endsAt: '2027-06-10T22:00:00Z', locationId: 'THEATRE', locked: true }
    ],
    routes: [
      { fromLocationId: 'HOTEL', toLocationId: 'OLD_TOWN', durationMinutes: 20, mode: 'METRO', verified: true },
      { fromLocationId: 'OLD_TOWN', toLocationId: 'THEATRE', durationMinutes: 20, mode: 'METRO', verified: true },
      { fromLocationId: 'THEATRE', toLocationId: 'HOTEL', durationMinutes: 20, mode: 'METRO', verified: true }
    ]
  });
  const meals = result.days[0].meals;
  assert.deepEqual(meals.map((item) => item.kind), ['BREAKFAST', 'LUNCH', 'DINNER']);
  assert.ok(meals.every((item) => ['SLOT_RESERVED', 'NEEDS_PLACEMENT'].includes(item.status)));
  assert.equal(meals.find((item) => item.kind === 'BREAKFAST').status, 'SLOT_RESERVED');
});

test('missing route and unverified attraction remain unresolved instead of being invented', () => {
  const result = buildChronologicalItinerary({
    trip: { startDate: '2027-08-01', endDate: '2027-08-01', originLocationId: 'HOME', finalLocationId: 'HOME' },
    fixedItems: [
      { id: 'reservation', kind: 'TOUR', startsAt: '2027-08-01T14:00:00Z', endsAt: '2027-08-01T16:00:00Z', locationId: 'VENUE', locked: true }
    ],
    activityCandidates: [
      { id: 'internet-rumor', title: 'Lugar não verificado', locationId: 'UNKNOWN_PLACE', durationMinutes: 90, verified: false }
    ]
  });
  assert.ok(result.researchNeeds.some((item) => item.startsWith('ROUTE:HOME>VENUE')));
  assert.ok(result.days[0].unplacedActivities.some((item) => item.id === 'internet-rumor' && item.reason === 'UNVERIFIED_CANDIDATE'));
  assert.equal(result.status, 'NEEDS_RESEARCH');
});

test('fixed-time stops expose departure-watch guidance without authorizing itinerary changes', () => {
  const result = buildChronologicalItinerary({
    trip: { startDate: '2027-09-10', endDate: '2027-09-10', originLocationId: 'HOTEL', finalLocationId: 'HOTEL' },
    fixedItems: [
      { id: 'dinner', kind: 'DINNER', title: 'Jantar reservado', startsAt: '2027-09-10T19:30:00Z', endsAt: '2027-09-10T21:00:00Z', locationId: 'RESTAURANT', locked: true }
    ],
    routes: [
      { fromLocationId: 'HOTEL', toLocationId: 'RESTAURANT', durationMinutes: 25, mode: 'METRO', verified: true, provider: 'ROUTES' },
      { fromLocationId: 'RESTAURANT', toLocationId: 'HOTEL', durationMinutes: 25, mode: 'METRO', verified: true, provider: 'ROUTES' }
    ]
  });
  const dinner = result.timeline.find((item) => item.id === 'dinner');
  assert.equal(dinner.guidance.departureWatchEligible, true);
  assert.equal(dinner.guidance.itineraryMutationAllowed, false);
  assert.equal(dinner.approvalRequiredForChange, true);
});
