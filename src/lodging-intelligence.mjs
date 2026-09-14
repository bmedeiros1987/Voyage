const LODGING_TYPES = new Set(['HOTEL', 'HOSTEL', 'RENTAL', 'FRIEND_HOME', 'RELATIVE_HOME', 'OTHER_PRIVATE_HOST']);
const HOST_TYPES = new Set(['FRIEND_HOME', 'RELATIVE_HOME', 'OTHER_PRIVATE_HOST']);

export function lodgingIntelligenceCapabilities() {
  return {
    version: '1.0',
    lodgingTypes: [...LODGING_TYPES],
    privateHostTypes: [...HOST_TYPES],
    policies: [
      'A confirmed hotel or rental reservation is a valid lodging base but does not override an explicit user choice to stay with a friend or relative.',
      'When no lodging reservation is found, the planner may ask whether the user can stay with friends or relatives before treating paid lodging as the only path.',
      'A friend or relative home is a first-class lodging base for route planning, meal planning and day-start/day-end calculations.',
      'The system never infers private homes from contacts, email or social data without explicit user input and consent.',
      'A private host stay is not treated as confirmed unless the user says the stay is confirmed or supplies an explicitly confirmed host-stay record.',
      'The planner must not assume breakfast, parking, keys, check-in flexibility or other amenities at a private home unless the user or host record explicitly supplies them.',
      'Private addresses should be represented to planning components by a location identifier whenever possible; display of a full address should be minimized.'
    ]
  };
}

export function resolveLodgingPlan(input = {}) {
  const trip = normalizeTrip(input.trip || {});
  const reservations = normalizeReservations(input.reservations || input.lodgingReservations || []);
  const hostStays = normalizeHostStays(input.hostStays || input.privateHostStays || []);
  const userChoice = normalizeUserChoice(input.userChoice || input.lodgingPreference || {});
  const nights = trip.startDate && trip.endDate ? dateRange(trip.startDate, trip.endDate, 90).slice(0, -1) : [];
  const plan = [];
  const questions = [];
  const researchNeeds = new Set();
  const warnings = [];

  if (!trip.startDate || !trip.endDate) {
    researchNeeds.add('TRIP_DATES');
  }

  for (const night of nights) {
    const reservation = chooseReservationForNight(reservations, night, trip.destinationId);
    const explicitHost = chooseExplicitHostForNight(hostStays, night, userChoice);
    const availableHost = chooseAvailableHostForNight(hostStays, night, trip.destinationId);

    if (explicitHost) {
      plan.push(hostNight(explicitHost, night, 'USER_SELECTED_HOST'));
      if (!explicitHost.confirmed) {
        questions.push({
          id: `CONFIRM_HOST_STAY:${night}`,
          required: true,
          night,
          prompt: 'Essa hospedagem na casa de amigo ou parente já está confirmada?',
          hostStayId: explicitHost.id
        });
      }
      continue;
    }

    if (reservation) {
      plan.push(reservationNight(reservation, night));
      continue;
    }

    if (availableHost) {
      plan.push(hostNight(availableHost, night, availableHost.confirmed ? 'NO_BOOKING_FOUND_CONFIRMED_HOST' : 'NO_BOOKING_FOUND_HOST_OPTION'));
      if (!availableHost.confirmed) {
        questions.push({
          id: `CONFIRM_HOST_STAY:${night}`,
          required: true,
          night,
          prompt: 'Não encontrei uma hospedagem confirmada. Quer considerar ficar na casa deste amigo ou parente?',
          hostStayId: availableHost.id
        });
      }
      continue;
    }

    plan.push({
      night,
      status: 'UNRESOLVED',
      lodgingType: null,
      lodgingId: null,
      locationId: null,
      reason: 'NO_RESERVATION_OR_HOST_STAY',
      confirmed: false,
      breakfastKnown: false,
      breakfastIncluded: null
    });
    questions.push({
      id: `ASK_FRIENDS_OR_FAMILY:${night}`,
      required: false,
      night,
      prompt: 'Não encontrei hospedagem confirmada para esta noite. Você tem amigo ou parente no destino com quem poderia ficar?',
      options: ['SIM_AMIGO', 'SIM_PARENTE', 'NAO', 'QUERO_PROCURAR_HOTEL']
    });
    researchNeeds.add(`LODGING:${night}`);
  }

  const unresolved = plan.filter((item) => item.status === 'UNRESOLVED').length;
  const pendingHostConfirmation = plan.filter((item) => HOST_TYPES.has(item.lodgingType) && !item.confirmed).length;
  const baseLocations = plan.filter((item) => item.locationId).map((item) => ({ night: item.night, locationId: item.locationId, lodgingType: item.lodgingType }));

  if (pendingHostConfirmation) warnings.push('PRIVATE_HOST_STAY_REQUIRES_CONFIRMATION');

  return {
    version: '1.0',
    trip,
    status: unresolved ? 'NEEDS_LODGING' : pendingHostConfirmation ? 'NEEDS_HOST_CONFIRMATION' : 'READY',
    nights: plan,
    baseLocations,
    questions,
    researchNeeds: [...researchNeeds],
    warnings,
    routePlanningPolicy: 'Use the selected lodging base, including a friend or relative home, as the start/end point for daily routing once its location is known.',
    mealPlanningPolicy: 'Do not assume meals are provided at a private home. Breakfast is only marked available when explicitly supplied.',
    privacyPolicy: 'Do not discover or expose private-home addresses from contacts, email or social sources without explicit user input and consent.'
  };
}

function chooseReservationForNight(reservations, night, destinationId) {
  return reservations
    .filter((item) => item.confirmed && coversNight(item.checkInDate, item.checkOutDate, night))
    .filter((item) => !destinationId || !item.destinationId || item.destinationId === destinationId)
    .sort((a, b) => Number(b.fixed) - Number(a.fixed))[0] || null;
}

function chooseExplicitHostForNight(hostStays, night, userChoice) {
  const explicitId = userChoice.hostStayId;
  if (explicitId) {
    return hostStays.find((item) => item.id === explicitId && hostCoversNight(item, night)) || null;
  }
  if (userChoice.type && HOST_TYPES.has(userChoice.type)) {
    return hostStays.find((item) => item.type === userChoice.type && hostCoversNight(item, night)) || null;
  }
  return null;
}

function chooseAvailableHostForNight(hostStays, night, destinationId) {
  return hostStays
    .filter((item) => item.userProvided)
    .filter((item) => hostCoversNight(item, night))
    .filter((item) => !destinationId || !item.destinationId || item.destinationId === destinationId)
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.preferenceScore - a.preferenceScore)[0] || null;
}

function reservationNight(reservation, night) {
  return {
    night,
    status: 'CONFIRMED',
    lodgingType: reservation.type,
    lodgingId: reservation.id,
    locationId: reservation.locationId,
    reason: 'CONFIRMED_RESERVATION',
    confirmed: true,
    fixed: reservation.fixed,
    breakfastKnown: reservation.breakfastIncluded !== null,
    breakfastIncluded: reservation.breakfastIncluded,
    source: reservation.source
  };
}

function hostNight(host, night, reason) {
  return {
    night,
    status: host.confirmed ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
    lodgingType: host.type,
    lodgingId: host.id,
    locationId: host.locationId,
    reason,
    confirmed: host.confirmed,
    fixed: false,
    hostLabel: host.label,
    breakfastKnown: host.breakfastAvailable !== null,
    breakfastIncluded: host.breakfastAvailable,
    parkingKnown: host.parkingAvailable !== null,
    parkingAvailable: host.parkingAvailable,
    source: 'USER_PRIVATE_HOST'
  };
}

function normalizeTrip(input) {
  return {
    startDate: safeDate(input.startDate),
    endDate: safeDate(input.endDate),
    destinationId: safeString(input.destinationId || input.destinationLocationId, 220)
  };
}

function normalizeReservations(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 300).map((item, index) => ({
    id: safeString(item.id, 180) || `lodging-${index + 1}`,
    type: normalizeLodgingType(item.type, 'HOTEL'),
    checkInDate: safeDate(item.checkInDate || item.startDate),
    checkOutDate: safeDate(item.checkOutDate || item.endDate),
    destinationId: safeString(item.destinationId || item.destinationLocationId, 220),
    locationId: safeString(item.locationId, 220),
    confirmed: item.confirmed !== false && String(item.status || 'CONFIRMED').toUpperCase() !== 'CANCELLED',
    fixed: item.fixed !== false,
    breakfastIncluded: optionalBoolean(item.breakfastIncluded),
    source: safeString(item.source || item.provider, 120)
  })).filter((item) => item.checkInDate && item.checkOutDate);
}

function normalizeHostStays(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 200).map((item, index) => ({
    id: safeString(item.id, 180) || `host-${index + 1}`,
    type: HOST_TYPES.has(String(item.type || '').toUpperCase()) ? String(item.type).toUpperCase() : 'OTHER_PRIVATE_HOST',
    label: safeString(item.label || item.relationshipLabel, 120) || 'Casa de anfitrião',
    destinationId: safeString(item.destinationId || item.destinationLocationId, 220),
    locationId: safeString(item.locationId, 220),
    startDate: safeDate(item.startDate),
    endDate: safeDate(item.endDate),
    confirmed: item.confirmed === true,
    userProvided: item.userProvided !== false,
    preferenceScore: clampNumber(item.preferenceScore, 0, 10, 5),
    breakfastAvailable: optionalBoolean(item.breakfastAvailable),
    parkingAvailable: optionalBoolean(item.parkingAvailable)
  })).filter((item) => item.locationId || item.destinationId);
}

function normalizeUserChoice(input) {
  const type = HOST_TYPES.has(String(input.type || '').toUpperCase()) ? String(input.type).toUpperCase() : null;
  return {
    type,
    hostStayId: safeString(input.hostStayId, 180)
  };
}

function hostCoversNight(host, night) {
  if (!host.startDate && !host.endDate) return true;
  if (host.startDate && night < host.startDate) return false;
  if (host.endDate && night >= host.endDate) return false;
  return true;
}

function coversNight(start, end, night) {
  return Boolean(start && end && night >= start && night < end);
}

function normalizeLodgingType(value, fallback) {
  const token = String(value || '').toUpperCase();
  return LODGING_TYPES.has(token) ? token : fallback;
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

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function optionalBoolean(value) {
  return value === true ? true : value === false ? false : null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
