import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWeatherReplacementPlan,
  evaluateActivityWeather,
  weatherPlanningCapabilities
} from '../src/weather-intelligence.mjs';

test('weather planning treats weather as a first-class constraint', () => {
  const capabilities = weatherPlanningCapabilities();
  assert.ok(capabilities.principles.some((item) => /planning constraint/i.test(item)));
  assert.match(capabilities.monitoring.duringTrip, /re-check/i);
});

test('cold weather makes a water park unsuitable instead of recommending it blindly', () => {
  const assessment = evaluateActivityWeather(
    { id: 'water-park', type: 'OUTDOOR', weatherSensitivity: 'WATER', localDate: '2027-07-04' },
    { entries: [{ localDate: '2027-07-04', temperatureC: 14, feelsLikeC: 12, precipitationProbability: 0.1, windKph: 8, source: 'synthetic-provider' }] }
  );
  assert.equal(assessment.status, 'UNSUITABLE');
  assert.ok(assessment.reasons.includes('TOO_COLD_FOR_WATER_ACTIVITY'));
});

test('rainy period makes an outdoor activity unsuitable', () => {
  const assessment = evaluateActivityWeather(
    { id: 'park', type: 'OUTDOOR', localDate: '2027-05-18' },
    { entries: [{ localDate: '2027-05-18', temperatureC: 21, precipitationProbability: 0.8, precipitationMm: 7, windKph: 12, source: 'synthetic-provider' }] }
  );
  assert.equal(assessment.status, 'UNSUITABLE');
  assert.ok(assessment.reasons.includes('HIGH_RAIN_PROBABILITY'));
});

test('weather replacement prefers verified weather-safe alternatives in the same cluster', () => {
  const weather = { entries: [{ localDate: '2027-05-18', temperatureC: 18, precipitationProbability: 0.85, precipitationMm: 9, source: 'synthetic-provider' }] };
  const replacement = buildWeatherReplacementPlan({
    activity: { id: 'garden', title: 'Garden visit', type: 'OUTDOOR', localDate: '2027-05-18', clusterId: 'center', tags: ['culture'] },
    weather,
    candidates: [
      { id: 'museum', title: 'Museum', type: 'CULTURE', weatherSensitivity: 'INDOOR', localDate: '2027-05-18', clusterId: 'center', interestScore: 0.8, rating: 4.7 },
      { id: 'far-mall', title: 'Mall', type: 'SHOPPING', weatherSensitivity: 'INDOOR', localDate: '2027-05-18', clusterId: 'other', interestScore: 0.3, rating: 4.2 }
    ]
  });
  assert.equal(replacement.needsReplacement, true);
  assert.equal(replacement.action, 'OFFER_ALTERNATIVES');
  assert.equal(replacement.alternatives[0].id, 'museum');
});

test('locked weather-sensitive reservation is warned but not silently replaced', () => {
  const replacement = buildWeatherReplacementPlan({
    activity: { id: 'reserved-tour', title: 'Reserved outdoor tour', type: 'OUTDOOR', localDate: '2027-06-01', locked: true },
    weather: { entries: [{ localDate: '2027-06-01', thunderstorm: true, source: 'synthetic-provider' }] }
  });
  assert.equal(replacement.original.assessment.status, 'BLOCKED');
  assert.equal(replacement.action, 'PRESERVE_AND_WARN_USER');
});
