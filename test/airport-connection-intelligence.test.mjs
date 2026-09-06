import test from 'node:test';
import assert from 'node:assert/strict';
import {
  airportConnectionCapabilities,
  buildAirportConnectionPlan,
  knownAirportConnectionFacts
} from '../src/airport-connection-intelligence.mjs';

test('airport connection capabilities prioritize feasibility over price and require user approval', () => {
  const capabilities = airportConnectionCapabilities();
  assert.ok(capabilities.principles.some((rule) => rule.includes('Feasibility outranks price')));
  assert.equal(capabilities.approvalRequiredForPurchase, true);
  assert.equal(capabilities.approvalRequiredForItineraryMutation, true);
});

test('tight connection rejects free but unsafe shuttle and recommends feasible paid option', () => {
  const result = buildAirportConnectionPlan({
    arrivalAirport: 'AAA',
    departureAirport: 'BBB',
    inboundArrivalAt: '2027-04-10T13:00:00Z',
    outboundDepartureAt: '2027-04-10T16:00:00Z',
    arrivalProcessMinutes: 30,
    departureProcessMinutes: 75,
    options: [
      {
        id: 'free-shuttle',
        title: 'Ônibus gratuito',
        type: 'AIRLINE_SHUTTLE',
        serviceState: 'VERIFIED_RECENT',
        eligibilityConfirmed: true,
        capacityGuaranteed: false,
        scheduleTimes: ['2027-04-10T14:00:00Z'],
        averageTravelMinutes: 85,
        p90TravelMinutes: 105,
        averagePrice: 0,
        reliabilityScore: 0.7
      },
      {
        id: 'taxi',
        title: 'Táxi',
        type: 'TAXI',
        serviceState: 'VERIFIED_RECENT',
        eligibilityConfirmed: true,
        liveTravelMinutes: 48,
        p90TravelMinutes: 58,
        averagePrice: 120,
        reliabilityScore: 0.9
      }
    ]
  });
  assert.equal(result.recommended.id, 'taxi');
  assert.ok(result.excludedOrUnsafe.some((item) => item.id === 'free-shuttle'));
});

test('peak historical p90 time is used conservatively instead of average only', () => {
  const result = buildAirportConnectionPlan({
    arrivalAirport: 'AAA',
    departureAirport: 'BBB',
    inboundArrivalAt: '2027-06-01T20:00:00Z',
    outboundDepartureAt: '2027-06-02T00:30:00Z',
    arrivalProcessMinutes: 20,
    departureProcessMinutes: 75,
    options: [
      {
        id: 'rideshare-peak',
        title: 'Aplicativo',
        type: 'RIDESHARE',
        serviceState: 'VERIFIED_RECENT',
        eligibilityConfirmed: true,
        averageTravelMinutes: 45,
        p90TravelMinutes: 90,
        peakExposure: 'HIGH',
        averagePrice: 95,
        reliabilityScore: 0.78
      }
    ]
  });
  assert.equal(result.recommended.totalConservativeMinutes, 100);
  assert.ok(result.recommended.rationale.includes('PEAK_TRAFFIC_EXPOSURE'));
});

test('known facts do not treat conflicting CGH-GRU shuttle information as safely available', () => {
  const facts = knownAirportConnectionFacts();
  const gol = facts.find((item) => item.serviceId === 'GOL_BUS_CGH_GRU');
  assert.equal(gol.state, 'VERIFY_LIVE');
  assert.equal(gol.requiresFreshCheck, true);
});

test('known facts include current Azul CGH-VCP benefit rules and Rio public transit combination', () => {
  const facts = knownAirportConnectionFacts();
  const azul = facts.find((item) => item.serviceId === 'AZUL_BUS_CGH_VCP');
  const rio = facts.find((item) => item.serviceId === 'RIO_VLT_GENTILEZA_GIG');
  assert.equal(azul.state, 'VERIFIED_RECENT');
  assert.equal(azul.price.amount, 0);
  assert.equal(azul.reservation, 'NO_RESERVATION_SUBJECT_TO_AVAILABILITY');
  assert.equal(rio.price.amount, 20);
  assert.equal(rio.referenceDurationMinutes, 55);
});

test('service requiring live verification is never ranked as usable until confirmed', () => {
  const result = buildAirportConnectionPlan({
    arrivalAirport: 'CGH',
    departureAirport: 'GRU',
    inboundArrivalAt: '2027-07-10T12:00:00Z',
    outboundDepartureAt: '2027-07-10T18:00:00Z',
    arrivalProcessMinutes: 20,
    departureProcessMinutes: 90,
    options: [
      {
        id: 'gol-bus',
        title: 'Ônibus da companhia',
        type: 'AIRLINE_SHUTTLE',
        serviceState: 'VERIFY_LIVE',
        eligibilityConfirmed: true,
        averageTravelMinutes: 70,
        p90TravelMinutes: 110,
        averagePrice: 0,
        reliabilityScore: 0.8
      }
    ]
  });
  assert.equal(result.recommended, null);
  assert.equal(result.status, 'NO_SAFE_OPTION_YET');
  assert.ok(result.excludedOrUnsafe[0].warnings.includes('SERVICE_REQUIRES_FRESH_CONFIRMATION'));
});
