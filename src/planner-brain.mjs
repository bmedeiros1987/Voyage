const TRIP_STYLES = new Set(['RELAXED', 'BALANCED', 'INTENSE']);
const DAY_TYPES = new Set(['ARRIVAL', 'FULL', 'DEPARTURE', 'WORK', 'RECOVERY', 'TRANSFER']);
const CHANGE_TYPES = new Set(['DELAY', 'CANCELLATION', 'CLOSURE', 'WEATHER', 'TRAFFIC', 'RUNNING_LATE', 'FATIGUE', 'NEW_RESERVATION', 'USER_CHANGE']);

const PHASES = [
  'UNDERSTAND_INTENT',
  'ESTABLISH_GROUND_TRUTH',
  'LOCK_HARD_ANCHORS',
  'SHAPE_EACH_DAY',
  'DISCOVER_CANDIDATES',
  'CLUSTER_GEOGRAPHICALLY',
  'PLACE_MEALS_WORK_REST',
  'OPTIMIZE_ROUTE_AND_TIME',
  'VERIFY_FEASIBILITY',
  'STRESS_TEST',
  'EXPLAIN_PLAN',
  'MONITOR_AND_REPLAN'
];

export function plannerBrainCapabilities() {
  return {
    brainVersion: '1.0',
    phases: PHASES,
    dayTypes: [...DAY_TYPES],
    tripStyles: [...TRIP_STYLES],
    changeTypes: [...CHANGE_TYPES],
    learnsFrom: ['EXPLICIT_PREFERENCE', 'PIN', 'UNPIN', 'ACCEPT', 'REJECT', 'VISITED', 'SKIPPED', 'RATING', 'MANUAL_EDIT'],
    rules: [
      'Facts beat guesses: never fabricate opening hours, prices, reviews, availability, travel time or reservation details.',
      'Hard anchors are scheduled before optional activities.',
      'A good itinerary optimizes the whole day, not each place independently.',
      'User-created Google Maps/My Maps places are high-value intent signals, but are movable unless explicitly locked.',
      'Meals, work, sleep, recovery, accessibility and return margins are first-class planning constraints.',
      'Prefer geographic clusters and fewer meaningful stops over avoidable backtracking.',
      'Preserve free time when the user values spontaneity or recovery.',
      'Every material automatic decision should be explainable and reversible.',
      'Behavioral learning is lower-confidence than explicit user choices and must never silently override a hard preference.'
    ]
  };
}

export function buildPlanningBrief(input = {}) {
  const intent = normalizeIntent(input.intent || input.wishes || {});
  const trip = normalizeTrip(input.trip || {});
  const anchors = normalizeAnchors(input.anchors || input.fixedEvents || []);
  const importedPlaces = normalizePlaces(input.importedPlaces || input.places || []);
  const questions = buildHighImpactQuestions({ trip, intent, anchors, input });
  const dayTypes = inferDayTypes(trip, anchors, input.workBlocks || []);

  return {
    brainVersion: '1.0',
    status: questions.some((question) => question.required) ? 'NEEDS_INPUT' : 'READY_FOR_RESEARCH',
    trip,
    intent,
    anchors,
    importedPlaces,
    dayTypes,
    questions,
    planningDoctrine: buildDoctrine(intent),
    researchNeeds: buildResearchNeeds({ intent, trip, anchors, importedPlaces, input }),
    provenancePolicy: 'Every external fact used by the planner must carry source, freshness and confidence; unknown stays unknown.'
  };
}

export function buildPlanningStrategy(input = {}) {
  const brief = input.brief && input.brief.brainVersion ? input.brief : buildPlanningBrief(input);
  const priorities = rankPriorities(brief.intent);

  return {
    brainVersion: brief.brainVersion,
    status: brief.status === 'NEEDS_INPUT' ? 'WAITING_FOR_REQUIRED_INPUT' : 'READY_TO_EXECUTE',
    priorities,
    phases: PHASES.map((phase, index) => ({
      order: index + 1,
      phase,
      objective: phaseObjective(phase),
      stopCondition: phaseStopCondition(phase)
    })),
    dayPolicies: brief.dayTypes.map((day) => dayPolicy(day, brief.intent)),
    candidatePolicy: {
      userPinnedBoost: 3.0,
      verifiedQualityWeight: 1.6,
      interestFitWeight: 2.2,
      travelPenaltyWeight: 1.4,
      backtrackingPenalty: 1.5,
      unknownFactPenalty: 0.35,
      lockedItemsNeverSilentlyMoved: true
    },
    freeTimePolicy: freeTimePolicy(brief.intent),
    failurePolicy: 'If feasibility depends on a missing fact, flag it and request/resolve the fact instead of pretending the itinerary works.'
  };
}

export function assessPlanQuality(input = {}) {
  const items = Array.isArray(input.items) ? input.items.slice(0, 500) : [];
  const violations = [];
  const warnings = [];
  let score = 100;

  for (const item of items) {
    if (item.hardConstraintViolated === true) {
      violations.push(`HARD_CONSTRAINT:${safeToken(item.id || item.title || 'ITEM')}`);
      score -= 35;
    }
    if (item.openingHoursKnown === false && item.requiresOpeningHours === true) {
      warnings.push(`OPENING_HOURS_UNKNOWN:${safeToken(item.id || item.title || 'ITEM')}`);
      score -= 4;
    }
    if (item.travelTimeKnown === false && item.previousLocationId) {
      warnings.push(`TRAVEL_TIME_UNKNOWN:${safeToken(item.id || item.title || 'ITEM')}`);
      score -= 3;
    }
    if (Number.isFinite(Number(item.transitionMinutes)) && Number(item.transitionMinutes) < 0) {
      violations.push(`IMPOSSIBLE_TRANSITION:${safeToken(item.id || item.title || 'ITEM')}`);
      score -= 25;
    }
  }

  const metrics = input.metrics || {};
  const backtrackingMinutes = positiveNumber(metrics.backtrackingMinutes);
  const freeTimeMinutes = positiveNumber(metrics.freeTimeMinutes);
  const dailyActivityCount = positiveNumber(metrics.dailyActivityCount);
  if (backtrackingMinutes > 90) {
    warnings.push('EXCESSIVE_BACKTRACKING');
    score -= Math.min(15, Math.round(backtrackingMinutes / 30));
  }
  if (dailyActivityCount > 8) {
    warnings.push('DAY_OVERLOADED');
    score -= Math.min(12, (dailyActivityCount - 8) * 2);
  }
  if (input.intent?.protectFreeTime === true && freeTimeMinutes < 60) {
    warnings.push('INSUFFICIENT_FREE_TIME');
    score -= 8;
  }

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    grade: score >= 90 ? 'EXCELLENT' : score >= 75 ? 'GOOD' : score >= 60 ? 'FRAGILE' : 'REPLAN',
    feasible: violations.length === 0,
    violations: unique(violations),
    warnings: unique(warnings),
    recommendation: violations.length ? 'REPLAN_REQUIRED' : warnings.length ? 'REVIEW_AND_OPTIMIZE' : 'PLAN_READY'
  };
}

export function buildReplanDecision(input = {}) {
  const changeType = CHANGE_TYPES.has(input.changeType) ? input.changeType : 'USER_CHANGE';
  const lockedItems = Array.isArray(input.lockedItems) ? input.lockedItems.map((item) => safeToken(item.id || item)).filter(Boolean) : [];
  const actions = [];

  if (changeType === 'DELAY' || changeType === 'RUNNING_LATE' || changeType === 'TRAFFIC') {
    actions.push('PRESERVE_NEXT_HARD_ANCHOR', 'REMOVE_LOWEST_VALUE_OPTIONAL_STOP', 'RECALCULATE_TRANSITIONS');
  } else if (changeType === 'CLOSURE' || changeType === 'CANCELLATION') {
    actions.push('REMOVE_UNAVAILABLE_ITEM', 'FIND_NEARBY_EQUIVALENT', 'REOPTIMIZE_LOCAL_CLUSTER');
  } else if (changeType === 'WEATHER') {
    actions.push('MOVE_WEATHER_SENSITIVE_ITEMS_WHEN_POSSIBLE', 'PREFER_INDOOR_ALTERNATIVES', 'PRESERVE_LOCKED_RESERVATIONS');
  } else if (changeType === 'FATIGUE') {
    actions.push('REDUCE_STOP_COUNT', 'WIDEN_BUFFERS', 'PROTECT_MEALS_AND_REST', 'PREFER_NEARBY_OPTIONS');
  } else if (changeType === 'NEW_RESERVATION') {
    actions.push('ADD_AS_HARD_ANCHOR', 'REBUILD_DAY_AROUND_NEW_ANCHOR', 'SHOW_DISPLACED_ITEMS');
  } else {
    actions.push('APPLY_USER_CHANGE', 'RECHECK_CONSTRAINTS', 'REOPTIMIZE_AFFECTED_DAY');
  }

  return {
    changeType,
    preserve: lockedItems,
    actions,
    diffRequired: true,
    explanationRequired: true,
    policy: 'Replan the smallest affected scope first; never silently rewrite the whole trip when a local repair is sufficient.'
  };
}

export function buildPreferenceLearningEvent(input = {}) {
  const source = String(input.source || 'EXPLICIT_PREFERENCE').toUpperCase();
  const explicit = source === 'EXPLICIT_PREFERENCE' || source === 'MANUAL_EDIT';
  const value = sanitizeLearningValue(input.value);
  return {
    eventType: safeToken(input.eventType || source),
    source,
    dimension: safeToken(input.dimension || 'GENERAL'),
    value,
    confidence: explicit ? 1 : clampNumber(input.confidence, 0.05, 0.8, 0.45),
    reversible: true,
    mayOverrideHardPreference: false,
    retentionPolicy: explicit ? 'PERSIST_UNTIL_USER_CHANGES' : 'DECAY_OVER_TIME',
    rationale: safeString(input.rationale, 500)
  };
}

function normalizeIntent(input) {
  const style = TRIP_STYLES.has(String(input.style || input.pace).toUpperCase()) ? String(input.style || input.pace).toUpperCase() : 'BALANCED';
  return {
    style,
    purposes: unique(input.purposes || input.goals).slice(0, 20),
    interests: unique(input.interests || input.tags).slice(0, 40),
    mustDo: unique(input.mustDo || input.mustSee).slice(0, 50),
    avoid: unique(input.avoid).slice(0, 50),
    preferredCuisines: unique(input.preferredCuisines).slice(0, 30),
    dietaryFilters: unique(input.dietaryFilters || input.dietaryPreferences).slice(0, 30),
    prioritizeLocalExperience: input.prioritizeLocalExperience !== false,
    protectFreeTime: input.protectFreeTime === true || style === 'RELAXED',
    spontaneous: input.spontaneous === true,
    budgetSensitivity: clampNumber(input.budgetSensitivity, 0, 1, 0.5),
    walkingTolerance: clampNumber(input.walkingTolerance, 0, 1, 0.6),
    nightlifeInterest: clampNumber(input.nightlifeInterest, 0, 1, 0.3),
    foodInterest: clampNumber(input.foodInterest, 0, 1, 0.7),
    cultureInterest: clampNumber(input.cultureInterest, 0, 1, 0.6),
    natureInterest: clampNumber(input.natureInterest, 0, 1, 0.5),
    shoppingInterest: clampNumber(input.shoppingInterest, 0, 1, 0.3),
    fitnessInterest: clampNumber(input.fitnessInterest, 0, 1, 0.3)
  };
}

function normalizeTrip(input) {
  return {
    destination: safeString(input.destination, 220),
    startDate: safeDate(input.startDate),
    endDate: safeDate(input.endDate),
    timeZone: safeString(input.timeZone, 100),
    hotelLocationId: safeString(input.hotelLocationId, 220),
    arrivalAt: safeDateTime(input.arrivalAt),
    departureAt: safeDateTime(input.departureAt)
  };
}

function normalizeAnchors(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 300).map((item, index) => ({
    id: safeString(item.id, 160) || `anchor-${index + 1}`,
    title: safeString(item.title, 220) || 'Compromisso',
    kind: safeToken(item.kind || 'FIXED_EVENT'),
    startsAt: safeDateTime(item.startsAt),
    endsAt: safeDateTime(item.endsAt),
    locationId: safeString(item.locationId, 220),
    locked: item.locked !== false,
    source: safeToken(item.source || 'USER')
  }));
}

function normalizePlaces(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 1000).map((item, index) => ({
    id: safeString(item.id, 160) || `place-${index + 1}`,
    title: safeString(item.title, 220) || 'Lugar salvo',
    locationId: safeString(item.locationId, 220),
    source: safeToken(item.source || 'USER_IMPORTED'),
    userPinned: item.userPinned !== false,
    locked: item.locked === true,
    tags: unique(item.tags).slice(0, 30)
  }));
}

function buildHighImpactQuestions({ trip, intent, anchors, input }) {
  const questions = [];
  if (!trip.destination) questions.push({ id: 'DESTINATION', required: true, prompt: 'Para onde você quer viajar?' });
  if (!trip.startDate || !trip.endDate) questions.push({ id: 'DATES', required: true, prompt: 'Quais datas ou janela você quer usar?' });
  if (!intent.purposes.length && !intent.mustDo.length && !intent.interests.length) {
    questions.push({ id: 'TRIP_WISH', required: false, prompt: 'O que faria esta viagem valer a pena para você?', examples: ['comer bem', 'ver os principais pontos', 'descansar', 'museus', 'vida noturna', 'natureza'] });
  }
  if (!input.mealWindows) questions.push({ id: 'MEAL_WINDOWS', required: false, prompt: 'Quer manter seus horários habituais de refeições ou adaptar ao destino?' });
  if (input.userType === 'CREW_MEMBER' && !Number.isFinite(Number(input.returnMarginHours))) {
    questions.push({ id: 'RETURN_MARGIN', required: false, prompt: 'Quanto de margem você quer preservar antes da próxima apresentação/jornada?' });
  }
  if (!anchors.length && input.hasImportedReservations === true) {
    questions.push({ id: 'RESERVATION_SYNC', required: false, prompt: 'Encontrei reservas importadas; posso tratá-las como compromissos fixos?' });
  }
  return questions;
}

function inferDayTypes(trip, anchors, workBlocks) {
  if (!trip.startDate || !trip.endDate) return [];
  const dates = dateRange(trip.startDate, trip.endDate, 90);
  return dates.map((date, index) => {
    let type = 'FULL';
    if (index === 0 && trip.arrivalAt) type = 'ARRIVAL';
    if (index === dates.length - 1 && trip.departureAt) type = 'DEPARTURE';
    if ((Array.isArray(workBlocks) ? workBlocks : []).some((item) => localDate(item.startsAt || item.localDate) === date)) type = 'WORK';
    if (anchors.some((anchor) => anchor.kind === 'TRANSFER' && localDate(anchor.startsAt) === date)) type = 'TRANSFER';
    return { date, type: DAY_TYPES.has(type) ? type : 'FULL' };
  });
}

function buildDoctrine(intent) {
  const rules = ['Schedule certainty first, discovery second.', 'Keep geographically related experiences together.', 'Do not spend the trip commuting between recommendations.'];
  if (intent.style === 'RELAXED') rules.push('Prefer one or two memorable anchors per half-day and protect recovery/free time.');
  if (intent.style === 'INTENSE') rules.push('Use more stops only when transitions and opening windows remain verified and realistic.');
  if (intent.foodInterest >= 0.7) rules.push('Treat meals as experiences worth planning, not gaps to fill at the last minute.');
  if (intent.spontaneous) rules.push('Leave deliberate unscheduled windows near strong geographic clusters.');
  return rules;
}

function buildResearchNeeds({ intent, trip, anchors, importedPlaces, input }) {
  const needs = new Set(['OPENING_HOURS', 'PLACE_QUALITY', 'ROUTE_TIME_DISTANCE']);
  if (intent.foodInterest > 0.3 || intent.dietaryFilters.length) needs.add('FOOD_DISCOVERY');
  if (intent.fitnessInterest > 0.3) needs.add('GYM_WELLNESS_DISCOVERY');
  if (input.weatherAware !== false) needs.add('WEATHER');
  if (input.liveTraffic === true) needs.add('LIVE_TRAFFIC');
  if (input.publicTransit !== false) needs.add('PUBLIC_TRANSIT');
  if (!trip.hotelLocationId) needs.add('LODGING_BASE_LOCATION');
  if (anchors.some((item) => !item.locationId)) needs.add('ANCHOR_GEOCODING');
  if (importedPlaces.some((item) => !item.locationId)) needs.add('IMPORTED_PLACE_RESOLUTION');
  return [...needs];
}

function rankPriorities(intent) {
  const priorities = [
    ['HARD_CONSTRAINT_COMPLIANCE', 10],
    ['FEASIBILITY', 9.5],
    ['USER_MUST_DO', 9],
    ['ROUTE_EFFICIENCY', 7],
    ['VERIFIED_QUALITY', 6.5],
    ['FREE_TIME', intent.protectFreeTime ? 8 : 4],
    ['FOOD', 3 + intent.foodInterest * 5],
    ['CULTURE', 3 + intent.cultureInterest * 5],
    ['NATURE', 3 + intent.natureInterest * 5],
    ['FITNESS', 2 + intent.fitnessInterest * 5],
    ['SHOPPING', 2 + intent.shoppingInterest * 5],
    ['NIGHTLIFE', 2 + intent.nightlifeInterest * 5],
    ['BUDGET', 3 + intent.budgetSensitivity * 5]
  ];
  return priorities.sort((a, b) => b[1] - a[1]).map(([dimension, weight]) => ({ dimension, weight: Number(weight.toFixed(2)) }));
}

function dayPolicy(day, intent) {
  if (day.type === 'ARRIVAL') return { ...day, policy: 'light schedule, absorb arrival uncertainty, prioritize check-in/food/orientation' };
  if (day.type === 'DEPARTURE') return { ...day, policy: 'protect departure margin; only nearby low-risk activities before leaving' };
  if (day.type === 'WORK') return { ...day, policy: 'work is the anchor; place meals, fitness and nearby leisure around it' };
  if (day.type === 'TRANSFER') return { ...day, policy: 'treat transfer as the main event; avoid fragile reservations around it' };
  return { ...day, policy: intent.style === 'RELAXED' ? 'few high-value clusters with free time' : intent.style === 'INTENSE' ? 'dense but verified route with strict transition checks' : 'balanced anchors, meals and geographic clusters' };
}

function freeTimePolicy(intent) {
  return {
    protect: intent.protectFreeTime || intent.spontaneous,
    recommendedDailyMinutes: intent.style === 'RELAXED' ? 150 : intent.style === 'INTENSE' ? 45 : 90,
    rule: 'Free time is a valid itinerary item and must not be automatically consumed by low-value recommendations.'
  };
}

function phaseObjective(phase) {
  const objectives = {
    UNDERSTAND_INTENT: 'Understand what the user wants to feel/do, not just which city they selected.',
    ESTABLISH_GROUND_TRUTH: 'Collect verified reservations, dates, places, opening hours, routes and constraints.',
    LOCK_HARD_ANCHORS: 'Place flights, tickets, work and fixed reservations before optional content.',
    SHAPE_EACH_DAY: 'Classify arrival/departure/work/full days and decide realistic capacity.',
    DISCOVER_CANDIDATES: 'Find places matching interests, food filters, budget and community/provider quality.',
    CLUSTER_GEOGRAPHICALLY: 'Group compatible places to reduce dead travel and backtracking.',
    PLACE_MEALS_WORK_REST: 'Reserve human needs before filling remaining time.',
    OPTIMIZE_ROUTE_AND_TIME: 'Order stops using real travel time and mode constraints.',
    VERIFY_FEASIBILITY: 'Check opening windows, durations, transitions, reservations and margins.',
    STRESS_TEST: 'Test likely delays, weather and fatigue so the day is resilient.',
    EXPLAIN_PLAN: 'Tell the user why important choices were made and what alternatives exist.',
    MONITOR_AND_REPLAN: 'Repair only the affected part of the itinerary when reality changes.'
  };
  return objectives[phase];
}

function phaseStopCondition(phase) {
  const conditions = {
    UNDERSTAND_INTENT: 'No required intent/date question remains unanswered.',
    ESTABLISH_GROUND_TRUTH: 'Missing facts that affect feasibility are explicitly known/flagged.',
    LOCK_HARD_ANCHORS: 'All hard commitments have a time/location or are marked unresolved.',
    SHAPE_EACH_DAY: 'Each travel date has a day type and capacity policy.',
    DISCOVER_CANDIDATES: 'Enough qualified candidates exist for each open planning window.',
    CLUSTER_GEOGRAPHICALLY: 'Candidate groups can be evaluated with route information.',
    PLACE_MEALS_WORK_REST: 'Meal/work/rest windows are represented before optional fill.',
    OPTIMIZE_ROUTE_AND_TIME: 'Transitions are computed or explicitly unknown.',
    VERIFY_FEASIBILITY: 'No known hard violation remains.',
    STRESS_TEST: 'Fragile transitions are identified and alternatives/buffers exist where needed.',
    EXPLAIN_PLAN: 'Major automatic choices have concise rationales.',
    MONITOR_AND_REPLAN: 'Triggers and locked items are known.'
  };
  return conditions[phase];
}

function sanitizeLearningValue(value) {
  if (value === null || value === undefined) return null;
  if (['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => String(item).slice(0, 120));
  return safeString(JSON.stringify(value), 1000);
}

function dateRange(start, end, maxDays) {
  const first = parseDate(start);
  const last = parseDate(end);
  if (!first || !last || last < first) return [];
  const output = [];
  const cursor = new Date(first);
  while (cursor <= last && output.length < maxDays) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDate(value) {
  const parsed = safeDateTime(value);
  return parsed ? parsed.slice(0, 10) : safeDate(value);
}

function safeDate(value) {
  const string = String(value || '').trim();
  return parseDate(string) ? string : null;
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
  const token = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return token || null;
}

function unique(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean))];
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
