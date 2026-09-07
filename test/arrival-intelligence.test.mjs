import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalIntelligenceCapabilities, buildArrivalIntelligence } from '../src/arrival-intelligence.mjs';

function brokerWithFlight(overrides = {}) {
  return {
    async latestFlightStatus() {
      return {
        ok: true,
        provider: 'cirium-sky',
        status: 'LIVE',
        fetchedAt: '2026-09-20T14:42:00.000Z',
        broker: { route: 'SHARED_CREWCHECK_SERVICE', secretsExposed: false },
        flights: [{
          provider: 'cirium-sky',
          route: { departure: 'BSB', arrival: 'GRU' },
          resources: {
            arrivalGate: '205',
            arrivalTerminal: '2',
            baggage: '7A',
            ...overrides.resources
          },
          freshness: { updatedAt: '2026-09-20T14:41:00.000Z', ageMinutes: 1 }
        }]
      };
    }
  };
}

test('arrival intelligence declares shared-first and no automatic itinerary mutation', () => {
  const caps = arrivalIntelligenceCapabilities();
  assert.ok(caps.sharedSources.includes('CREWCHECK_SHARED_FLIGHT_STATUS'));
  assert.equal(caps.itineraryMutationAllowedAutomatically, false);
});

test('through-checked baggage ignores carousel as collection evidence', async () => {
  const result = await buildArrivalIntelligence({
    flight: { carrier: 'LA', flightNumber: 'LA3000', date: '2026-09-20', origin: 'BSB', destination: 'GRU' },
    connection: { arrivalAirport: 'GRU', nextDepartureAirport: 'GRU', nextGate: '110' },
    baggage: { hasCheckedBag: true },
    evidence: { throughChecked: true, mustCollect: false }
  }, { broker: brokerWithFlight() });

  assert.equal(result.status, 'ARRIVAL_FACTS_READY');
  assert.equal(result.arrival.gate, '205');
  assert.equal(result.arrival.terminal, '2');
  assert.equal(result.arrival.baggageCarousel, '7A');
  assert.equal(result.baggage.decision, 'THROUGH_CHECKED_DO_NOT_COLLECT');
  assert.ok(result.flow.some((step) => step.kind === 'BAGGAGE' && step.status === 'SKIP_CONFIRMED'));
  assert.equal(result.policy.carouselDeterminesBagCollection, false);
});

test('customs recheck produces baggage claim customs bag drop and next gate flow', async () => {
  const result = await buildArrivalIntelligence({
    flight: { carrier: 'LA', flightNumber: '3000', date: '2026-09-20' },
    connection: { arrivalAirport: 'GRU', nextDepartureAirport: 'GRU', immigrationRequired: true, customsRequired: true, recheckRequired: true, nextGate: '110' },
    baggage: { hasCheckedBag: true },
    evidence: { mustCollect: true, customsReclaimRequired: true, reason: 'CUSTOMS_RECHECK' }
  }, { broker: brokerWithFlight() });

  assert.equal(result.baggage.decision, 'COLLECT_FOR_CUSTOMS_RECHECK');
  assert.deepEqual(result.flow.map((step) => step.kind), ['ARRIVAL_GATE', 'IMMIGRATION', 'BAGGAGE_CLAIM', 'CUSTOMS', 'BAG_DROP', 'NEXT_GATE']);
  assert.match(result.flow.find((step) => step.kind === 'BAGGAGE_CLAIM').label, /7A/);
});

test('carousel change is an operational update and not itinerary mutation', async () => {
  const result = await buildArrivalIntelligence({
    flight: { carrier: 'LA', flightNumber: '3000', date: '2026-09-20' },
    connection: { arrivalAirport: 'GRU' },
    baggage: { hasCheckedBag: true },
    evidence: { mustCollect: true },
    previousOperational: { baggageCarousel: '6' }
  }, { broker: brokerWithFlight() });

  const update = result.operationalUpdates.find((item) => item.kind === 'BAGGAGE_CAROUSEL_CHANGED');
  assert.ok(update);
  assert.equal(update.from, '6');
  assert.equal(update.to, '7A');
  assert.equal(update.itineraryMutation, false);
});

test('airport change produces a ground-transport next step', async () => {
  const result = await buildArrivalIntelligence({
    flight: { carrier: 'LA', flightNumber: '3000', date: '2026-09-20' },
    connection: { arrivalAirport: 'GRU', nextDepartureAirport: 'CGH' },
    baggage: { hasCheckedBag: false }
  }, { broker: brokerWithFlight() });

  const transfer = result.flow.find((step) => step.kind === 'AIRPORT_TRANSFER');
  assert.ok(transfer);
  assert.equal(transfer.label, 'GRU → CGH');
  assert.equal(transfer.indoorTargetType, 'GROUND_TRANSPORT');
});
