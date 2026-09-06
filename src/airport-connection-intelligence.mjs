const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'IMPOSSIBLE'];
const SERVICE_STATES = new Set(['VERIFIED_RECENT', 'VERIFY_LIVE', 'UNAVAILABLE', 'UNKNOWN']);

export function airportConnectionCapabilities() {
  return {
    version: '1.0',
    purpose: 'Plan airport-to-airport ground connections using the real connection window, airport processes, traffic, schedule, reliability and cost.',
    principles: [
      'Detect airport changes automatically when consecutive flight legs use different airports in the same journey.',
      'Feasibility outranks price: a free or cheap transfer is never recommended if it creates an unsafe connection.',
      'Use live traffic when available and historical time-of-day traffic as a fallback; do not rely on one static city-wide travel time.',
      'Use p90 or conservative travel time for tight connections and peak periods, not only the average.',
      'Compare airline shuttles, public transport, taxi, rideshare and private transfer when verified options exist.',
      'Airline shuttles are eligibility-based benefits and must be verified for current operation, timetable and capacity before recommendation.',
      'Average prices are reference values only; live quotes take precedence when available.',
      'Baggage reclaim, immigration, terminal exit, check-in, security and boarding margins are part of the connection calculation.',
      'Never invent a shuttle, timetable, fare, traffic duration or service availability.',
      'The system may recommend and warn automatically, but purchasing, booking or changing the itinerary requires explicit user approval.'
    ],
    inputs: [
      'INBOUND_ARRIVAL_TIME', 'OUTBOUND_DEPARTURE_TIME', 'ARRIVAL_AIRPORT', 'DEPARTURE_AIRPORT',
      'BAGGAGE_AND_BORDER_PROCESS', 'LIVE_TRAFFIC', 'HISTORICAL_TRAFFIC_BY_TIME', 'TRANSFER_SCHEDULE',
      'AVERAGE_OR_LIVE_PRICE', 'AIRLINE_ELIGIBILITY', 'SERVICE_STATUS', 'TERMINAL_PROCESS_TIME'
    ],
    outputs: ['BEST_OVERALL', 'FASTEST', 'LOWEST_COST', 'LOWEST_RISK', 'CONNECTION_RISK', 'LATEST_SAFE_DEPARTURE', 'PROVIDER_NEEDS'],
    approvalRequiredForPurchase: true,
    approvalRequiredForItineraryMutation: true
  };
}

export function knownAirportConnectionFacts() {
  return [
    {
      pair: ['CGH', 'VCP'],
      serviceId: 'AZUL_BUS_CGH_VCP',
      type: 'AIRLINE_SHUTTLE',
      operator: 'AZUL',
      state: 'VERIFIED_RECENT',
      requiresFreshCheck: true,
      price: { amount: 0, currency: 'BRL', type: 'FREE_FOR_ELIGIBLE_CUSTOMERS' },
      eligibility: 'Azul customers embarking or disembarking at Viracopos; boarding pass and photo ID required.',
      reservation: 'NO_RESERVATION_SUBJECT_TO_AVAILABILITY',
      operationalNotes: [
        'Official Azul information states the bus operates exclusively between Congonhas and Viracopos.',
        'Passenger should arrive at the bus departure point at least 30 minutes before bus departure.',
        'For domestic Azul flights, choose a bus scheduled to arrive at least 60 minutes before flight departure.',
        'Schedules and rules may change; refresh from the official provider before each trip.'
      ],
      provenance: { kind: 'OFFICIAL_AIRLINE', observed: '2026-09' }
    },
    {
      pair: ['CGH', 'GRU'],
      serviceId: 'GOL_BUS_CGH_GRU',
      type: 'AIRLINE_SHUTTLE',
      operator: 'GOL',
      state: 'VERIFY_LIVE',
      requiresFreshCheck: true,
      price: null,
      eligibility: 'Do not assume eligibility until current GOL rules are confirmed.',
      reservation: 'UNKNOWN_UNTIL_FRESH_CHECK',
      operationalNotes: [
        'Current online sources are inconsistent about whether the GOL airport shuttle is operating.',
        'The Voyage catalog must not mark this service as available until a fresh official check confirms operation, schedule and eligibility.',
        'If not confirmed, compare paid coach/public transport, taxi, rideshare and private transfer instead.'
      ],
      provenance: { kind: 'CONFLICTING_SOURCES', observed: '2026-09' }
    },
    {
      pair: ['SDU', 'GIG'],
      serviceId: 'RIO_VLT_GENTILEZA_GIG',
      type: 'PUBLIC_TRANSIT_COMBINATION',
      operator: 'VLT_CARIOCA_MOBIRIO',
      state: 'VERIFIED_RECENT',
      requiresFreshCheck: true,
      price: { amount: 20, currency: 'BRL', type: 'REFERENCE_TOTAL' },
      eligibility: 'PUBLIC',
      reservation: 'NO_RESERVATION',
      referenceDurationMinutes: 55,
      operationalNotes: [
        'VLT Line 1 links Santos Dumont and Terminal Gentileza in about 30 minutes under regular operation.',
        'A direct executive bus links Terminal Gentileza and Galeão in about 25 minutes; current reference fare is R$15.',
        'Current VLT reference fare is R$5.',
        'Add transfer/waiting time at Terminal Gentileza and refresh schedules before recommending for a flight connection.'
      ],
      provenance: { kind: 'OFFICIAL_CITY_AND_AIRPORT', observed: '2026-09' }
    },
    {
      pair: ['SDU', 'GIG'],
      serviceId: 'RIO_CONVENTIONAL_TAXI_REFERENCE',
      type: 'TAXI',
      operator: 'LICENSED_TAXI',
      state: 'VERIFIED_RECENT',
      requiresFreshCheck: true,
      price: { min: 90, max: 106, currency: 'BRL', type: 'OFFICIAL_REFERENCE_FROM_SDU' },
      eligibility: 'PUBLIC',
      reservation: 'OPTIONAL',
      operationalNotes: [
        'Official 2026 conventional taxi table from Santos Dumont lists Galeão at R$90 tariff 1 and R$106 tariff 2.',
        'Traffic time must be refreshed for the planned transfer time.'
      ],
      provenance: { kind: 'OFFICIAL_CITY_TAXI_TABLE', observed: '2026-01' }
    }
  ];
}

export function buildAirportConnectionPlan(input = {}) {
  const connection = normalizeConnection(input.connection || input);
  const options = normalizeOptions(input.options || []);
  const facts = Array.isArray(input.knownFacts) ? input.knownFacts : knownAirportConnectionFacts();
  const airportChange = connection.arrivalAirport && connection.departureAirport && connection.arrivalAirport !== connection.departureAirport;

  if (!connection.inboundArrivalAt || !connection.outboundDepartureAt || !connection.arrivalAirport || !connection.departureAirport) {
    return {
      status: 'NEEDS_INPUT',
      airportChange,
      connection,
      missing: missingInputs(connection),
      providerNeeds: ['CONNECTION_TIMES_AND_AIRPORTS'],
      decisionPolicy: decisionPolicy()
    };
  }

  const totalConnectionMinutes = Math.floor((Date.parse(connection.outboundDepartureAt) - Date.parse(connection.inboundArrivalAt)) / 60000);
  const arrivalProcessMinutes = connection.arrivalProcessMinutes;
  const departureProcessMinutes = connection.departureProcessMinutes;
  const transferableMinutes = totalConnectionMinutes - arrivalProcessMinutes - departureProcessMinutes;
  const earliestGroundDepartureAt = new Date(Date.parse(connection.inboundArrivalAt) + arrivalProcessMinutes * 60000).toISOString();
  const latestAirportArrivalAt = new Date(Date.parse(connection.outboundDepartureAt) - departureProcessMinutes * 60000).toISOString();

  const evaluated = options.map((option) => evaluateOption(option, {
    connection,
    transferableMinutes,
    earliestGroundDepartureAt,
    latestAirportArrivalAt
  }));
  const eligible = evaluated.filter((option) => option.eligible);
  const ranked = eligible.sort(compareOptions);
  const providerNeeds = buildProviderNeeds(connection, options, facts);
  const relevantFacts = relevantKnownFacts(connection.arrivalAirport, connection.departureAirport, facts);

  return {
    status: totalConnectionMinutes <= 0 ? 'INVALID_CONNECTION' : ranked.length ? 'READY_TO_CHOOSE' : 'NO_SAFE_OPTION_YET',
    airportChange,
    connection: {
      ...connection,
      totalConnectionMinutes,
      arrivalProcessMinutes,
      departureProcessMinutes,
      transferableMinutes,
      earliestGroundDepartureAt,
      latestAirportArrivalAt
    },
    recommended: ranked[0] || null,
    alternatives: ranked.slice(1, 5),
    excludedOrUnsafe: evaluated.filter((option) => !option.eligible || option.riskLevel === 'IMPOSSIBLE'),
    highlights: buildHighlights(ranked),
    relevantKnownFacts,
    providerNeeds,
    decisionPolicy: decisionPolicy()
  };
}

function evaluateOption(option, context) {
  const warnings = [];
  const connection = context.connection;
  if (option.serviceState === 'VERIFY_LIVE') warnings.push('SERVICE_REQUIRES_FRESH_CONFIRMATION');
  if (option.serviceState === 'UNAVAILABLE') warnings.push('SERVICE_UNAVAILABLE');
  if (option.eligibilityConfirmed === false) warnings.push('NOT_ELIGIBLE');
  if (option.capacityGuaranteed === false) warnings.push('CAPACITY_NOT_GUARANTEED');
  if (option.liveTravelMinutes === null) warnings.push('LIVE_TRAFFIC_UNKNOWN');
  if (option.averagePrice === null && option.livePrice === null && option.priceMin === null) warnings.push('PRICE_UNKNOWN');

  const waitMinutes = computeWaitMinutes(option, context.earliestGroundDepartureAt);
  const baseTravel = firstNumber(option.liveTravelMinutes, option.p90TravelMinutes, option.averageTravelMinutes);
  const conservativeTravelMinutes = conservativeTravel(option);
  const totalExpectedMinutes = baseTravel === null ? null : baseTravel + waitMinutes + option.transferBufferMinutes;
  const totalConservativeMinutes = conservativeTravelMinutes === null ? null : conservativeTravelMinutes + waitMinutes + option.transferBufferMinutes;
  const slackMinutes = totalConservativeMinutes === null ? null : context.transferableMinutes - totalConservativeMinutes;
  const riskLevel = riskFromSlack(slackMinutes, option.reliabilityScore);
  const eligible = option.serviceState !== 'UNAVAILABLE' && option.serviceState !== 'VERIFY_LIVE' && option.eligibilityConfirmed !== false && totalConservativeMinutes !== null && slackMinutes >= 0;
  const latestSafeDepartureAt = conservativeTravelMinutes === null ? null : new Date(Date.parse(context.latestAirportArrivalAt) - (conservativeTravelMinutes + option.transferBufferMinutes) * 60000).toISOString();
  const priceReference = firstNumber(option.livePrice, option.averagePrice, option.priceMin);

  return {
    ...option,
    waitMinutes,
    totalExpectedMinutes,
    totalConservativeMinutes,
    slackMinutes,
    riskLevel,
    eligible,
    latestSafeDepartureAt,
    priceReference,
    warnings: unique(warnings),
    rationale: buildRationale(option, { slackMinutes, riskLevel, priceReference, totalExpectedMinutes, connection })
  };
}

function compareOptions(a, b) {
  const riskDiff = RISK_LEVELS.indexOf(a.riskLevel) - RISK_LEVELS.indexOf(b.riskLevel);
  if (riskDiff) return riskDiff;
  const reliabilityA = a.reliabilityScore ?? 0.5;
  const reliabilityB = b.reliabilityScore ?? 0.5;
  if (reliabilityA !== reliabilityB) return reliabilityB - reliabilityA;
  const timeA = a.totalExpectedMinutes ?? Number.POSITIVE_INFINITY;
  const timeB = b.totalExpectedMinutes ?? Number.POSITIVE_INFINITY;
  if (timeA !== timeB) return timeA - timeB;
  const costA = a.priceReference ?? Number.POSITIVE_INFINITY;
  const costB = b.priceReference ?? Number.POSITIVE_INFINITY;
  return costA - costB;
}

function buildHighlights(ranked) {
  if (!ranked.length) return { bestOverallId: null, fastestId: null, lowestCostId: null, lowestRiskId: null };
  return {
    bestOverallId: ranked[0].id,
    fastestId: ranked.slice().sort((a, b) => (a.totalExpectedMinutes ?? Infinity) - (b.totalExpectedMinutes ?? Infinity))[0]?.id || null,
    lowestCostId: ranked.slice().filter((item) => item.priceReference !== null).sort((a, b) => a.priceReference - b.priceReference)[0]?.id || null,
    lowestRiskId: ranked.slice().sort(compareOptions)[0]?.id || null
  };
}

function buildProviderNeeds(connection, options, facts) {
  const needs = new Set();
  if (!options.length) needs.add('AIRPORT_TRANSFER_OPTIONS');
  if (options.some((item) => item.liveTravelMinutes === null)) needs.add('LIVE_TRAFFIC');
  if (options.some((item) => item.p90TravelMinutes === null)) needs.add('HISTORICAL_TRAFFIC_BY_TIME_OF_DAY');
  if (options.some((item) => item.livePrice === null)) needs.add('LIVE_OR_RECENT_PRICE');
  if (options.some((item) => item.scheduleTimes.length || ['AIRLINE_SHUTTLE', 'PUBLIC_TRANSIT', 'COACH'].includes(item.type))) needs.add('LIVE_SCHEDULE_AND_SERVICE_STATUS');
  if (relevantKnownFacts(connection.arrivalAirport, connection.departureAirport, facts).some((fact) => fact.requiresFreshCheck)) needs.add('REFRESH_KNOWN_SERVICE_FACTS');
  if (connection.checkedBaggage || connection.internationalArrival) needs.add('ARRIVAL_PROCESS_TIME');
  if (connection.internationalDeparture || connection.checkedBaggage) needs.add('DEPARTURE_PROCESS_TIME');
  return [...needs];
}

function relevantKnownFacts(from, to, facts) {
  return (Array.isArray(facts) ? facts : []).filter((fact) => Array.isArray(fact.pair) && fact.pair.includes(from) && fact.pair.includes(to));
}

function normalizeConnection(input) {
  const checkedBaggage = input.checkedBaggage === true || input.checkedBag === true;
  const internationalArrival = input.internationalArrival === true;
  const internationalDeparture = input.internationalDeparture === true;
  const defaultArrivalProcess = internationalArrival ? 75 : checkedBaggage ? 35 : 20;
  const defaultDepartureProcess = internationalDeparture ? 150 : checkedBaggage ? 90 : 75;
  return {
    arrivalAirport: airportCode(input.arrivalAirport || input.inboundAirport || input.fromAirport),
    departureAirport: airportCode(input.departureAirport || input.outboundAirport || input.toAirport),
    inboundArrivalAt: safeDateTime(input.inboundArrivalAt || input.arrivalAt),
    outboundDepartureAt: safeDateTime(input.outboundDepartureAt || input.departureAt),
    inboundAirline: safeToken(input.inboundAirline),
    outboundAirline: safeToken(input.outboundAirline),
    checkedBaggage,
    internationalArrival,
    internationalDeparture,
    selfTransfer: input.selfTransfer !== false,
    arrivalProcessMinutes: clampInteger(input.arrivalProcessMinutes, 0, 360, defaultArrivalProcess),
    departureProcessMinutes: clampInteger(input.departureProcessMinutes, 30, 360, defaultDepartureProcess)
  };
}

function normalizeOptions(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).map((item, index) => ({
    id: safeString(item.id, 160) || `airport-transfer-${index + 1}`,
    title: safeString(item.title, 220) || safeToken(item.type || item.mode || 'TRANSFER'),
    type: safeToken(item.type || item.mode || 'TRANSFER'),
    provider: safeString(item.provider, 160),
    serviceState: SERVICE_STATES.has(safeToken(item.serviceState || item.state)) ? safeToken(item.serviceState || item.state) : 'UNKNOWN',
    eligibilityConfirmed: item.eligibilityConfirmed === true ? true : item.eligibilityConfirmed === false ? false : null,
    capacityGuaranteed: item.capacityGuaranteed === true ? true : item.capacityGuaranteed === false ? false : null,
    scheduleTimes: Array.isArray(item.scheduleTimes) ? item.scheduleTimes.map(safeDateTime).filter(Boolean).sort() : [],
    liveTravelMinutes: optionalNumber(item.liveTravelMinutes, 0, 1440),
    averageTravelMinutes: optionalNumber(item.averageTravelMinutes ?? item.durationMinutes, 0, 1440),
    p90TravelMinutes: optionalNumber(item.p90TravelMinutes, 0, 2880),
    peakMultiplier: optionalNumber(item.peakMultiplier, 1, 5),
    peakExposure: safeToken(item.peakExposure || 'UNKNOWN'),
    transferBufferMinutes: clampInteger(item.transferBufferMinutes, 0, 180, 10),
    livePrice: optionalNumber(item.livePrice, 0, 100000),
    averagePrice: optionalNumber(item.averagePrice, 0, 100000),
    priceMin: optionalNumber(item.priceMin, 0, 100000),
    priceMax: optionalNumber(item.priceMax, 0, 100000),
    currency: safeToken(item.currency || 'BRL'),
    reliabilityScore: optionalNumber(item.reliabilityScore, 0, 1),
    luggageFit: safeToken(item.luggageFit || 'UNKNOWN'),
    accessibility: item.accessibility === true ? true : item.accessibility === false ? false : null,
    provenance: sanitizeProvenance(item.provenance)
  }));
}

function conservativeTravel(option) {
  const values = [option.liveTravelMinutes, option.p90TravelMinutes].filter(Number.isFinite);
  if (Number.isFinite(option.averageTravelMinutes)) {
    values.push(option.averageTravelMinutes * (option.peakMultiplier || 1));
  }
  return values.length ? Math.ceil(Math.max(...values)) : null;
}

function computeWaitMinutes(option, earliestDepartureAt) {
  if (!option.scheduleTimes.length) return 0;
  const earliest = Date.parse(earliestDepartureAt);
  const next = option.scheduleTimes.find((time) => Date.parse(time) >= earliest);
  if (!next) return 9999;
  return Math.max(0, Math.ceil((Date.parse(next) - earliest) / 60000));
}

function riskFromSlack(slackMinutes, reliability) {
  if (!Number.isFinite(slackMinutes) || slackMinutes < 0) return 'IMPOSSIBLE';
  if (slackMinutes < 20 || (reliability !== null && reliability < 0.65)) return 'HIGH';
  if (slackMinutes < 45 || (reliability !== null && reliability < 0.8)) return 'MEDIUM';
  return 'LOW';
}

function buildRationale(option, metrics) {
  const reasons = [];
  if (metrics.riskLevel === 'LOW') reasons.push('CONNECTION_MARGIN_HEALTHY');
  if (metrics.riskLevel === 'MEDIUM') reasons.push('CONNECTION_MARGIN_MODERATE');
  if (metrics.riskLevel === 'HIGH') reasons.push('CONNECTION_MARGIN_TIGHT');
  if (option.peakExposure === 'HIGH') reasons.push('PEAK_TRAFFIC_EXPOSURE');
  if (option.liveTravelMinutes !== null) reasons.push('USES_LIVE_TRAFFIC');
  else if (option.p90TravelMinutes !== null) reasons.push('USES_CONSERVATIVE_HISTORICAL_TIME');
  if (metrics.priceReference === 0) reasons.push('FREE_IF_ELIGIBLE');
  if (option.capacityGuaranteed === false) reasons.push('CAPACITY_NOT_GUARANTEED');
  return reasons;
}

function missingInputs(connection) {
  const missing = [];
  if (!connection.arrivalAirport) missing.push('ARRIVAL_AIRPORT');
  if (!connection.departureAirport) missing.push('DEPARTURE_AIRPORT');
  if (!connection.inboundArrivalAt) missing.push('INBOUND_ARRIVAL_TIME');
  if (!connection.outboundDepartureAt) missing.push('OUTBOUND_DEPARTURE_TIME');
  return missing;
}

function decisionPolicy() {
  return {
    automaticPurchaseAllowed: false,
    automaticItineraryMutationAllowed: false,
    userApprovalRequired: true,
    rule: 'Warn and recommend automatically; do not buy, book, cancel or change itinerary without explicit user approval.'
  };
}

function airportCode(value) {
  const code = safeToken(value);
  return code && /^[A-Z0-9]{3,4}$/.test(code) ? code : null;
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeToken(value) {
  if (value === null || value === undefined) return null;
  const token = String(value).trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return token || null;
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function optionalNumber(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : fallback;
}

function firstNumber(...values) {
  return values.find(Number.isFinite) ?? null;
}

function sanitizeProvenance(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    source: safeString(value.source || value.provider, 160),
    observedAt: safeDateTime(value.observedAt || value.updatedAt),
    confidence: optionalNumber(value.confidence, 0, 1)
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
