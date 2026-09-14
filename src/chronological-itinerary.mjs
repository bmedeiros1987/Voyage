const ITEM_KINDS = new Set(['TRIP_START', 'TRANSFER', 'FLIGHT', 'TRAIN', 'BUS', 'FERRY', 'CAR', 'RIDESHARE', 'WALK', 'HOTEL', 'CHECK_IN', 'CHECK_OUT', 'ATTRACTION', 'TOUR', 'WORK', 'MEETING', 'BREAKFAST', 'LUNCH', 'DINNER', 'FREE_TIME', 'TRIP_END', 'OTHER']);
const MEALS = [
  { kind: 'BREAKFAST', defaultWindow: ['07:00', '09:30'], defaultDurationMinutes: 45 },
  { kind: 'LUNCH', defaultWindow: ['12:00', '14:30'], defaultDurationMinutes: 60 },
  { kind: 'DINNER', defaultWindow: ['19:00', '21:30'], defaultDurationMinutes: 90 }
];

export function chronologicalItineraryCapabilities() {
  return {
    version: '1.0',
    purpose: 'Build a chronological, door-to-door trip timeline from the initial origin through every day and back to the final destination.',
    includes: ['HARD_RESERVATIONS', 'ACTIVITIES', 'BREAKFAST', 'LUNCH', 'DINNER', 'MULTIMODAL_TRANSFERS', 'LODGING', 'FREE_TIME', 'WEATHER_FLAGS', 'DEPARTURE_GUIDANCE'],
    rules: [
      'Never invent a place, opening hour, route, duration, price, reservation or weather fact.',
      'Every confirmed reservation keeps precedence over optional activities.',
      'Meals are first-class itinerary items and should be placed in realistic free windows.',
      'Every change of location must have a known route or an explicit unresolved route request.',
      'The trip is incomplete until origin-to-first-stop and last-stop-to-final-destination continuity are represented.',
      'Optional activities may only be placed from supplied verified candidates; missing candidates become research needs.',
      'Weather can trigger a proposed alternative but never mutate the itinerary without explicit approval.',
      'Automatic itinerary changes require explicit user approval.'
    ],
    mutationPolicy: {
      automaticMutationAllowed: false,
      userApprovalRequired: true,
      proposalBeforeApply: true
    }
  };
}

export function buildChronologicalItinerary(input = {}) {
  const trip = normalizeTrip(input.trip || {});
  const mealProfile = normalizeMealProfile(input.mealProfile || input.profile?.mealWindows || {});
  const fixed = normalizeTimedItems(input.fixedItems || input.reservations || input.events || []);
  const transport = normalizeTimedItems(input.transportSegments || [], 'TRANSFER');
  const candidates = normalizeActivityCandidates(input.activityCandidates || input.candidates || []);
  const routes = normalizeRouteMatrix(input.routes || input.routeMatrix || {});
  const dates = trip.startDate && trip.endDate ? dateRange(trip.startDate, trip.endDate, 90) : [];
  const researchNeeds = new Set();
  const warnings = [];

  if (!trip.startDate || !trip.endDate) researchNeeds.add('TRIP_DATES');
  if (!trip.originLocationId) researchNeeds.add('TRIP_ORIGIN');
  if (!trip.finalLocationId) researchNeeds.add('FINAL_DESTINATION');

  const allHard = [...fixed, ...transport].sort(compareTimed);
  const days = dates.map((date) => {
    const hardItems = allHard.filter((item) => localDate(item.startsAt, trip.timeZone) === date);
    const placedMeals = placeMeals(date, hardItems, mealProfile, trip.timeZone);
    for (const meal of placedMeals) if (meal.status === 'NEEDS_PLACEMENT') researchNeeds.add(`${meal.kind}_PLACEMENT:${date}`);

    const relevantCandidates = candidates.filter((item) => !item.localDate || item.localDate === date);
    const availableWindows = deriveFreeWindows(date, [...hardItems, ...placedMeals.filter((item) => item.startsAt)], trip.timeZone, mealProfile.dayStart, mealProfile.dayEnd);
    const activityPlan = placeVerifiedActivities(relevantCandidates, availableWindows, date, trip.timeZone);
    if (!relevantCandidates.length && availableWindows.some((window) => window.durationMinutes >= 90)) researchNeeds.add(`ACTIVITY_DISCOVERY:${date}`);

    const baseItems = [...hardItems, ...placedMeals.filter((item) => item.startsAt), ...activityPlan.placed].sort(compareTimed);
    const connections = buildConnections(baseItems, routes, trip, date);
    connections.unresolved.forEach((gap) => researchNeeds.add(`ROUTE:${gap.fromLocationId || 'UNKNOWN'}>${gap.toLocationId || 'UNKNOWN'}:${date}`));
    warnings.push(...connections.warnings);

    const timeline = [...baseItems, ...connections.transfers].sort(compareTimed).map((item) => addGuidance(item, trip));
    return {
      date,
      timeline,
      meals: placedMeals,
      freeWindows: deriveFreeWindows(date, timeline, trip.timeZone, mealProfile.dayStart, mealProfile.dayEnd),
      unresolvedConnections: connections.unresolved,
      unplacedActivities: activityPlan.unplaced,
      status: connections.unresolved.length || placedMeals.some((item) => item.status === 'NEEDS_PLACEMENT') ? 'NEEDS_RESEARCH' : 'PLANNED'
    };
  });

  const boundary = buildBoundaryContinuity(days, routes, trip);
  boundary.researchNeeds.forEach((need) => researchNeeds.add(need));
  warnings.push(...boundary.warnings);

  const chronological = boundary.timeline.length
    ? boundary.timeline
    : days.flatMap((day) => day.timeline).sort(compareTimed);

  const validation = validateChronology(chronological, trip);
  warnings.push(...validation.warnings);

  return {
    version: '1.0',
    trip,
    status: !dates.length ? 'NEEDS_INPUT' : researchNeeds.size || !validation.feasible ? 'NEEDS_RESEARCH' : 'READY_FOR_USER_REVIEW',
    days,
    timeline: chronological,
    completeness: {
      hasTripStart: boundary.hasTripStart,
      hasTripEnd: boundary.hasTripEnd,
      allLocationChangesRouted: !days.some((day) => day.unresolvedConnections.length) && boundary.unresolvedBoundaryConnections === 0,
      mealsRepresentedEveryDay: days.every((day) => MEALS.every((meal) => day.meals.some((item) => item.kind === meal.kind))),
      chronological: validation.chronological,
      feasible: validation.feasible
    },
    researchNeeds: [...researchNeeds],
    warnings: unique(warnings),
    approval: {
      requiredBeforeMutation: true,
      automaticMutationAllowed: false,
      state: 'PROPOSAL_ONLY'
    },
    provenancePolicy: 'Confirmed facts retain source/provenance. Unknown routes, venues, hours, prices and durations remain unresolved rather than fabricated.'
  };
}

function buildBoundaryContinuity(days, routes, trip) {
  const flat = days.flatMap((day) => day.timeline).filter((item) => item.startsAt).sort(compareTimed);
  const timeline = [...flat];
  const researchNeeds = [];
  const warnings = [];
  let hasTripStart = false;
  let hasTripEnd = false;
  let unresolvedBoundaryConnections = 0;

  const first = flat[0];
  if (first && trip.originLocationId) {
    const route = routeFor(routes, trip.originLocationId, first.locationId);
    if (sameLocation(trip.originLocationId, first.locationId)) {
      hasTripStart = true;
    } else if (route && first.startsAt) {
      const endMs = Date.parse(first.startsAt) - Math.max(0, trip.startArrivalBufferMinutes) * 60_000;
      const startMs = endMs - route.durationMinutes * 60_000;
      timeline.push(makeTransfer({
        id: 'trip-start-transfer',
        startsAt: new Date(startMs).toISOString(),
        endsAt: new Date(endMs).toISOString(),
        fromLocationId: trip.originLocationId,
        toLocationId: first.locationId,
        route,
        boundaryKind: 'TRIP_START'
      }));
      hasTripStart = true;
    } else {
      unresolvedBoundaryConnections += 1;
      researchNeeds.push(`ROUTE:${trip.originLocationId}>${first?.locationId || 'UNKNOWN'}:TRIP_START`);
    }
  }

  const last = flat.at(-1);
  if (last && trip.finalLocationId) {
    const from = last.locationId;
    const route = routeFor(routes, from, trip.finalLocationId);
    if (sameLocation(from, trip.finalLocationId)) {
      hasTripEnd = true;
    } else if (route && last.endsAt) {
      const startMs = Date.parse(last.endsAt) + Math.max(0, trip.endDepartureBufferMinutes) * 60_000;
      const endMs = startMs + route.durationMinutes * 60_000;
      timeline.push(makeTransfer({
        id: 'trip-end-transfer',
        startsAt: new Date(startMs).toISOString(),
        endsAt: new Date(endMs).toISOString(),
        fromLocationId: from,
        toLocationId: trip.finalLocationId,
        route,
        boundaryKind: 'TRIP_END'
      }));
      hasTripEnd = true;
    } else {
      unresolvedBoundaryConnections += 1;
      researchNeeds.push(`ROUTE:${from || 'UNKNOWN'}>${trip.finalLocationId}:TRIP_END`);
    }
  }

  return { timeline: timeline.sort(compareTimed), researchNeeds, warnings, hasTripStart, hasTripEnd, unresolvedBoundaryConnections };
}

function buildConnections(items, routes, trip, date) {
  const transfers = [];
  const unresolved = [];
  const warnings = [];
  const timed = items.filter((item) => item.startsAt && item.endsAt).sort(compareTimed);
  for (let index = 1; index < timed.length; index += 1) {
    const previous = timed[index - 1];
    const next = timed[index];
    if (!previous.locationId || !next.locationId || sameLocation(previous.locationId, next.locationId)) continue;
    if (isTransportItem(next) && sameLocation(next.fromLocationId, previous.locationId)) continue;
    const route = routeFor(routes, previous.locationId, next.locationId);
    if (!route) {
      unresolved.push({ fromItemId: previous.id, toItemId: next.id, fromLocationId: previous.locationId, toLocationId: next.locationId });
      continue;
    }
    const availableMinutes = Math.floor((Date.parse(next.startsAt) - Date.parse(previous.endsAt)) / 60_000);
    if (route.durationMinutes > availableMinutes) {
      warnings.push(`IMPOSSIBLE_TRANSFER:${previous.id}>${next.id}`);
      continue;
    }
    const endMs = Date.parse(next.startsAt) - trip.interStopArrivalBufferMinutes * 60_000;
    const startMs = endMs - route.durationMinutes * 60_000;
    if (startMs < Date.parse(previous.endsAt)) {
      warnings.push(`TRANSFER_BUFFER_ERODED:${previous.id}>${next.id}`);
    }
    transfers.push(makeTransfer({
      id: `transfer-${previous.id}-${next.id}`,
      startsAt: new Date(Math.max(startMs, Date.parse(previous.endsAt))).toISOString(),
      endsAt: new Date(endMs).toISOString(),
      fromLocationId: previous.locationId,
      toLocationId: next.locationId,
      route,
      boundaryKind: null,
      date
    }));
  }
  return { transfers, unresolved, warnings };
}

function placeMeals(date, hardItems, profile, timeZone) {
  return MEALS.map((definition) => {
    const window = profile[definition.kind.toLowerCase()] || { start: definition.defaultWindow[0], end: definition.defaultWindow[1], durationMinutes: definition.defaultDurationMinutes };
    const durationMinutes = window.durationMinutes || definition.defaultDurationMinutes;
    const startCandidates = scanWindow(date, window.start, window.end, durationMinutes, timeZone);
    const chosen = startCandidates.find(({ startsAt, endsAt }) => !hardItems.some((item) => overlaps(startsAt, endsAt, item.startsAt, item.endsAt)));
    if (!chosen) {
      return {
        id: `meal-${definition.kind.toLowerCase()}-${date}`,
        kind: definition.kind,
        title: mealTitle(definition.kind),
        localDate: date,
        status: 'NEEDS_PLACEMENT',
        locked: false,
        venueId: null,
        locationId: null,
        researchRequired: true
      };
    }
    return {
      id: `meal-${definition.kind.toLowerCase()}-${date}`,
      kind: definition.kind,
      title: mealTitle(definition.kind),
      localDate: date,
      startsAt: chosen.startsAt,
      endsAt: chosen.endsAt,
      status: 'SLOT_RESERVED',
      locked: false,
      venueId: null,
      locationId: inferMealLocation(hardItems, chosen.startsAt),
      researchRequired: true,
      note: 'Meal time is reserved. A specific venue is only added after verified food discovery.'
    };
  });
}

function placeVerifiedActivities(candidates, windows, date, timeZone) {
  const placed = [];
  const unplaced = [];
  const available = windows.map((window) => ({ ...window }));
  for (const candidate of candidates.sort((a, b) => b.priority - a.priority)) {
    if (!candidate.verified) {
      unplaced.push({ ...candidate, reason: 'UNVERIFIED_CANDIDATE' });
      continue;
    }
    if (candidate.startsAt && candidate.endsAt) {
      placed.push({ ...candidate, kind: candidate.kind || 'ATTRACTION', locked: candidate.locked === true });
      continue;
    }
    const slotIndex = available.findIndex((window) => window.durationMinutes >= candidate.durationMinutes && activityFitsOpeningWindow(candidate, window, timeZone));
    if (slotIndex < 0) {
      unplaced.push({ ...candidate, reason: 'NO_FEASIBLE_WINDOW' });
      continue;
    }
    const slot = available[slotIndex];
    const startsAt = slot.startsAt;
    const endsAt = new Date(Date.parse(startsAt) + candidate.durationMinutes * 60_000).toISOString();
    placed.push({ ...candidate, startsAt, endsAt, localDate: date, locked: false });
    const remainingStart = new Date(Date.parse(endsAt) + 15 * 60_000).toISOString();
    const remaining = Math.floor((Date.parse(slot.endsAt) - Date.parse(remainingStart)) / 60_000);
    if (remaining >= 30) available[slotIndex] = { startsAt: remainingStart, endsAt: slot.endsAt, durationMinutes: remaining };
    else available.splice(slotIndex, 1);
  }
  return { placed, unplaced };
}

function deriveFreeWindows(date, items, timeZone, dayStart, dayEnd) {
  const start = zonelessIso(date, dayStart, timeZone);
  const end = zonelessIso(date, dayEnd, timeZone);
  const busy = items.filter((item) => item.startsAt && item.endsAt).sort(compareTimed);
  const windows = [];
  let cursor = Date.parse(start);
  const dayEndMs = Date.parse(end);
  for (const item of busy) {
    const itemStart = Date.parse(item.startsAt);
    const itemEnd = Date.parse(item.endsAt);
    if (itemEnd <= cursor || itemStart >= dayEndMs) continue;
    if (itemStart > cursor) pushWindow(windows, cursor, Math.min(itemStart, dayEndMs));
    cursor = Math.max(cursor, itemEnd);
    if (cursor >= dayEndMs) break;
  }
  if (cursor < dayEndMs) pushWindow(windows, cursor, dayEndMs);
  return windows;
}

function validateChronology(items, trip) {
  const warnings = [];
  const sorted = items.filter((item) => item.startsAt && item.endsAt).sort(compareTimed);
  let chronological = true;
  let feasible = true;
  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index];
    if (Date.parse(item.endsAt) < Date.parse(item.startsAt)) {
      warnings.push(`NEGATIVE_DURATION:${item.id}`);
      chronological = false;
      feasible = false;
    }
    if (index > 0) {
      const previous = sorted[index - 1];
      if (Date.parse(item.startsAt) < Date.parse(previous.startsAt)) chronological = false;
      if (Date.parse(item.startsAt) < Date.parse(previous.endsAt) && !allowedOverlap(previous, item)) {
        warnings.push(`OVERLAP:${previous.id}>${item.id}`);
        feasible = false;
      }
    }
  }
  if (trip.startDate && trip.endDate && trip.endDate < trip.startDate) {
    warnings.push('INVALID_TRIP_DATE_RANGE');
    feasible = false;
  }
  return { chronological, feasible, warnings };
}

function addGuidance(item, trip) {
  const fixedTime = Boolean(item.startsAt) && item.locked === true;
  const destination = item.toLocationId || item.locationId || null;
  return {
    ...item,
    guidance: fixedTime && destination ? {
      departureWatchEligible: true,
      destinationId: destination,
      action: 'CALCULATE_LEAVE_TIME_WITH_FRESH_ROUTE_DATA',
      itineraryMutationAllowed: false
    } : null,
    approvalRequiredForChange: true
  };
}

function normalizeTrip(input) {
  return {
    id: safeString(input.id, 160),
    title: safeString(input.title, 220) || 'Viagem',
    startDate: safeDate(input.startDate),
    endDate: safeDate(input.endDate),
    timeZone: safeString(input.timeZone, 100) || 'UTC',
    originLocationId: safeString(input.originLocationId || input.originId, 220),
    finalLocationId: safeString(input.finalLocationId || input.homeLocationId || input.returnLocationId, 220),
    startArrivalBufferMinutes: clampInteger(input.startArrivalBufferMinutes, 0, 240, 30),
    endDepartureBufferMinutes: clampInteger(input.endDepartureBufferMinutes, 0, 240, 0),
    interStopArrivalBufferMinutes: clampInteger(input.interStopArrivalBufferMinutes, 0, 120, 10)
  };
}

function normalizeMealProfile(input) {
  return {
    breakfast: normalizeMealWindow(input.breakfast, '07:00', '09:30', 45),
    lunch: normalizeMealWindow(input.lunch, '12:00', '14:30', 60),
    dinner: normalizeMealWindow(input.dinner, '19:00', '21:30', 90),
    dayStart: safeTime(input.dayStart) || '06:30',
    dayEnd: safeTime(input.dayEnd) || '23:00'
  };
}

function normalizeMealWindow(input, start, end, durationMinutes) {
  return {
    start: safeTime(input?.start) || start,
    end: safeTime(input?.end) || end,
    durationMinutes: clampInteger(input?.durationMinutes, 15, 180, durationMinutes)
  };
}

function normalizeTimedItems(input, fallbackKind = 'OTHER') {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 1000).map((item, index) => {
    const kind = safeKind(item.kind || fallbackKind);
    const fromLocationId = safeString(item.fromLocationId || item.originLocationId, 220);
    const toLocationId = safeString(item.toLocationId || item.destinationLocationId, 220);
    return {
      id: safeString(item.id, 180) || `item-${index + 1}`,
      kind,
      title: safeString(item.title, 260) || kind.replaceAll('_', ' '),
      startsAt: safeDateTime(item.startsAt || item.departureAt),
      endsAt: safeDateTime(item.endsAt || item.arrivalAt),
      locationId: safeString(item.locationId, 220) || toLocationId || fromLocationId,
      fromLocationId,
      toLocationId,
      locked: item.locked !== false,
      source: safeString(item.source, 120),
      provenance: sanitizeProvenance(item.provenance),
      weatherAssessment: sanitizeWeatherAssessment(item.weatherAssessment)
    };
  }).filter((item) => item.startsAt || item.endsAt);
}

function normalizeActivityCandidates(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 1000).map((item, index) => ({
    id: safeString(item.id, 180) || `candidate-${index + 1}`,
    kind: safeKind(item.kind || 'ATTRACTION'),
    title: safeString(item.title, 260) || 'Atividade',
    locationId: safeString(item.locationId, 220),
    localDate: safeDate(item.localDate || item.date),
    startsAt: safeDateTime(item.startsAt),
    endsAt: safeDateTime(item.endsAt),
    durationMinutes: clampInteger(item.durationMinutes, 15, 720, 90),
    verified: item.verified === true && Boolean(item.locationId),
    priority: clampNumber(item.priority ?? item.interestScore, 0, 10, 5),
    openingWindow: item.openingWindow && typeof item.openingWindow === 'object' ? {
      start: safeTime(item.openingWindow.start),
      end: safeTime(item.openingWindow.end)
    } : null,
    locked: item.locked === true,
    source: safeString(item.source, 120),
    provenance: sanitizeProvenance(item.provenance)
  }));
}

function normalizeRouteMatrix(input) {
  const map = new Map();
  if (Array.isArray(input)) {
    for (const route of input.slice(0, 5000)) addRoute(map, route);
  } else if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input).slice(0, 5000)) {
      if (value && typeof value === 'object') addRoute(map, { ...value, key });
      else if (Number.isFinite(Number(value))) {
        const [fromLocationId, toLocationId] = key.split('|');
        addRoute(map, { fromLocationId, toLocationId, durationMinutes: value, verified: true });
      }
    }
  }
  return map;
}

function addRoute(map, route) {
  const keyParts = safeString(route.key, 500)?.split('|') || [];
  const fromLocationId = safeString(route.fromLocationId || route.originId || keyParts[0], 220);
  const toLocationId = safeString(route.toLocationId || route.destinationId || keyParts[1], 220);
  const durationMinutes = optionalNumber(route.durationMinutes ?? route.currentTravelMinutes, 0, 2880);
  if (!fromLocationId || !toLocationId || durationMinutes === null || route.verified === false) return;
  map.set(`${fromLocationId}|${toLocationId}`, {
    fromLocationId,
    toLocationId,
    durationMinutes,
    mode: safeString(route.mode, 60) || 'UNKNOWN',
    distanceKm: optionalNumber(route.distanceKm, 0, 100000),
    cost: optionalNumber(route.cost, 0, 10000000),
    currency: safeString(route.currency, 8),
    provider: safeString(route.provider, 120),
    updatedAt: safeDateTime(route.updatedAt),
    verified: true
  });
}

function routeFor(routes, from, to) {
  if (!from || !to) return null;
  return routes.get(`${from}|${to}`) || null;
}

function makeTransfer({ id, startsAt, endsAt, fromLocationId, toLocationId, route, boundaryKind, date }) {
  return {
    id,
    kind: 'TRANSFER',
    title: boundaryKind === 'TRIP_START' ? 'Deslocamento inicial' : boundaryKind === 'TRIP_END' ? 'Deslocamento final' : 'Deslocamento',
    startsAt,
    endsAt,
    localDate: date || startsAt.slice(0, 10),
    locationId: toLocationId,
    fromLocationId,
    toLocationId,
    locked: false,
    route,
    source: route.provider || 'ROUTE_PROVIDER',
    boundaryKind,
    approvalRequiredForChange: true
  };
}

function scanWindow(date, start, end, durationMinutes, timeZone) {
  const startMs = Date.parse(zonelessIso(date, start, timeZone));
  const endMs = Date.parse(zonelessIso(date, end, timeZone));
  const output = [];
  for (let cursor = startMs; cursor + durationMinutes * 60_000 <= endMs; cursor += 15 * 60_000) {
    output.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(cursor + durationMinutes * 60_000).toISOString() });
  }
  return output;
}

function activityFitsOpeningWindow(candidate, window, timeZone) {
  if (!candidate.openingWindow?.start || !candidate.openingWindow?.end) return true;
  const date = window.startsAt.slice(0, 10);
  const open = Date.parse(zonelessIso(date, candidate.openingWindow.start, timeZone));
  const close = Date.parse(zonelessIso(date, candidate.openingWindow.end, timeZone));
  return Date.parse(window.startsAt) >= open && Date.parse(window.startsAt) + candidate.durationMinutes * 60_000 <= close;
}

function inferMealLocation(hardItems, startsAt) {
  const time = Date.parse(startsAt);
  const before = hardItems.filter((item) => item.endsAt && Date.parse(item.endsAt) <= time && item.locationId).sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))[0];
  const after = hardItems.filter((item) => item.startsAt && Date.parse(item.startsAt) >= time && item.locationId).sort(compareTimed)[0];
  return before?.locationId || after?.locationId || null;
}

function pushWindow(windows, startMs, endMs) {
  const durationMinutes = Math.floor((endMs - startMs) / 60_000);
  if (durationMinutes >= 30) windows.push({ startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString(), durationMinutes });
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(aEnd) > Date.parse(bStart);
}

function allowedOverlap(a, b) {
  if (a.kind === 'TRANSFER' && b.kind === 'TRANSFER') return false;
  return false;
}

function isTransportItem(item) {
  return ['TRANSFER', 'FLIGHT', 'TRAIN', 'BUS', 'FERRY', 'CAR', 'RIDESHARE', 'WALK'].includes(item.kind);
}

function sameLocation(a, b) {
  return Boolean(a && b && String(a) === String(b));
}

function mealTitle(kind) {
  return kind === 'BREAKFAST' ? 'Café da manhã' : kind === 'LUNCH' ? 'Almoço' : 'Jantar';
}

function compareTimed(a, b) {
  const aTime = Date.parse(a.startsAt || a.endsAt || '9999-12-31T23:59:59Z');
  const bTime = Date.parse(b.startsAt || b.endsAt || '9999-12-31T23:59:59Z');
  return aTime - bTime || String(a.id || '').localeCompare(String(b.id || ''));
}

function localDate(value) {
  const parsed = safeDateTime(value);
  return parsed ? parsed.slice(0, 10) : null;
}

function zonelessIso(date, time) {
  return `${date}T${time}:00.000Z`;
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

function safeDate(value) {
  const text = String(value || '').trim();
  return parseDate(text) ? text : null;
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeTime(value) {
  const text = String(value || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
}

function safeKind(value) {
  const token = String(value || 'OTHER').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
  return ITEM_KINDS.has(token) ? token : 'OTHER';
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

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function sanitizeProvenance(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    source: safeString(value.source || value.provider, 120),
    sourceId: safeString(value.sourceId, 180),
    observedAt: safeDateTime(value.observedAt || value.updatedAt),
    confidence: optionalNumber(value.confidence, 0, 1)
  };
}

function sanitizeWeatherAssessment(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    status: safeString(value.status, 40),
    reasons: Array.isArray(value.reasons) ? value.reasons.slice(0, 20).map((item) => safeString(item, 120)).filter(Boolean) : [],
    proposalOnly: true,
    userApprovalRequired: true
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
