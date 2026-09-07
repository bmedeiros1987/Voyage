const CREW_DAY_TYPES = new Set(['FLIGHT', 'DUTY', 'RESERVE', 'STANDBY', 'TRAINING', 'GROUND_DUTY', 'OTHER_WORK']);
const FREE_DAY_TYPES = new Set(['OFF', 'FOLGA', 'FREE_DAY']);

export function crewCheckIntegrationCapabilities() {
  return {
    version: '1.1',
    surfaceName: 'Voyage integrado',
    embeddedConcept: 'CREWCHECK_EXPLORER',
    embeddedBrand: 'VOYAGE',
    standaloneProductSeparate: true,
    integrationMode: 'DIRECT_PRODUCT_BRIDGE',
    principles: [
      'Inside CrewCheck, Voyage preserves the CrewCheck Explorer concept under the Voyage brand: contextual discovery around real crew availability.',
      'The embedded Voyage surface must not replicate or compete with native CrewCheck operational functions.',
      'CrewCheck remains the source of truth for roster, Smart Departure, radar, operational weather, regulation, duty lodging, alarms and crew finance.',
      'The standalone Voyage app remains a separate Travel Operating System and is the source of truth for personal-trip planning.',
      'When an embedded need is operational, Voyage should hand off or deep-link to the native CrewCheck capability instead of creating a parallel implementation.',
      'Only user-approved, minimized CrewCheck context is transferred into Voyage.',
      'Raw passwords, provider tokens, CPF, payment credentials, PNRs, private-home addresses and unrelated personal data are never part of the bridge contract.',
      'Crew work duties become planning constraints, not personal-trip itinerary items.',
      'A CrewCheck flight may inform crew availability and positioning, but it is never silently added to a personal Voyage itinerary.',
      'All Voyage itinerary mutations still require explicit user approval.'
    ],
    embeddedScope: [
      'FREE_TIME_DISCOVERY',
      'NEARBY_FOOD_AND_COFFEE',
      'LEISURE_AND_EXPERIENCES',
      'OVERNIGHT_SURROUNDINGS',
      'CONTEXTUAL_OPPORTUNITIES'
    ],
    crewCheckNativeScope: [
      'ROSTER',
      'SMART_DEPARTURE',
      'FLIGHT_RADAR',
      'OPERATIONAL_WEATHER',
      'REGULATION',
      'DUTY_LODGING',
      'WAKEUP',
      'PER_DIEM',
      'SALARY'
    ],
    sharedContext: [
      'CREW_MEMBER_ROLE',
      'BASE_AIRPORT',
      'TIMEZONE',
      'LOCALE',
      'ROSTER_MONTH',
      'WORK_ANCHORS',
      'EXPLICIT_FREE_DATES'
    ],
    excludedContext: [
      'PASSWORDS',
      'API_KEYS',
      'CPF',
      'PAYMENT_CREDENTIALS',
      'PNR',
      'PRIVATE_HOME_ADDRESS',
      'UNRELATED_EMAIL_CONTENT'
    ],
    approval: {
      requiredBeforeSharingRosterContext: true,
      requiredBeforeItineraryMutation: true,
      automaticItineraryMutationAllowed: false
    }
  };
}

export function buildCrewCheckVoyageContext(input = {}) {
  const approved = input.userApprovedShare === true || input.consent?.shareCrewCheckContext === true;
  const profile = normalizeProfile(input.profile || input.crewProfile || {});
  const roster = normalizeRoster(input.roster || input.schedule || {});
  const availability = summarizeAvailability(roster);

  if (!approved) {
    return {
      version: '1.0',
      status: 'AWAITING_USER_APPROVAL',
      source: 'CREWCHECK',
      product: 'VOYAGE',
      profile: publicProfile(profile),
      roster: null,
      availability: null,
      planningContext: null,
      approval: approvalState(false),
      message: 'O CrewCheck pode compartilhar sua disponibilidade operacional com o Voyage, mas somente após sua autorização.'
    };
  }

  const planningContext = {
    travellerMode: 'CREW_MEMBER',
    baseAirport: profile.baseAirport,
    timeZone: profile.timeZone,
    locale: profile.locale,
    hardWorkAnchors: roster.workAnchors,
    explicitFreeDates: availability.explicitFreeDates,
    unknownDates: availability.unknownDates,
    policies: {
      crewDutiesAreImmutablePlanningConstraints: true,
      crewFlightsBecomePersonalTripItemsAutomatically: false,
      flightRecommendationsEligibleForCrewWhenRelevant: true,
      protectRequiredRestAndUnknownDays: true,
      embeddedVoyageCompetesWithCrewCheckOperationalFunctions: false,
      userApprovalRequiredForVoyageChanges: true
    }
  };

  return {
    version: '1.1',
    status: roster.period || roster.workAnchors.length || availability.explicitFreeDates.length ? 'READY' : 'READY_WITH_LIMITED_CONTEXT',
    source: 'CREWCHECK',
    product: 'VOYAGE',
    embeddedMode: 'EXPLORER',
    profile: publicProfile(profile),
    roster,
    availability,
    planningContext,
    approval: approvalState(true),
    message: 'Voyage em modo Explorer integrado ao CrewCheck. Sua escala protege o tempo operacional; descoberta e lazer usam apenas as janelas realmente disponíveis.'
  };
}

export function buildCrewCheckBridgePreview(input = {}) {
  const context = buildCrewCheckVoyageContext(input);
  return {
    version: '1.1',
    surface: 'VOYAGE_INTEGRATED',
    legacySurface: 'CREWCHECK_EXPLORER',
    embeddedMode: 'EXPLORER',
    context,
    entry: {
      title: 'Voyage',
      subtitle: 'Explorer do tripulante · Beyond the trip.',
      badge: 'Integrado ao CrewCheck',
      primaryAction: context.status === 'AWAITING_USER_APPROVAL' ? 'AUTHORIZE_CREWCHECK_CONTEXT' : 'CONTINUE_IN_VOYAGE_EXPLORER',
      secondaryAction: 'OPEN_STANDALONE_VOYAGE'
    },
    mutationPolicy: {
      currentItineraryRemainsActive: true,
      proposedChangesRequireApproval: true,
      automaticApplyAllowed: false
    }
  };
}

function normalizeProfile(input) {
  return {
    role: 'CREW_MEMBER',
    baseAirport: airport(input.baseAirport || input.base || input.homeBase),
    timeZone: safeString(input.timeZone || input.timezone, 80) || 'America/Sao_Paulo',
    locale: safeString(input.locale, 30) || 'pt-BR'
  };
}

function publicProfile(profile) {
  return {
    role: profile.role,
    baseAirport: profile.baseAirport,
    timeZone: profile.timeZone,
    locale: profile.locale
  };
}

function normalizeRoster(input) {
  const year = integer(input.year, 2000, 2200);
  const month = integer(input.month, 1, 12);
  const period = year && month ? `${year}-${String(month).padStart(2, '0')}` : safeMonth(input.period);
  const days = Array.isArray(input.days) ? input.days.slice(0, 62).map(normalizeDay).filter(Boolean) : [];
  const workAnchors = days.flatMap((day) => day.workAnchors);
  return {
    period,
    dayCount: days.length,
    days,
    workAnchors,
    source: 'CREWCHECK_MINIMIZED_ROSTER',
    rawRosterShared: false
  };
}

function normalizeDay(input = {}) {
  const date = safeDate(input.date || input.localDate || input.dayDate);
  if (!date) return null;
  const explicitType = token(input.type || input.kind || input.status || input.activity);
  const legs = Array.isArray(input.legs) ? input.legs.slice(0, 20) : [];
  const duties = Array.isArray(input.duties) ? input.duties.slice(0, 20) : [];
  const events = Array.isArray(input.events) ? input.events.slice(0, 30) : [];
  const workAnchors = [];

  for (const event of [...legs, ...duties, ...events]) {
    const anchor = normalizeWorkAnchor(event, date, explicitType);
    if (anchor) workAnchors.push(anchor);
  }

  if (!workAnchors.length && CREW_DAY_TYPES.has(explicitType)) {
    const startsAt = safeDateTime(input.startsAt || input.start || input.presentationAt);
    const endsAt = safeDateTime(input.endsAt || input.end || input.releaseAt);
    workAnchors.push({
      id: safeString(input.id, 120) || `crew-${date}-${explicitType.toLowerCase()}`,
      date,
      kind: explicitType,
      startsAt,
      endsAt,
      originAirport: airport(input.origin || input.originAirport),
      destinationAirport: airport(input.destination || input.destinationAirport),
      source: 'CREWCHECK'
    });
  }

  const freeExplicit = FREE_DAY_TYPES.has(explicitType) || input.explicitFreeDay === true;
  const protectedUnknown = !freeExplicit && workAnchors.length === 0;

  return {
    date,
    type: freeExplicit ? 'FREE_DAY' : workAnchors.length ? 'WORK' : 'UNKNOWN',
    explicitFreeDay: freeExplicit,
    protectedUnknown,
    workAnchors
  };
}

function normalizeWorkAnchor(input = {}, date, fallbackType) {
  const kind = token(input.kind || input.type || input.activity || fallbackType || 'OTHER_WORK');
  const flightNumber = safeString(input.flightNumber || input.flight || input.number, 20);
  const originAirport = airport(input.originAirport || input.origin);
  const destinationAirport = airport(input.destinationAirport || input.destination);
  const startsAt = safeDateTime(input.startsAt || input.start || input.departureAt || input.presentationAt);
  const endsAt = safeDateTime(input.endsAt || input.end || input.arrivalAt || input.releaseAt);
  const looksOperational = CREW_DAY_TYPES.has(kind) || Boolean(flightNumber || startsAt || endsAt || originAirport || destinationAirport);
  if (!looksOperational) return null;
  return {
    id: safeString(input.id, 120) || `crew-${date}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    kind: kind === 'UNKNOWN' ? 'OTHER_WORK' : kind,
    startsAt,
    endsAt,
    flightNumber,
    originAirport,
    destinationAirport,
    source: 'CREWCHECK'
  };
}

function summarizeAvailability(roster) {
  const explicitFreeDates = [];
  const hardUnavailableDates = [];
  const unknownDates = [];
  for (const day of roster.days) {
    if (day.explicitFreeDay) explicitFreeDates.push(day.date);
    else if (day.workAnchors.length) hardUnavailableDates.push(day.date);
    else unknownDates.push(day.date);
  }
  return {
    explicitFreeDates: unique(explicitFreeDates),
    hardUnavailableDates: unique(hardUnavailableDates),
    unknownDates: unique(unknownDates),
    policy: 'Only explicit CrewCheck free-day facts are treated as free. Unknown or required-rest days are not assumed available.'
  };
}

function approvalState(approved) {
  return {
    crewCheckContextShareApproved: approved,
    itineraryMutationApproved: false,
    itineraryMutationRequiresSeparateApproval: true,
    automaticMutationAllowed: false
  };
}

function airport(value) {
  const text = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(text) ? text : null;
}

function safeDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : text;
}

function safeMonth(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : null;
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function token(value) {
  const text = String(value || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (text === 'FOLGA') return 'FOLGA';
  if (text === 'OFF') return 'OFF';
  if (text === 'FREE' || text === 'FREE_DAY') return 'FREE_DAY';
  if (text.includes('RESERVA')) return 'RESERVE';
  if (text.includes('SOBREAVISO')) return 'STANDBY';
  if (text.includes('TREIN')) return 'TRAINING';
  if (text.includes('VOO') || text === 'FLIGHT') return 'FLIGHT';
  if (text.includes('DUTY') || text.includes('JORNADA')) return 'DUTY';
  return text || 'UNKNOWN';
}

function integer(value, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
