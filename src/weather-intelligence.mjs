const WEATHER_SENSITIVITY = new Set(['NONE', 'INDOOR', 'MIXED', 'OUTDOOR', 'WATER']);
const WEATHER_STATUS = new Set(['SUITABLE', 'CAUTION', 'UNSUITABLE', 'BLOCKED', 'UNKNOWN']);

export function weatherPlanningCapabilities() {
  return {
    version: '1.0',
    sensitivities: [...WEATHER_SENSITIVITY],
    statuses: [...WEATHER_STATUS],
    principles: [
      'Weather is a planning constraint, not decoration.',
      'Long-range climate or seasonal expectations are soft hints only; they must not be treated as a verified forecast.',
      'Near-trip and in-trip decisions should use fresh provider-backed forecast/nowcast data with provenance.',
      'Unknown weather never becomes an invented fact and should not silently cancel an activity.',
      'Weather-sensitive optional activities may be moved or replaced, but locked reservations are preserved and surfaced for user review.',
      'When weather makes an activity unsuitable, prefer a nearby equivalent or indoor alternative that still matches the user intent.'
    ],
    defaultThresholds: {
      outdoor: { cautionRainProbability: 0.35, unsuitableRainProbability: 0.6, unsuitableRainMm: 3, unsuitableWindKph: 40 },
      water: { minimumTemperatureC: 22, minimumFeelsLikeC: 20, unsuitableRainProbability: 0.55, unsuitableWindKph: 35 },
      heatCold: { coldCautionFeelsLikeC: 8, heatCautionFeelsLikeC: 36 }
    },
    monitoring: {
      preTrip: 'Re-evaluate weather-sensitive days when a trustworthy forecast enters range.',
      duringTrip: 'Re-check the affected day and the next weather-sensitive activity when forecast/nowcast materially changes.',
      replacementScope: 'Repair the smallest affected part of the itinerary first.'
    }
  };
}

export function normalizeWeatherContext(input = {}) {
  const entries = Array.isArray(input.entries || input.forecast)
    ? (input.entries || input.forecast).slice(0, 240).map(normalizeWeatherEntry).filter(Boolean)
    : [];
  return {
    mode: safeToken(input.mode || 'FORECAST'),
    provider: safeString(input.provider, 120),
    locationId: safeString(input.locationId, 220),
    updatedAt: safeDateTime(input.updatedAt),
    entries,
    freshnessPolicy: input.freshnessPolicy || 'PROVIDER_TIMESTAMP_REQUIRED_FOR_AUTOMATIC_REPLAN',
    sourceRequired: true
  };
}

export function evaluateActivityWeather(activity = {}, weatherInput = {}) {
  const context = weatherInput.entries ? normalizeWeatherContext(weatherInput) : normalizeWeatherContext({ entries: [weatherInput] });
  const sensitivity = normalizeSensitivity(activity.weatherSensitivity, activity);
  const entry = findWeatherEntry(activity, context.entries);
  const reasons = [];

  if (sensitivity === 'NONE' || sensitivity === 'INDOOR') {
    if (entry?.severeAlert === true) {
      return result('CAUTION', sensitivity, entry, ['SEVERE_WEATHER_MAY_AFFECT_ACCESS_OR_TRANSPORT']);
    }
    return result(entry ? 'SUITABLE' : 'UNKNOWN', sensitivity, entry, entry ? [] : ['WEATHER_NOT_REQUIRED_OR_NOT_AVAILABLE']);
  }
  if (!entry) return result('UNKNOWN', sensitivity, null, ['NO_MATCHING_WEATHER_DATA']);

  const requirements = normalizeRequirements(activity.weatherRequirements || {});
  const temp = firstNumber(entry.feelsLikeC, entry.temperatureC);
  const rainProbability = entry.precipitationProbability;
  const rainMm = entry.precipitationMm;
  const wind = entry.windKph;

  if (entry.severeAlert === true || entry.thunderstorm === true) {
    reasons.push(entry.thunderstorm === true ? 'THUNDERSTORM_RISK' : 'SEVERE_WEATHER_ALERT');
    return result('BLOCKED', sensitivity, entry, reasons);
  }

  if (Number.isFinite(requirements.minimumTemperatureC) && Number.isFinite(temp) && temp < requirements.minimumTemperatureC) reasons.push('BELOW_ACTIVITY_MINIMUM_TEMPERATURE');
  if (Number.isFinite(requirements.maximumTemperatureC) && Number.isFinite(temp) && temp > requirements.maximumTemperatureC) reasons.push('ABOVE_ACTIVITY_MAXIMUM_TEMPERATURE');
  if (Number.isFinite(requirements.maximumRainProbability) && Number.isFinite(rainProbability) && rainProbability > requirements.maximumRainProbability) reasons.push('RAIN_PROBABILITY_EXCEEDS_ACTIVITY_LIMIT');
  if (Number.isFinite(requirements.maximumWindKph) && Number.isFinite(wind) && wind > requirements.maximumWindKph) reasons.push('WIND_EXCEEDS_ACTIVITY_LIMIT');
  if (reasons.length) return result('UNSUITABLE', sensitivity, entry, reasons);

  if (sensitivity === 'WATER') {
    if (Number.isFinite(temp) && temp < 20) reasons.push('TOO_COLD_FOR_WATER_ACTIVITY');
    else if (Number.isFinite(temp) && temp < 22) reasons.push('COOL_FOR_WATER_ACTIVITY');
    if (Number.isFinite(rainProbability) && rainProbability >= 0.55) reasons.push('RAIN_RISK_FOR_WATER_ACTIVITY');
    if (Number.isFinite(wind) && wind >= 35) reasons.push('HIGH_WIND_FOR_WATER_ACTIVITY');
    if (reasons.some((item) => item !== 'COOL_FOR_WATER_ACTIVITY')) return result('UNSUITABLE', sensitivity, entry, reasons);
    if (reasons.length) return result('CAUTION', sensitivity, entry, reasons);
  }

  if (sensitivity === 'OUTDOOR' || sensitivity === 'MIXED') {
    if (Number.isFinite(rainProbability) && rainProbability >= 0.6) reasons.push('HIGH_RAIN_PROBABILITY');
    if (Number.isFinite(rainMm) && rainMm >= 3) reasons.push('MEANINGFUL_RAIN_EXPECTED');
    if (Number.isFinite(wind) && wind >= 40) reasons.push('HIGH_WIND');
    if (reasons.length) return result('UNSUITABLE', sensitivity, entry, reasons);

    if (Number.isFinite(rainProbability) && rainProbability >= 0.35) reasons.push('POSSIBLE_RAIN');
    if (Number.isFinite(temp) && temp <= 8) reasons.push('COLD_EXPOSURE');
    if (Number.isFinite(temp) && temp >= 36) reasons.push('HEAT_EXPOSURE');
    if (reasons.length) return result('CAUTION', sensitivity, entry, reasons);
  }

  return result('SUITABLE', sensitivity, entry, []);
}

export function buildWeatherReplacementPlan(input = {}) {
  const activity = input.activity || {};
  const assessment = evaluateActivityWeather(activity, input.weather || {});
  const candidates = Array.isArray(input.candidates) ? input.candidates.slice(0, 200) : [];
  const sameCluster = safeString(activity.clusterId || activity.locationGroup, 160);
  const allowed = candidates
    .map((candidate) => ({ candidate, assessment: evaluateActivityWeather(candidate, input.weather || {}) }))
    .filter(({ candidate, assessment: itemAssessment }) => candidate.locked !== true && !['BLOCKED', 'UNSUITABLE'].includes(itemAssessment.status))
    .map(({ candidate, assessment: itemAssessment }) => ({
      ...candidate,
      weatherAssessment: itemAssessment,
      replacementScore: replacementScore(candidate, itemAssessment, sameCluster)
    }))
    .sort((a, b) => b.replacementScore - a.replacementScore)
    .slice(0, 5);

  const needsReplacement = ['BLOCKED', 'UNSUITABLE'].includes(assessment.status);
  return {
    needsReplacement,
    original: {
      id: safeString(activity.id, 160),
      title: safeString(activity.title, 220),
      locked: activity.locked === true,
      assessment
    },
    action: !needsReplacement ? 'KEEP_ACTIVITY' : activity.locked === true ? 'PRESERVE_AND_WARN_USER' : allowed.length ? 'OFFER_ALTERNATIVES' : 'SEARCH_ALTERNATIVES',
    alternatives: allowed,
    searchIntent: needsReplacement && !allowed.length ? {
      weatherSafe: true,
      preferIndoor: assessment.sensitivity === 'OUTDOOR' || assessment.sensitivity === 'WATER',
      preserveInterestTags: uniqueStrings(activity.tags).slice(0, 20),
      preserveClusterId: sameCluster,
      categories: replacementCategories(activity)
    } : null,
    policy: 'Never invent a replacement place. Offer only verified candidates or issue a provider-backed search intent.'
  };
}

function normalizeWeatherEntry(item) {
  if (!item || typeof item !== 'object') return null;
  const localDate = safeDate(item.localDate || item.date);
  const startsAt = safeDateTime(item.startsAt || item.time);
  if (!localDate && !startsAt) return null;
  return {
    localDate: localDate || startsAt.slice(0, 10),
    startsAt,
    endsAt: safeDateTime(item.endsAt),
    temperatureC: optionalNumber(item.temperatureC, -100, 70),
    feelsLikeC: optionalNumber(item.feelsLikeC, -100, 70),
    precipitationProbability: normalizeProbability(item.precipitationProbability),
    precipitationMm: optionalNumber(item.precipitationMm, 0, 1000),
    windKph: optionalNumber(item.windKph, 0, 500),
    thunderstorm: item.thunderstorm === true,
    severeAlert: item.severeAlert === true,
    source: safeString(item.source, 160),
    observedAt: safeDateTime(item.observedAt || item.updatedAt),
    confidence: optionalNumber(item.confidence, 0, 1)
  };
}

function normalizeSensitivity(value, activity) {
  const explicit = safeToken(value);
  if (WEATHER_SENSITIVITY.has(explicit)) return explicit;
  const tags = uniqueStrings(activity.tags).map((item) => item.toUpperCase());
  if (tags.some((item) => ['WATER_PARK', 'AQUAPARK', 'BEACH', 'POOL', 'WATER_ACTIVITY'].includes(item))) return 'WATER';
  if (activity.type === 'OUTDOOR') return 'OUTDOOR';
  if (tags.some((item) => ['OUTDOOR', 'HIKE', 'PARK', 'GARDEN', 'VIEWPOINT'].includes(item))) return 'OUTDOOR';
  if (tags.some((item) => ['INDOOR', 'MUSEUM', 'MALL', 'SPA', 'CINEMA'].includes(item))) return 'INDOOR';
  return 'MIXED';
}

function normalizeRequirements(input) {
  return {
    minimumTemperatureC: optionalNumber(input.minimumTemperatureC, -100, 70),
    maximumTemperatureC: optionalNumber(input.maximumTemperatureC, -100, 70),
    maximumRainProbability: normalizeProbability(input.maximumRainProbability),
    maximumWindKph: optionalNumber(input.maximumWindKph, 0, 500)
  };
}

function findWeatherEntry(activity, entries) {
  if (!entries.length) return null;
  const date = safeDate(activity.localDate || activity.date || (safeDateTime(activity.startsAt) || '').slice(0, 10));
  if (!date) return entries[0] || null;
  const sameDate = entries.filter((item) => item.localDate === date);
  if (!sameDate.length) return null;
  const startsAt = safeDateTime(activity.startsAt);
  if (!startsAt) return sameDate[0];
  const target = new Date(startsAt).getTime();
  return sameDate.slice().sort((a, b) => Math.abs(timeOf(a.startsAt) - target) - Math.abs(timeOf(b.startsAt) - target))[0];
}

function result(status, sensitivity, entry, reasons) {
  return {
    status: WEATHER_STATUS.has(status) ? status : 'UNKNOWN',
    sensitivity,
    reasons: uniqueStrings(reasons),
    weather: entry,
    automaticReplacementAllowed: ['BLOCKED', 'UNSUITABLE'].includes(status),
    requiresFreshVerifiedWeather: true
  };
}

function replacementScore(candidate, assessment, sameCluster) {
  let score = 0;
  if (assessment.status === 'SUITABLE') score += 4;
  else if (assessment.status === 'CAUTION') score += 1.5;
  if (sameCluster && safeString(candidate.clusterId || candidate.locationGroup, 160) === sameCluster) score += 2;
  if (Number.isFinite(Number(candidate.interestScore))) score += Number(candidate.interestScore) * 2;
  if (Number.isFinite(Number(candidate.rating))) score += Number(candidate.rating) / 5;
  if (candidate.weatherSensitivity === 'INDOOR') score += 0.5;
  return Number(score.toFixed(3));
}

function replacementCategories(activity) {
  const tags = uniqueStrings(activity.tags).map((item) => item.toUpperCase());
  const categories = ['CULTURE', 'FOOD', 'COFFEE', 'SHOPPING', 'WELLNESS', 'INDOOR_ATTRACTION'];
  if (tags.includes('FAMILY')) categories.unshift('FAMILY_INDOOR');
  return categories;
}

function uniqueStrings(input) {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const string = String(value).trim();
  return string ? string.slice(0, max) : null;
}

function safeToken(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_:-]+/g, '_').slice(0, 100);
}

function safeDate(value) {
  const string = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(string)) return null;
  const date = new Date(`${string}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : string;
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function optionalNumber(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function normalizeProbability(value) {
  const parsed = optionalNumber(value, 0, 100);
  if (parsed === null) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

function firstNumber(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}

function timeOf(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}
