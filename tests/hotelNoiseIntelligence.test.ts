import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHotelConciergeRecommendation } from '../src/ai/hotel/concierge.js';
import { buildNoiseFingerprint, roomRestAdvice, type NoiseObservation } from '../src/ai/hotel/noiseIntelligence.js';

const NOW = new Date('2026-09-05T18:00:00-03:00');

function observation(overrides: Partial<NoiseObservation> & Pick<NoiseObservation, 'id' | 'noiseSource'>): NoiseObservation {
  return {
    hotelId: 'hotel-1',
    roomId: '812',
    source: 'community',
    intensity: 'moderate',
    recurrence: 'single',
    observedAt: '2026-09-05T12:00:00-03:00',
    confidence: 'medium',
    ...overrides,
  };
}

test('single noisy neighbor does not become a structural room characteristic', () => {
  const fingerprint = buildNoiseFingerprint([
    observation({ id: 'guest-1', noiseSource: 'neighbor_guest', reporterKey: 'u1', intensity: 'high' }),
  ], NOW);

  assert.ok(fingerprint);
  assert.equal(fingerprint.items.length, 1);
  assert.equal(fingerprint.items[0]!.noiseSource, 'neighbor_guest');
  assert.equal(fingerprint.items[0]!.structural, false);

  const recommendation = buildHotelConciergeRecommendation({
    hotelName: 'Hotel Teste',
    roomLabel: '812',
    noiseFingerprint: fingerprint,
  }, NOW);

  assert.equal(recommendation.title, 'Relato pontual, não característica do quarto');
  assert.match(recommendation.summary, /circunstancial/);
});

test('corroborated avenue noise becomes structural and affects rest advice', () => {
  const fingerprint = buildNoiseFingerprint([
    observation({
      id: 'road-1',
      noiseSource: 'road_traffic',
      reporterKey: 'u1',
      recurrence: 'recurring',
      intensity: 'high',
      confidence: 'high',
      periods: [{ start: '06:30', end: '09:00' }],
    }),
    observation({
      id: 'road-2',
      noiseSource: 'road_traffic',
      reporterKey: 'u2',
      recurrence: 'recurring',
      intensity: 'high',
      confidence: 'high',
      observedAt: '2026-09-04T07:00:00-03:00',
      periods: [{ start: '06:30', end: '09:00' }],
    }),
  ], NOW);

  assert.ok(fingerprint);
  assert.equal(fingerprint.items[0]!.structural, true);
  assert.equal(fingerprint.items[0]!.distinctReporterCount, 2);
  assert.deepEqual(fingerprint.items[0]!.periods, [{ start: '06:30', end: '09:00' }]);

  const advice = roomRestAdvice(fingerprint, 'high');
  assert.ok(advice.score >= 3.2);
  assert.match(advice.reasons.join(' '), /trânsito\/avenida/);
  assert.match(advice.reasons.join(' '), /06:30–09:00/);
});

test('stale construction report expires instead of becoming permanent room reputation', () => {
  const fingerprint = buildNoiseFingerprint([
    observation({
      id: 'works-old',
      noiseSource: 'construction',
      reporterKey: 'u1',
      recurrence: 'recurring',
      intensity: 'high',
      confidence: 'high',
      observedAt: '2026-07-01T10:00:00-03:00',
    }),
  ], NOW);

  assert.equal(fingerprint, null);
});

test('hotel-confirmed infrastructure noise may be treated as structural with one authoritative observation', () => {
  const fingerprint = buildNoiseFingerprint([
    observation({
      id: 'infra-1',
      noiseSource: 'hotel_infrastructure',
      source: 'hotel',
      hotelConfirmed: true,
      recurrence: 'continuous',
      intensity: 'moderate',
      confidence: 'high',
    }),
  ], NOW);

  assert.ok(fingerprint);
  assert.equal(fingerprint.items[0]!.structural, true);
});
