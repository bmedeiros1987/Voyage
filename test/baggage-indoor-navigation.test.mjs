import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baggageIntelligenceCapabilities,
  buildBaggageConnectionDecision
} from '../src/baggage-intelligence.mjs';
import {
  airportIndoorNavigationCapabilities,
  buildAirportIndoorRoute
} from '../src/airport-indoor-navigation.mjs';

test('baggage capabilities distinguish carousel data from through-check evidence', () => {
  const capabilities = baggageIntelligenceCapabilities();
  assert.match(capabilities.importantDistinction, /does not by itself prove/i);
  assert.ok(capabilities.dataSources.carousel.includes('CIRIUM_FLIGHT_STATUS'));
});

test('confirmed through-checked bag tells user not to collect even if a carousel exists', () => {
  const result = buildBaggageConnectionDecision({
    connection: {
      arrivalAirport: 'GRU',
      departureAirport: 'GRU',
      finalDestinationAirport: 'BSB'
    },
    baggage: {
      hasCheckedBag: true,
      checkedBagCount: 1,
      baggageSource: 'USER'
    },
    evidence: {
      throughChecked: true,
      bagTagDestination: 'BSB',
      verified: true,
      evidenceSource: 'AIRLINE_ITINERARY'
    },
    carousel: {
      carousel: '12',
      provider: 'CIRIUM_FLIGHT_STATUS',
      updatedAt: '2027-02-01T12:00:00Z'
    }
  });

  assert.equal(result.decision, 'THROUGH_CHECKED_DO_NOT_COLLECT');
  assert.ok(result.alerts.some((alert) => alert.type === 'DO_NOT_COLLECT_BAG'));
  assert.equal(result.indoorNavigationTarget.poiType, 'NEXT_GATE_OR_SECURITY');
});

test('customs reclaim rule instructs bag collection and routes to known carousel', () => {
  const result = buildBaggageConnectionDecision({
    connection: { arrivalAirport: 'AAA', departureAirport: 'AAA', internationalArrival: true },
    baggage: { hasCheckedBag: true },
    evidence: {
      customsReclaimRequired: true,
      mustCollect: true,
      reason: 'CUSTOMS_RECHECK',
      verified: true,
      evidenceSource: 'AIRPORT_RULE'
    },
    carousel: {
      baggageCarousel: '7A',
      poiId: 'bag-7a',
      provider: 'CIRIUM_FLIGHT_STATUS',
      updatedAt: '2027-02-01T12:04:00Z'
    }
  });

  assert.equal(result.decision, 'COLLECT_FOR_CUSTOMS_RECHECK');
  assert.equal(result.indoorNavigationTarget.poiId, 'bag-7a');
  assert.match(result.message, /7A/);
});

test('inter-airport connection without bag handling evidence fails safe and requests verification', () => {
  const result = buildBaggageConnectionDecision({
    connection: { arrivalAirport: 'CGH', departureAirport: 'GRU' },
    baggage: { hasCheckedBag: true }
  });

  assert.equal(result.decision, 'VERIFY_INTERAIRPORT_TRANSFER');
  assert.ok(result.providerNeeds.includes('THROUGH_CHECK_CONFIRMATION'));
  assert.ok(result.alerts.some((alert) => alert.type === 'BAGGAGE_DECISION_UNRESOLVED'));
});

test('carousel change emits a high priority alert', () => {
  const result = buildBaggageConnectionDecision({
    connection: { arrivalAirport: 'GRU', departureAirport: 'GRU' },
    baggage: { hasCheckedBag: true },
    evidence: { mustCollect: true, verified: true },
    carousel: { carousel: '9', updatedAt: '2027-02-01T12:10:00Z' },
    previousCarousel: '6'
  });

  const change = result.alerts.find((alert) => alert.type === 'CAROUSEL_CHANGED');
  assert.equal(change.from, '6');
  assert.equal(change.to, '9');
  assert.equal(change.priority, 'HIGH');
});

test('airport indoor navigation is explicitly in-app and does not require another map app', () => {
  const capabilities = airportIndoorNavigationCapabilities();
  assert.equal(capabilities.rendering, 'IN_APP');
  assert.equal(capabilities.externalAppRequired, false);
});

test('indoor route links gate to baggage claim across floors and prefers accessible route', () => {
  const result = buildAirportIndoorRoute({
    airport: 'GRU',
    originId: 'gate-101',
    destinationId: 'bag-12',
    accessibilityRequired: true,
    graph: {
      provider: 'SYNTHETIC_TEST',
      updatedAt: '2027-02-01T11:00:00Z',
      nodes: [
        { id: 'gate-101', label: 'Portão 101', poiType: 'GATE', floor: 'L2' },
        { id: 'hall-l2', label: 'Corredor L2', poiType: 'OTHER', floor: 'L2' },
        { id: 'stairs-l1', label: 'Escadas', poiType: 'OTHER', floor: 'L1' },
        { id: 'elevator-l1', label: 'Elevador L1', poiType: 'OTHER', floor: 'L1' },
        { id: 'bag-12', label: 'Esteira 12', poiType: 'BAGGAGE_CLAIM', floor: 'L1' }
      ],
      edges: [
        { from: 'gate-101', to: 'hall-l2', type: 'WALK', meters: 180, seconds: 130 },
        { from: 'hall-l2', to: 'stairs-l1', type: 'STAIRS', meters: 20, seconds: 35, accessible: false },
        { from: 'stairs-l1', to: 'bag-12', type: 'WALK', meters: 60, seconds: 50 },
        { from: 'hall-l2', to: 'elevator-l1', type: 'ELEVATOR', meters: 30, seconds: 60, accessible: true },
        { from: 'elevator-l1', to: 'bag-12', type: 'WALK', meters: 80, seconds: 65, accessible: true }
      ]
    }
  });

  assert.equal(result.status, 'ROUTE_READY');
  assert.equal(result.externalAppRequired, false);
  assert.ok(result.route.steps.some((step) => /elevador/i.test(step.action)));
  assert.ok(!result.route.steps.some((step) => /escadas$/i.test(step.action)));
  assert.equal(result.ui.renderInsideVoyage, true);
});

test('missing indoor data stays inside Voyage and exposes a terminal fallback instead of opening another app', () => {
  const result = buildAirportIndoorRoute({
    airport: 'SDU',
    originId: 'gate-a',
    destinationId: 'bag-3',
    terminal: 'Principal',
    graph: { nodes: [], edges: [] }
  });

  assert.equal(result.status, 'NEEDS_INDOOR_MAP_DATA');
  assert.equal(result.externalAppRequired, false);
  assert.equal(result.fallback.opensExternalMapApp, false);
});
