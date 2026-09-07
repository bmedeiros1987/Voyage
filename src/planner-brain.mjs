const CHANGE_TYPES = new Set(['DELAY', 'RUNNING_LATE', 'TRAFFIC', 'CLOSURE', 'CANCELLATION', 'WEATHER', 'FATIGUE', 'NEW_RESERVATION', 'USER_CHANGE']);

export function plannerBrainCapabilities() {
  return Object.freeze({
    version: '1.0',
    phases: [
      'LOCK_HARD_ANCHORS',
      'PLACE_MEALS_WORK_REST',
      'RESEARCH_OPTIONS',
      'CLUSTER_GEOGRAPHICALLY',
      'CALCULATE_TRANSITIONS',
      'PROTECT_BUFFERS_AND_FREE_TIME',
      'VERIFY_FEASIBILITY',
      'MONITOR_AND_REPLAN'
    ],
    priorities: [
      'HARD_CONSTRAINT_COMPLIANCE',
      'FEASIBILITY',
      'USER_PREFERENCES',
      'LOW_TRAVEL_FRICTION',
      'WEATHER_FIT',
      'FOOD_AND_HUMAN_NEEDS',
      'BUDGET',
      'OPTIONAL_DISCOVERY'
    ],
    approvalPolicy: {
      proposalFirst: true,
      requiresExplicitUserApprovalForItineraryMutation: true,
      approvalMustBeSeparateFromProposalCreation: true,
      automaticMutationAllowed: false
    }
  });
}

export function buildPlanningBrief(input = {}) {
  const trip = input.trip || {};
  const intent = input.intent || {};
  const importedPlaces = Array.isArray(input.importedPlaces) ? input.importedPlaces.slice(0, 200) : [];
  const missing = [];
  if (!trip.destination) missing.push('DESTINATION');
  if (!trip.startDate || !trip.endDate) missing.push('DATES');
  if (!intent.style) missing.push('PACE_STYLE');

  const dayTypes = buildDayTypes(trip.startDate, trip.endDate, trip.arrivalAt, trip.departureAt);
  const researchNeeds = [];
  if (intent.foodInterest > 0.3 || intent.interests?.includes('food')) researchNeeds.push('FOOD_DISCOVERY');
  if (importedPlaces.length) researchNeeds.push('VERIFY_IMPORTED_PLACES');
  if (dayTypes.length) researchNeeds.push('TRAVEL_TIME_MATRIX');

  return {
    status: missing.length ? 'NEEDS_INPUT' : 'READY_FOR_RESEARCH',
    destination: safeString(trip.destination, 160),
    missing,
    dayTypes,
    importedPlaces: importedPlaces.map((place) => ({
      title: safeString(place.title, 200),
      source: safeToken(place.source || 'IMPORTED'),
      userPinned: place.userPinned === true
    })),
    researchNeeds,
    principle: 'Imported places express user intent; they are not proof of hours, distance, availability, price or suitability.'
  };
}

export function buildPlanningStrategy(input = {}) {
  const intent = input.intent || {};
  const relaxed = String(intent.style || '').toUpperCase() === 'RELAXED';
  return {
    priorities: [
      { dimension: 'HARD_CONSTRAINT_COMPLIANCE', weight: 1 },
      { dimension: 'FEASIBILITY', weight: 0.98 },
      { dimension: 'USER_PREFERENCES', weight: 0.9 },
      { dimension: 'LOW_TRAVEL_FRICTION', weight: 0.84 },
      { dimension: 'WEATHER_FIT', weight: 0.78 },
      { dimension: 'FOOD_AND_HUMAN_NEEDS', weight: 0.76 }
    ],
    freeTimePolicy: {
      protect: intent.protectFreeTime === true || relaxed,
      recommendedDailyMinutes: relaxed ? 150 : 75
    },
    approvalPolicy: {
      proposalFirst: true,
      separateApprovalRequired: true,
      mayAutoApply: false
    }
  };
}

export function assessPlanQuality(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const violations = [];
  for (const item of items) {
    const id = safeToken(item.id || 'ITEM');
    if (item.hardConstraintViolated === true) violations.push(`HARD_CONSTRAINT:${id}`);
    if (Number(item.transitionMinutes) < 0) violations.push(`IMPOSSIBLE_TRANSITION:${id}`);
    if (item.previousLocationId && item.travelTimeKnown === false) violations.push(`TRAVEL_TIME_UNKNOWN:${id}`);
    if (item.requiresOpeningHours === true && item.openingHoursKnown === false) violations.push(`OPENING_HOURS_UNKNOWN:${id}`);
  }
  const hardFailure = violations.some((value) => value.startsWith('HARD_CONSTRAINT') || value.startsWith('IMPOSSIBLE_TRANSITION'));
  return {
    feasible: !hardFailure,
    grade: hardFailure ? 'REPLAN' : violations.length ? 'REVIEW' : 'READY',
    violations
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

  // Proposal creation is intentionally incapable of granting its own approval.
  // Any userApproved/proposalId supplied by the caller is ignored here. A later
  // authenticated approval resource must validate a server-issued proposal.
  return {
    changeType,
    preserve: lockedItems,
    actions,
    actionsAreProposals: true,
    requiresUserApproval: true,
    userApproved: false,
    mayApply: false,
    executionMode: 'PROPOSAL_ONLY',
    approvalContract: 'SEPARATE_AUTHENTICATED_PROPOSAL_APPROVAL',
    diffRequired: true,
    explanationRequired: true,
    policy: 'Prepare the smallest affected repair first, show the proposed diff, and do not apply any itinerary change until a separate authenticated approval validates a server-issued proposal.'
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

function buildDayTypes(startDate, endDate, arrivalAt, departureAt) {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) return [];
  const out = [];
  for (let cursor = new Date(start), index = 0; cursor <= end && index < 90; cursor.setUTCDate(cursor.getUTCDate() + 1), index += 1) {
    const date = cursor.toISOString().slice(0, 10);
    const first = index === 0;
    const last = date === endDate;
    out.push({
      date,
      type: first ? 'ARRIVAL' : last ? 'DEPARTURE' : 'FULL_DAY',
      arrivalAt: first ? arrivalAt || null : null,
      departureAt: last ? departureAt || null : null
    });
  }
  return out;
}

function safeToken(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').slice(0, 80);
}

function safeString(value, max) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function sanitizeLearningValue(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  return safeString(JSON.stringify(value), 500);
}
