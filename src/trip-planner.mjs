const USER_TYPES = new Set(['PASSENGER', 'CREW_MEMBER']);
const PACE_VALUES = new Set(['RELAXED', 'BALANCED', 'INTENSE']);
const BREAKFAST_MODES = new Set(['HOTEL', 'LOCAL', 'FLEXIBLE', 'SKIP']);
const ACTIVITY_TYPES = new Set(['ATTRACTION', 'FOOD', 'COFFEE', 'GYM', 'WELLNESS', 'SHOPPING', 'NIGHTLIFE', 'WORKSPACE', 'OUTDOOR', 'CULTURE', 'OTHER']);
const COLLAB_ROLES = ['OWNER', 'EDITOR', 'COMMENTER', 'VIEWER'];
const EXPORT_FORMATS = ['PDF', 'DOCX', 'XLSX'];
const EXTERNAL_ITINERARY_SOURCES = ['GOOGLE_MAPS_SHARE', 'GOOGLE_MY_MAPS', 'APPLE_MAPS_SHARE', 'WAZE_SHARE', 'KML', 'KMZ', 'GPX', 'GEOJSON', 'ICS', 'MANUAL'];

export function plannerCapabilities() {
  return {
    automaticPlanning: true,
    userTypes: [...USER_TYPES],
    pace: [...PACE_VALUES],
    breakfastModes: [...BREAKFAST_MODES],
    activityTypes: [...ACTIVITY_TYPES],
    collaborationRoles: COLLAB_ROLES,
    exportFormats: EXPORT_FORMATS,
    externalItinerarySources: EXTERNAL_ITINERARY_SOURCES,
    principles: [
      'Respect fixed reservations, work blocks, sleep, meals and user-defined buffers before adding optional activities.',
      'Never invent opening hours, ratings, prices, travel times or community opinions; rank only facts supplied by trusted sources.',
      'Prefer lower dead-travel time and realistic transitions over maximizing the number of stops.',
      'Treat hotel breakfast, work commitments and crew schedules as explicit constraints rather than assumptions.',
      'Keep user and collaborator preferences separable so group plans can expose conflicts instead of silently overriding them.'
    ]
  };
}

export function normalizePlannerProfile(input = {}) {
  const userType = USER_TYPES.has(input.userType) ? input.userType : 'PASSENGER';
  const pace = PACE_VALUES.has(input.pace) ? input.pace : 'BALANCED';
  const breakfastMode = BREAKFAST_MODES.has(input.breakfastMode) ? input.breakfastMode : 'FLEXIBLE';
  const mealWindows = {
    breakfast: normalizeWindow(input.mealWindows?.breakfast, '07:30', '09:00'),
    lunch: normalizeWindow(input.mealWindows?.lunch, '12:00', '14:00'),
    dinner: normalizeWindow(input.mealWindows?.dinner, '19:00', '21:00')
  };
  const preferredActivityTypes = uniqueStrings(input.preferredActivityTypes).filter((value) => ACTIVITY_TYPES.has(value));
  const avoidedActivityTypes = uniqueStrings(input.avoidedActivityTypes).filter((value) => ACTIVITY_TYPES.has(value));

  return {
    userType,
    pace,
    breakfastMode,
    hotelBreakfastIncluded: input.hotelBreakfastIncluded === true ? true : input.hotelBreakfastIncluded === false ? false : null,
    mealWindows,
    lunchDurationMinutes: clampInteger(input.lunchDurationMinutes, 20, 180, 60),
    dinnerDurationMinutes: clampInteger(input.dinnerDurationMinutes, 30, 240, 90),
    breakfastDurationMinutes: clampInteger(input.breakfastDurationMinutes, 15, 120, 45),
    minimumTransitionMinutes: clampInteger(input.minimumTransitionMinutes, 0, 120, pace === 'RELAXED' ? 25 : pace === 'INTENSE' ? 10 : 15),
    targetSleepHours: clampNumber(input.targetSleepHours, 4, 12, 8),
    preferredActivityTypes,
    avoidedActivityTypes,
    interestTags: uniqueStrings(input.interestTags).slice(0, 40),
    dietaryPreferences: uniqueStrings(input.dietaryPreferences).slice(0, 30),
    accessibilityNeeds: uniqueStrings(input.accessibilityNeeds).slice(0, 30),
    workNeeds: {
      enabled: Boolean(input.workNeeds?.enabled),
      minimumBlockMinutes: clampInteger(input.workNeeds?.minimumBlockMinutes, 15, 480, 60),
      preferredPeriods: uniqueStrings(input.workNeeds?.preferredPeriods).slice(0, 12),
      requiresQuietPlace: Boolean(input.workNeeds?.requiresQuietPlace),
      requiresReliableWifi: input.workNeeds?.requiresReliableWifi !== false
    },
    fitness: {
      enabled: Boolean(input.fitness?.enabled),
      preferredDurationMinutes: clampInteger(input.fitness?.preferredDurationMinutes, 20, 180, 60),
      preferredPeriods: uniqueStrings(input.fitness?.preferredPeriods).slice(0, 8),
      gymRequired: Boolean(input.fitness?.gymRequired),
      alternativesAccepted: input.fitness?.alternativesAccepted !== false
    },
    budget: {
      currency: safeCode(input.budget?.currency, 'BRL'),
      dailyTarget: optionalPositiveNumber(input.budget?.dailyTarget),
      totalLimit: optionalPositiveNumber(input.budget?.totalLimit)
    },
    returnMarginHours: clampInteger(input.returnMarginHours, 0, 72, userType === 'CREW_MEMBER' ? 12 : 2)
  };
}

export function buildAutomaticPlan(input = {}) {
  const profile = normalizePlannerProfile(input.profile || input);
  const trip = normalizeTrip(input.trip || {});
  const fixedEvents = normalizeEvents(input.fixedEvents).sort(compareEvents);
  const workBlocks = normalizeEvents(input.workBlocks).sort(compareEvents);
  const candidates = normalizeCandidates(input.candidates);
  const travelMinutes = normalizeTravelMatrix(input.travelMinutes);
  const questions = buildPlannerQuestions(profile, trip, input);
  const daySkeletons = trip.startDate && trip.endDate ? buildDaySkeletons(trip, profile, fixedEvents, workBlocks) : [];
  const rankedCandidates = rankCandidates(candidates, profile);
  const routeSuggestion = optimizeVisitOrder(rankedCandidates, travelMinutes, input.startLocationId || null, paceStopLimit(profile.pace));

  return {
    plannerVersion: '1.0',
    status: questions.some((item) => item.required) ? 'NEEDS_INPUT' : 'READY_TO_OPTIMIZE',
    trip,
    profile,
    questions,
    constraints: {
      fixedEvents,
      workBlocks,
      mealWindows: profile.mealWindows,
      minimumTransitionMinutes: profile.minimumTransitionMinutes,
      targetSleepHours: profile.targetSleepHours,
      returnMarginHours: profile.returnMarginHours
    },
    daySkeletons,
    recommendations: {
      rankedCandidates,
      routeSuggestion
    },
    explanation: {
      objective: 'maximize preference fit and verified quality while minimizing avoidable travel and respecting time constraints',
      untrustedFactPolicy: 'External facts such as ratings, opening hours and travel times are never fabricated; missing facts remain unknown.',
      communitySignalPolicy: 'Community ratings influence ranking only when supplied with provenance and sample size.'
    }
  };
}

export function normalizeExternalItinerary(input = {}) {
  const sourceType = EXTERNAL_ITINERARY_SOURCES.includes(input.sourceType) ? input.sourceType : 'MANUAL';
  const items = Array.isArray(input.items) ? input.items.slice(0, 500).map((item, index) => ({
    externalId: safeString(item.externalId, 160) || `external-${index + 1}`,
    title: safeString(item.title, 220) || 'Parada importada',
    address: safeString(item.address, 400),
    latitude: optionalCoordinate(item.latitude, -90, 90),
    longitude: optionalCoordinate(item.longitude, -180, 180),
    startsAt: safeDateTime(item.startsAt),
    endsAt: safeDateTime(item.endsAt),
    notes: safeString(item.notes, 1500),
    sourceUrl: safeUrl(item.sourceUrl)
  })) : [];

  return {
    sourceType,
    sourceUrl: safeUrl(input.sourceUrl),
    fileName: safeString(input.fileName, 255),
    itemCount: items.length,
    items,
    status: items.length ? 'READY_FOR_MATCHING' : 'NEEDS_SOURCE_RESOLUTION',
    resolverPolicy: 'Use official provider APIs, shared links or user-exported files where available; do not scrape private saved lists.'
  };
}

export function collaborationCapabilities() {
  return {
    roles: COLLAB_ROLES,
    permissions: {
      OWNER: ['view', 'edit', 'comment', 'invite', 'manage_roles', 'approve', 'export'],
      EDITOR: ['view', 'edit', 'comment', 'propose', 'vote', 'export'],
      COMMENTER: ['view', 'comment', 'propose', 'vote'],
      VIEWER: ['view']
    },
    planningModel: 'versioned shared plan with proposals, comments, votes and explicit conflict resolution',
    conflictPolicy: 'locked reservations and owner-defined hard constraints cannot be silently overwritten by collaborator edits'
  };
}

export function buildExportManifest(input = {}) {
  const requested = uniqueStrings(input.formats).filter((format) => EXPORT_FORMATS.includes(format));
  const formats = requested.length ? requested : EXPORT_FORMATS;
  return {
    formats,
    canonicalSnapshotRequired: true,
    pdf: formats.includes('PDF') ? {
      sections: ['cover', 'trip_summary', 'daily_timeline', 'reservations', 'maps_and_distances', 'budget', 'participants', 'notes'],
      printFriendly: true
    } : null,
    docx: formats.includes('DOCX') ? {
      sections: ['trip_summary', 'daily_timeline', 'reservations', 'recommendations', 'participants', 'notes'],
      editable: true
    } : null,
    xlsx: formats.includes('XLSX') ? {
      sheets: ['Resumo', 'Roteiro', 'Reservas', 'Locais', 'Deslocamentos', 'Orçamento', 'Participantes', 'Notas'],
      formulasAllowed: true
    } : null
  };
}

function buildPlannerQuestions(profile, trip, input) {
  const questions = [];
  if (!trip.startDate || !trip.endDate) {
    questions.push({ id: 'TRIP_DATES', required: true, prompt: 'Quais são as datas ou a janela disponível para a viagem?' });
  }
  if (profile.breakfastMode === 'FLEXIBLE' && profile.hotelBreakfastIncluded === null) {
    questions.push({
      id: 'BREAKFAST_PREFERENCE',
      required: false,
      prompt: 'O hotel inclui café da manhã ou você prefere conhecer cafés e padarias recomendados perto do roteiro?',
      options: ['HOTEL_INCLUDED', 'LOCAL_RECOMMENDATIONS', 'DECIDE_DAY_BY_DAY']
    });
  }
  if (profile.workNeeds.enabled && !Array.isArray(input.workBlocks)) {
    questions.push({ id: 'WORK_BLOCKS', required: false, prompt: 'Há horários fixos de trabalho, reuniões ou períodos que devem ficar reservados?' });
  }
  if (profile.fitness.enabled && profile.fitness.gymRequired && !input.gymSearchArea) {
    questions.push({ id: 'GYM_AREA', required: false, prompt: 'Posso buscar academia perto do hotel, trabalho ou próximo da primeira atividade do dia?' });
  }
  return questions;
}

function buildDaySkeletons(trip, profile, fixedEvents, workBlocks) {
  return dateRange(trip.startDate, trip.endDate, 62).map((date) => {
    const anchors = [];
    if (profile.breakfastMode !== 'SKIP') anchors.push(mealAnchor(date, 'BREAKFAST', profile.mealWindows.breakfast, profile.breakfastDurationMinutes, profile.breakfastMode));
    anchors.push(mealAnchor(date, 'LUNCH', profile.mealWindows.lunch, profile.lunchDurationMinutes, 'USER_WINDOW'));
    anchors.push(mealAnchor(date, 'DINNER', profile.mealWindows.dinner, profile.dinnerDurationMinutes, 'USER_WINDOW'));
    const dayFixed = fixedEvents.filter((event) => event.localDate === date);
    const dayWork = workBlocks.filter((event) => event.localDate === date);
    if (profile.fitness.enabled) {
      anchors.push({
        kind: 'FITNESS',
        preferredPeriods: profile.fitness.preferredPeriods,
        durationMinutes: profile.fitness.preferredDurationMinutes,
        gymRequired: profile.fitness.gymRequired,
        alternativesAccepted: profile.fitness.alternativesAccepted,
        locked: false
      });
    }
    return {
      date,
      anchors: [...dayFixed.map((event) => ({ ...event, kind: event.kind || 'FIXED_EVENT', locked: true })), ...dayWork.map((event) => ({ ...event, kind: 'WORK', locked: true })), ...anchors],
      strategy: profile.pace === 'RELAXED' ? 'fewer stops with wider buffers' : profile.pace === 'INTENSE' ? 'more stops while preserving hard constraints' : 'balanced number of stops and transition buffers'
    };
  });
}

function rankCandidates(candidates, profile) {
  return candidates.map((candidate) => {
    const score = scoreCandidate(candidate, profile);
    return { ...candidate, plannerScore: Number(score.toFixed(4)) };
  }).sort((a, b) => b.plannerScore - a.plannerScore || a.title.localeCompare(b.title));
}

function scoreCandidate(candidate, profile) {
  if (profile.avoidedActivityTypes.includes(candidate.type)) return -1;
  let score = 0;
  if (profile.preferredActivityTypes.includes(candidate.type)) score += 2.2;
  const matchingTags = candidate.tags.filter((tag) => profile.interestTags.includes(tag)).length;
  score += matchingTags * 0.6;
  if (candidate.rating !== null) score += (candidate.rating / 5) * 1.8;
  if (candidate.communityRating !== null) {
    const confidence = Math.min(1, Math.log10(Math.max(1, candidate.communityCount) + 1) / 2);
    score += (candidate.communityRating / 5) * 1.5 * confidence;
  }
  if (candidate.interestScore !== null) score += candidate.interestScore * 2;
  if (candidate.travelMinutes !== null) score -= Math.min(candidate.travelMinutes, 180) / 180;
  return score;
}

function optimizeVisitOrder(candidates, matrix, startLocationId, limit) {
  const remaining = candidates.filter((item) => item.plannerScore >= 0).slice(0, 80);
  const selected = [];
  let current = startLocationId;
  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestUtility = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index];
      const travel = matrixValue(matrix, current, item.locationId);
      const travelPenalty = travel === null ? 0.25 : Math.min(travel, 180) / 120;
      const utility = item.plannerScore - travelPenalty;
      if (utility > bestUtility) {
        bestUtility = utility;
        bestIndex = index;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    const travelFromPreviousMinutes = matrixValue(matrix, current, chosen.locationId);
    selected.push({
      candidateId: chosen.id,
      title: chosen.title,
      locationId: chosen.locationId,
      plannerScore: chosen.plannerScore,
      travelFromPreviousMinutes,
      travelTimeKnown: travelFromPreviousMinutes !== null
    });
    current = chosen.locationId || current;
  }
  return {
    stops: selected,
    requiresDistanceProvider: selected.some((item, index) => index > 0 && !item.travelTimeKnown),
    algorithm: 'preference-weighted nearest-next preview; production optimizer may replace this with provider-backed time-window routing'
  };
}

function normalizeTrip(input) {
  return {
    id: safeString(input.id, 120),
    title: safeString(input.title, 220) || 'Nova viagem',
    startDate: safeDate(input.startDate),
    endDate: safeDate(input.endDate),
    timeZone: safeString(input.timeZone, 100) || null,
    destination: safeString(input.destination, 220) || null
  };
}

function normalizeCandidates(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 500).map((item, index) => ({
    id: safeString(item.id, 160) || `candidate-${index + 1}`,
    title: safeString(item.title, 220) || 'Local sugerido',
    type: ACTIVITY_TYPES.has(item.type) ? item.type : 'OTHER',
    locationId: safeString(item.locationId, 220),
    address: safeString(item.address, 400),
    durationMinutes: clampInteger(item.durationMinutes, 10, 720, 90),
    rating: optionalBoundedNumber(item.rating, 0, 5),
    communityRating: optionalBoundedNumber(item.communityRating, 0, 5),
    communityCount: clampInteger(item.communityCount, 0, 100000000, 0),
    interestScore: optionalBoundedNumber(item.interestScore, 0, 1),
    travelMinutes: optionalBoundedNumber(item.travelMinutes, 0, 1440),
    tags: uniqueStrings(item.tags).slice(0, 30),
    provenance: item.provenance && typeof item.provenance === 'object' ? item.provenance : null
  }));
}

function normalizeEvents(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 500).map((item, index) => {
    const startsAt = safeDateTime(item.startsAt);
    const endsAt = safeDateTime(item.endsAt);
    return {
      id: safeString(item.id, 160) || `event-${index + 1}`,
      title: safeString(item.title, 220) || 'Compromisso',
      kind: safeString(item.kind, 60) || null,
      startsAt,
      endsAt,
      localDate: safeDate(item.localDate) || (startsAt ? startsAt.slice(0, 10) : null),
      locationId: safeString(item.locationId, 220),
      locked: item.locked !== false
    };
  });
}

function mealAnchor(date, kind, window, durationMinutes, mode) {
  return { kind, date, window, durationMinutes, mode, locked: false };
}

function normalizeWindow(value, defaultStart, defaultEnd) {
  return {
    start: safeTime(value?.start) || defaultStart,
    end: safeTime(value?.end) || defaultEnd
  };
}

function normalizeTravelMatrix(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output = {};
  for (const [key, value] of Object.entries(input).slice(0, 5000)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1440) output[String(key)] = parsed;
  }
  return output;
}

function matrixValue(matrix, from, to) {
  if (!from || !to) return null;
  const direct = matrix[`${from}|${to}`];
  if (Number.isFinite(direct)) return direct;
  const reverse = matrix[`${to}|${from}`];
  return Number.isFinite(reverse) ? reverse : null;
}

function paceStopLimit(pace) {
  if (pace === 'RELAXED') return 4;
  if (pace === 'INTENSE') return 10;
  return 7;
}

function dateRange(start, end, maxDays) {
  const startDate = parseDateUtc(start);
  const endDate = parseDateUtc(end);
  if (!startDate || !endDate || endDate < startDate) return [];
  const days = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate && days.length < maxDays) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function parseDateUtc(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeDate(value) {
  const string = String(value || '').trim();
  return parseDateUtc(string) ? string : null;
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeTime(value) {
  const string = String(value || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(string) ? string : null;
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const string = String(value).trim();
  return string ? string.slice(0, max) : null;
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().slice(0, 2000) : null;
  } catch {
    return null;
  }
}

function safeCode(value, fallback) {
  const string = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(string) ? string : fallback;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean))];
}

function optionalCoordinate(value, min, max) {
  return optionalBoundedNumber(value, min, max);
}

function optionalPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function optionalBoundedNumber(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function compareEvents(a, b) {
  return String(a.startsAt || '').localeCompare(String(b.startsAt || ''));
}
