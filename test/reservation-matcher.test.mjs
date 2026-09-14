import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTripGraph, matchReservation, reservationFingerprint, suggestTripForReservation } from '../src/reservation-matcher.mjs';

test('same reservation matches deterministically across document sources', () => {
  const existing = [{ id: 'r1', category: 'AIR_TRAVEL', provider: 'LATAM', confirmationCode: 'ABC123', marketingCarrier: 'LA', flightNumber: '3149', route: { origin: 'GRU', destination: 'GIG' }, startsAt: '2026-09-10T12:00:00Z' }];
  const incoming = { category: 'BOARDING_PASS', provider: 'LATAM', confirmationCode: 'ABC123', marketingCarrier: 'LA', flightNumber: '3149', route: { origin: 'GRU', destination: 'GIG' }, startsAt: '2026-09-10T12:00:00Z' };
  const result = matchReservation(existing, incoming);
  assert.equal(result.matched, true);
  assert.equal(result.reservationId, 'r1');
  assert.ok(result.evidence.includes('CONFIRMATION_CODE'));
  assert.equal(reservationFingerprint(incoming).length, 64);
});

test('TripGraph orders reservations and creates continuity edges', () => {
  const graph = buildTripGraph([
    { id: 'hotel', category: 'LODGING', propertyName: 'Hotel Roma', checkIn: '2027-05-12T15:00:00Z', checkOut: '2027-05-15T10:00:00Z' },
    { id: 'flight', category: 'AIR_TRAVEL', route: { origin: 'GRU', destination: 'FCO' }, departureAt: '2027-05-11T22:00:00Z', arrivalAt: '2027-05-12T12:00:00Z' }
  ]);
  assert.equal(graph.nodes[0].id, 'flight');
  assert.equal(graph.nodes[1].id, 'hotel');
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.span.start, '2027-05-11T22:00:00.000Z');
});

test('reservation can be attached to an existing trip by date window', () => {
  const match = suggestTripForReservation([
    { id: 'italy', title: 'Itália 2027', startDate: '2027-05-12', endDate: '2027-05-24', destinationSummary: 'Roma Florença Milão' }
  ], { category: 'ATTRACTION_TICKET', startsAt: '2027-05-15T09:00:00Z', location: 'Roma' });
  assert.equal(match.tripId, 'italy');
  assert.ok(match.score >= 0.72);
});
