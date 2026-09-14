const USER_TYPES = new Set(['PASSENGER', 'CREW_MEMBER']);
const MODES = new Set([
  'WALK',
  'BIKE',
  'SCOOTER',
  'PUBLIC_TRANSIT',
  'METRO',
  'TRAM',
  'TRAIN',
  'BUS',
  'COACH',
  'RIDESHARE',
  'TAXI',
  'CAR',
  'CAR_RENTAL',
  'PRIVATE_TRANSFER',
  'FERRY',
  'FLIGHT'
]);
const WEATHER_EXPOSURE = new Set(['LOW', 'MEDIUM', 'HIGH']);

export function transportIntelligenceCapabilities() {
  return {
    version: '1.0',
    modes: [...MODES],
    principles: [
      'Compare the whole door-to-door journey, not only the moving time of one vehicle.',
      'For ordinary passenger trips, ground and local mobility options come first; flight is not considered unless the user explicitly asks for it.',
      'For crew members, flight may be considered when operationally relevant, but it is still compared against realistic alternatives instead of being assumed best.',
      'A route may combine modes such as walking + metro, rideshare + train or bus + ferry.',
      'Time, cost, transfers, walking, reliability, comfort, accessibility, luggage, weather exposure and user preferences may all affect ranking.',
      'Never invent fares, schedules, travel time, availability or service frequency. Unknown provider facts remain unknown and reduce confidence.',
      'The system may recommend and explain transport choices, but booking, purchasing or changing the itinerary always requires explicit user approval.'
    ],
    flightPolicy: {
      passengerDefault: 'EXCLUDED_UNLESS_USER_OPT_IN',
      crewMemberDefault: 'ELIGIBLE_WHEN_RELEVANT',
      bookedFlight: 'TREAT_AS_EXISTING_HARD_ANCHOR_NOT_AS_DEFAULT_MOBILITY_RECOMMENDATION'
    },
    comparisonDimensions: ['DOOR_TO_DOOR_TIME', 'COST', 'TRANSFERS', 'WALKING', 'RELIABILITY', 'COMFORT', 'ACCESSIBILITY', 'LUGGAGE_FIT', 'WEATHER_EXPOSURE', 'SIMPLICITY'],
    userApprovalRequiredForBooking: true,
    userApprovalRequiredForItineraryChanges: true
  };
}

export function normalizeTransportPreferences(input = {}) {
  const userType = USER_TYPES.has(String(input.userType || '').toUpperCase()) ? String(input.userType).toUpperCase() : 'PASSENGER';
  const explicitFlightOptIn = input.includeFlight === true || input.allowFlight === true || input.preferFlight === true;
  const flightEligible = userType === 'CREW_MEMBER' || explicitFlightOptIn;
  const priorities = normalizePriorityWeights(input.priorities || {});
  return {
    userType,
    flightEligible,
    explicitFlightOptIn,
    crewOperationalNeed: userType === 'CREW_MEMBER' && input.crewOperationalNeed === true,
    preferFlight: input.preferFlight === true,
    preferredModes: normalizeModes(input.preferredModes),
    avoidedModes: normalizeModes(input.avoidedModes),
    maxWalkingMinutes: optionalNumber(input.maxWalkingMinutes, 0, 600),
    luggage: safeToken(input.luggage || 'STANDARD'),
    accessibilityRequired: input.accessibilityRequired === true,
    childSeatRequired: input.childSeatRequired === true,
    weatherSensitive: input.weatherSensitive !== false,
    priorities
  };
}

export function buildTransportChoice(input = {}) {
  const preferences = normalizeTransportPreferences(input.preferences || input.profile || input);
  const options = normalizeOptions(input.options || input.routes || []);
  const evaluated = options.map((option) => evaluateOption(option, preferences));
  const eligible = evaluated.filter((item) => item.eligible);
  const ranked = scoreAndRank(eligible, preferences);
  const highlights = buildHighlights(ranked);

  return {
    status: ranked.length ? 'READY_TO_CHOOSE' : options.length ? 'NO_ELIGIBLE_OPTION' : 'NEEDS_ROUTE_OPTIONS',
    preferences,
    consideredCount: options.length,
    eligibleCount: ranked.length,
    excluded: evaluated.filter((item) => !item.eligible).map((item) => ({ id: item.id, title: item.title, reasons: item.exclusionReasons })),
    recommended: ranked[0] || null,
    alternatives: ranked.slice(1, 5),
    highlights,
    providerNeeds: buildProviderNeeds(options, ranked),
    decisionPolicy: {
      bookingAllowedAutomatically: false,
      itineraryMutationAllowed: false,
      userApprovalRequired: true,
      rule: 'Present the best option and meaningful alternatives with trade-offs; the user chooses before any purchase, booking or itinerary change.'
    }
  };
}

function evaluateOption(option, preferences) {
  const exclusionReasons = [];
  const containsFlight = option.modes.includes('FLIGHT');
  if (containsFlight && !preferences.flightEligible) exclusionReasons.push('FLIGHT_NOT_REQUESTED_FOR_PASSENGER');
  if (option.modes.some((mode) => preferences.avoidedModes.includes(mode))) exclusionReasons.push('AVOIDED_MODE');
  if (preferences.maxWalkingMinutes !== null && option.walkingMinutes !== null && option.walkingMinutes > preferences.maxWalkingMinutes) exclusionReasons.push('WALKING_LIMIT_EXCEEDED');
  if (preferences.accessibilityRequired && option.accessibility === false) exclusionReasons.push('ACCESSIBILITY_REQUIREMENT_NOT_MET');
  if (preferences.childSeatRequired && option.childSeatAvailable === false) exclusionReasons.push('CHILD_SEAT_REQUIREMENT_NOT_MET');

  const dataWarnings = [];
  if (option.doorToDoorMinutes === null) dataWarnings.push('DOOR_TO_DOOR_TIME_UNKNOWN');
  if (option.costAmount === null) dataWarnings.push('COST_UNKNOWN');
  if (option.reliabilityScore === null) dataWarnings.push('RELIABILITY_UNKNOWN');
  if (containsFlight && option.doorToDoorMinutes === null) dataWarnings.push('FLIGHT_MUST_USE_DOOR_TO_DOOR_TIME_NOT_AIRBORNE_TIME_ONLY');

  return {
    ...option,
    eligible: exclusionReasons.length === 0,
    exclusionReasons,
    dataWarnings,
    containsFlight
  };
}

function scoreAndRank(options, preferences) {
  if (!options.length) return [];
  const knownTimes = options.map((item) => item.doorToDoorMinutes).filter(Number.isFinite);
  const knownCosts = options.map((item) => item.costAmount).filter(Number.isFinite);
  const minTime = knownTimes.length ? Math.min(...knownTimes) : null;
  const maxTime = knownTimes.length ? Math.max(...knownTimes) : null;
  const minCost = knownCosts.length ? Math.min(...knownCosts) : null;
  const maxCost = knownCosts.length ? Math.max(...knownCosts) : null;

  return options.map((option) => {
    let score = 0;
    const reasons = [];
    const weights = preferences.priorities;

    const timeValue = inverseNormalized(option.doorToDoorMinutes, minTime, maxTime, 0.45);
    const costValue = inverseNormalized(option.costAmount, minCost, maxCost, 0.5);
    const reliabilityValue = option.reliabilityScore ?? 0.5;
    const comfortValue = option.comfortScore ?? 0.5;
    const accessibilityValue = option.accessibility === true ? 1 : option.accessibility === false ? 0 : 0.5;
    const simplicityValue = simplicityScore(option);
    const luggageValue = luggageFitScore(option, preferences.luggage);
    const weatherValue = weatherResilienceScore(option, preferences.weatherSensitive);

    score += timeValue * weights.time;
    score += costValue * weights.cost;
    score += reliabilityValue * weights.reliability;
    score += comfortValue * weights.comfort;
    score += accessibilityValue * weights.accessibility;
    score += simplicityValue * weights.simplicity;
    score += luggageValue * weights.luggage;
    score += weatherValue * weights.weather;

    if (option.modes.some((mode) => preferences.preferredModes.includes(mode))) {
      score += 0.35;
      reasons.push('MATCHES_PREFERRED_MODE');
    }
    if (option.containsFlight && !preferences.preferFlight && !preferences.crewOperationalNeed) {
      score -= 0.35;
      reasons.push('FLIGHT_COMPLEXITY_PENALTY');
    }
    if (!option.containsFlight && preferences.userType === 'PASSENGER') {
      score += 0.15;
      reasons.push('GROUND_FIRST_PASSENGER_BIAS');
    }
    if (option.transfers !== null && option.transfers === 0) reasons.push('DIRECT_OR_NO_TRANSFER');
    if (option.doorToDoorMinutes !== null && option.doorToDoorMinutes === minTime) reasons.push('FASTEST_KNOWN');
    if (option.costAmount !== null && option.costAmount === minCost) reasons.push('LOWEST_KNOWN_COST');
    if (option.reliabilityScore !== null && option.reliabilityScore >= 0.85) reasons.push('HIGH_RELIABILITY');
    if (option.weatherExposure === 'LOW') reasons.push('LOW_WEATHER_EXPOSURE');

    score -= option.dataWarnings.length * 0.12;

    return {
      ...option,
      score: Number(score.toFixed(4)),
      reasons: unique(reasons),
      confidence: confidenceFor(option)
    };
  }).sort((a, b) => b.score - a.score || compareKnown(a.doorToDoorMinutes, b.doorToDoorMinutes) || a.title.localeCompare(b.title));
}

function buildHighlights(ranked) {
  if (!ranked.length) return {};
  return {
    bestOverallId: ranked[0]?.id || null,
    fastestId: bestBy(ranked, 'doorToDoorMinutes', 'MIN'),
    lowestCostId: bestBy(ranked, 'costAmount', 'MIN'),
    simplestId: ranked.slice().sort((a, b) => simplicityScore(b) - simplicityScore(a))[0]?.id || null,
    mostReliableId: bestBy(ranked, 'reliabilityScore', 'MAX'),
    leastWalkingId: bestBy(ranked, 'walkingMinutes', 'MIN')
  };
}

function buildProviderNeeds(options, ranked) {
  const needs = new Set();
  if (!options.length) needs.add('ROUTE_OPTIONS');
  if (options.some((item) => item.doorToDoorMinutes === null)) needs.add('DOOR_TO_DOOR_TIME');
  if (options.some((item) => item.costAmount === null)) needs.add('FARE_OR_PRICE');
  if (options.some((item) => item.reliabilityScore === null)) needs.add('LIVE_OR_HISTORICAL_RELIABILITY');
  if (ranked.some((item) => item.modes.some((mode) => ['PUBLIC_TRANSIT', 'METRO', 'TRAM', 'TRAIN', 'BUS', 'COACH', 'FERRY', 'FLIGHT'].includes(mode)))) needs.add('SCHEDULE_AND_SERVICE_STATUS');
  if (ranked.some((item) => item.modes.some((mode) => ['RIDESHARE', 'TAXI', 'CAR', 'CAR_RENTAL', 'PRIVATE_TRANSFER'].includes(mode)))) needs.add('LIVE_TRAFFIC');
  return [...needs];
}

function normalizeOptions(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).map((item, index) => {
    const modes = normalizeModes(item.modes || item.mode);
    return {
      id: safeString(item.id, 160) || `transport-${index + 1}`,
      title: safeString(item.title, 220) || modes.join(' + ') || 'Opção de transporte',
      modes: modes.length ? modes : ['PUBLIC_TRANSIT'],
      doorToDoorMinutes: optionalNumber(item.doorToDoorMinutes ?? item.totalMinutes ?? item.durationMinutes, 0, 10080),
      costAmount: optionalNumber(item.costAmount ?? item.price?.amount ?? item.fare, 0, 1000000),
      currency: safeToken(item.currency || item.price?.currency || 'BRL'),
      transfers: optionalInteger(item.transfers, 0, 20),
      walkingMinutes: optionalNumber(item.walkingMinutes, 0, 1440),
      waitingMinutes: optionalNumber(item.waitingMinutes, 0, 1440),
      reliabilityScore: optionalNumber(item.reliabilityScore, 0, 1),
      comfortScore: optionalNumber(item.comfortScore, 0, 1),
      accessibility: item.accessibility === true ? true : item.accessibility === false ? false : null,
      childSeatAvailable: item.childSeatAvailable === true ? true : item.childSeatAvailable === false ? false : null,
      luggageFit: safeToken(item.luggageFit || 'UNKNOWN'),
      weatherExposure: WEATHER_EXPOSURE.has(safeToken(item.weatherExposure)) ? safeToken(item.weatherExposure) : inferWeatherExposure(modes),
      departureAt: safeDateTime(item.departureAt),
      arrivalAt: safeDateTime(item.arrivalAt),
      provider: safeString(item.provider, 120),
      provenance: item.provenance && typeof item.provenance === 'object' ? item.provenance : null
    };
  });
}

function normalizePriorityWeights(input) {
  const defaults = { time: 1.0, cost: 0.75, reliability: 0.9, comfort: 0.55, accessibility: 0.55, simplicity: 0.8, luggage: 0.5, weather: 0.45 };
  const output = {};
  for (const [key, fallback] of Object.entries(defaults)) output[key] = clampNumber(input[key], 0, 2, fallback);
  return output;
}

function normalizeModes(input) {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  return unique(values.map((value) => safeToken(value)).filter((value) => MODES.has(value)));
}

function simplicityScore(option) {
  const transfers = option.transfers ?? Math.max(0, option.modes.length - 1);
  const modePenalty = Math.max(0, option.modes.length - 1) * 0.12;
  const transferPenalty = Math.min(0.8, transfers * 0.18);
  return Math.max(0, 1 - modePenalty - transferPenalty);
}

function luggageFitScore(option, luggage) {
  if (option.luggageFit === 'GOOD') return 1;
  if (option.luggageFit === 'POOR') return 0.15;
  if (luggage === 'NONE' || luggage === 'LIGHT') return 0.75;
  if (option.modes.some((mode) => ['TAXI', 'RIDESHARE', 'CAR', 'CAR_RENTAL', 'PRIVATE_TRANSFER'].includes(mode))) return 0.85;
  return 0.5;
}

function weatherResilienceScore(option, enabled) {
  if (!enabled) return 0.5;
  if (option.weatherExposure === 'LOW') return 1;
  if (option.weatherExposure === 'MEDIUM') return 0.6;
  return 0.2;
}

function inferWeatherExposure(modes) {
  if (modes.every((mode) => ['WALK', 'BIKE', 'SCOOTER'].includes(mode))) return 'HIGH';
  if (modes.some((mode) => ['WALK', 'BIKE', 'SCOOTER'].includes(mode))) return 'MEDIUM';
  return 'LOW';
}

function confidenceFor(option) {
  const facts = [option.doorToDoorMinutes, option.costAmount, option.reliabilityScore];
  const known = facts.filter((value) => value !== null).length;
  if (!option.provenance && !option.provider) return known === 3 ? 'MEDIUM' : 'LOW';
  return known === 3 ? 'HIGH' : known >= 2 ? 'MEDIUM' : 'LOW';
}

function inverseNormalized(value, min, max, unknownFallback) {
  if (!Number.isFinite(value)) return unknownFallback;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return 1;
  return 1 - (value - min) / (max - min);
}

function bestBy(items, key, direction) {
  const known = items.filter((item) => Number.isFinite(item[key]));
  if (!known.length) return null;
  known.sort((a, b) => direction === 'MAX' ? b[key] - a[key] : a[key] - b[key]);
  return known[0].id;
}

function compareKnown(a, b) {
  if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
  if (Number.isFinite(a)) return -1;
  if (Number.isFinite(b)) return 1;
  return 0;
}

function optionalNumber(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function optionalInteger(value, min, max) {
  const parsed = optionalNumber(value, min, max);
  return parsed === null ? null : Math.round(parsed);
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const string = String(value).trim();
  return string ? string.slice(0, max) : null;
}

function safeToken(value) {
  const token = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return token || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
