import { createTravelDataBroker } from './travel-data-broker.mjs';
import { buildBaggageConnectionDecision } from './baggage-intelligence.mjs';

export function arrivalIntelligenceCapabilities() {
  return {
    version: '1.0',
    purpose: 'Turn provider-backed arrival facts into calm baggage and next-step guidance without guessing through-check rules.',
    sharedSources: ['CREWCHECK_SHARED_FLIGHT_STATUS', 'CIRIUM'],
    outputs: ['ARRIVAL_GATE', 'ARRIVAL_TERMINAL', 'BAGGAGE_CAROUSEL', 'BAGGAGE_DECISION', 'NEXT_STEP', 'INDOOR_NAVIGATION_TARGET'],
    policies: [
      'Use the CrewCheck shared flight-status service before creating a duplicate Cirium integration.',
      'Carousel assignment is not evidence that the traveller must collect a checked bag.',
      'Through-check and customs/recheck decisions require explicit baggage evidence or remain unresolved.',
      'Gate, terminal and carousel changes are operational updates and may refresh automatically.',
      'Any resulting itinerary mutation still requires explicit user approval.'
    ],
    itineraryMutationAllowedAutomatically: false
  };
}

export async function buildArrivalIntelligence(input = {}, options = {}) {
  const broker = options.broker || createTravelDataBroker(options.brokerOptions || {});
  const flightQuery = normalizeFlightQuery(input.flight || input);
  const flightStatus = flightQuery
    ? await broker.latestFlightStatus(flightQuery, input.providerOptions || {})
    : { ok: false, code: 'FLIGHT_QUERY_REQUIRED', flights: [], broker: { route: 'NO_PROVIDER_CALL' } };

  const selectedFlight = chooseFlight(flightStatus?.flights || [], input);
  const resources = selectedFlight?.resources || {};
  const carouselValue = text(resources.baggage, 40);
  const arrivalGate = text(resources.arrivalGate, 40);
  const arrivalTerminal = text(resources.arrivalTerminal, 40);
  const observedAt = safeDateTime(
    selectedFlight?.freshness?.updatedAt
      || selectedFlight?.updatedAt
      || flightStatus?.fetchedAt
  );

  const baggageDecision = buildBaggageConnectionDecision({
    connection: input.connection || {},
    baggage: input.baggage || {},
    evidence: input.evidence || input.baggageEvidence || {},
    carousel: carouselValue ? {
      carousel: carouselValue,
      terminal: arrivalTerminal,
      provider: selectedFlight?.provider || flightStatus?.provider || 'CIRIUM',
      observedAt
    } : {},
    previousCarousel: input.previousCarousel || null
  });

  const flow = buildArrivalFlow({
    input,
    arrivalGate,
    arrivalTerminal,
    baggageDecision
  });

  return {
    version: '1.0',
    status: selectedFlight ? 'ARRIVAL_FACTS_READY' : flightQuery ? 'ARRIVAL_FACTS_UNAVAILABLE' : 'NEEDS_FLIGHT_QUERY',
    flightQuery,
    flightStatus: summarizeFlightStatus(flightStatus),
    arrival: {
      gate: arrivalGate,
      terminal: arrivalTerminal,
      baggageCarousel: carouselValue,
      observedAt,
      provider: selectedFlight?.provider || flightStatus?.provider || null,
      stale: flightStatus?.status === 'STALE_IF_ERROR' || flightStatus?.cache?.stale === true
    },
    baggage: baggageDecision,
    flow,
    operationalUpdates: buildOperationalUpdates({
      input,
      arrivalGate,
      arrivalTerminal,
      carouselValue,
      observedAt
    }),
    policy: {
      operationalFactsMayRefreshAutomatically: true,
      itineraryMutationAllowedAutomatically: false,
      explicitUserApprovalRequiredForItineraryChanges: true,
      carouselDeterminesBagCollection: false
    }
  };
}

function buildArrivalFlow({ input, arrivalGate, arrivalTerminal, baggageDecision }) {
  const steps = [];
  if (arrivalGate || arrivalTerminal) {
    steps.push({
      kind: 'ARRIVAL_GATE',
      status: 'KNOWN',
      label: [arrivalTerminal && `Terminal ${arrivalTerminal}`, arrivalGate && `Portão ${arrivalGate}`].filter(Boolean).join(' · '),
      indoorTargetType: 'GATE'
    });
  }
  if (input.connection?.immigrationRequired === true) {
    steps.push({ kind: 'IMMIGRATION', status: 'REQUIRED', label: 'Imigração', indoorTargetType: 'IMMIGRATION' });
  }

  if (['COLLECT_REQUIRED', 'COLLECT_FOR_CUSTOMS_RECHECK'].includes(baggageDecision.decision)) {
    const carousel = baggageDecision.carousel?.name || null;
    steps.push({
      kind: 'BAGGAGE_CLAIM',
      status: carousel ? 'KNOWN' : 'NEEDS_CAROUSEL',
      label: carousel ? `Retire a bagagem · Esteira ${carousel}` : 'Retire a bagagem · esteira a confirmar',
      indoorTargetType: 'BAGGAGE_CLAIM'
    });
  } else if (baggageDecision.decision === 'THROUGH_CHECKED_DO_NOT_COLLECT') {
    steps.push({ kind: 'BAGGAGE', status: 'SKIP_CONFIRMED', label: 'Bagagem segue despachada', indoorTargetType: null });
  } else if (!['NO_CHECKED_BAG'].includes(baggageDecision.decision)) {
    steps.push({ kind: 'BAGGAGE', status: 'VERIFY', label: 'Confirme se deve retirar a bagagem', indoorTargetType: null });
  }

  if (input.connection?.customsRequired === true || baggageDecision.decision === 'COLLECT_FOR_CUSTOMS_RECHECK') {
    steps.push({ kind: 'CUSTOMS', status: 'REQUIRED', label: 'Alfândega', indoorTargetType: 'CUSTOMS' });
  }
  if (baggageDecision.decision === 'COLLECT_FOR_CUSTOMS_RECHECK' || input.connection?.recheckRequired === true) {
    steps.push({ kind: 'BAG_DROP', status: 'REQUIRED', label: 'Novo despacho da bagagem', indoorTargetType: 'BAG_DROP' });
  }

  const nextAirport = code(input.connection?.nextDepartureAirport);
  const arrivalAirport = code(input.connection?.arrivalAirport);
  if (nextAirport && arrivalAirport && nextAirport !== arrivalAirport) {
    steps.push({ kind: 'AIRPORT_TRANSFER', status: 'REQUIRED', label: `${arrivalAirport} → ${nextAirport}`, indoorTargetType: 'GROUND_TRANSPORT' });
  } else if (input.connection?.nextGateId || input.connection?.nextGate) {
    steps.push({ kind: 'NEXT_GATE', status: 'KNOWN', label: `Próximo portão ${text(input.connection.nextGateId || input.connection.nextGate, 40)}`, indoorTargetType: 'GATE' });
  } else {
    steps.push({ kind: 'EXIT_OR_NEXT_STEP', status: 'CONTEXT_REQUIRED', label: 'Próxima etapa da jornada', indoorTargetType: 'TERMINAL_EXIT' });
  }

  return steps;
}

function buildOperationalUpdates({ input, arrivalGate, arrivalTerminal, carouselValue, observedAt }) {
  const updates = [];
  const previous = input.previousOperational || {};
  if (arrivalGate && previous.arrivalGate && String(previous.arrivalGate) !== arrivalGate) {
    updates.push({ kind: 'ARRIVAL_GATE_CHANGED', from: String(previous.arrivalGate), to: arrivalGate, observedAt, itineraryMutation: false });
  }
  if (arrivalTerminal && previous.arrivalTerminal && String(previous.arrivalTerminal) !== arrivalTerminal) {
    updates.push({ kind: 'ARRIVAL_TERMINAL_CHANGED', from: String(previous.arrivalTerminal), to: arrivalTerminal, observedAt, itineraryMutation: false });
  }
  if (carouselValue && previous.baggageCarousel && String(previous.baggageCarousel) !== carouselValue) {
    updates.push({ kind: 'BAGGAGE_CAROUSEL_CHANGED', from: String(previous.baggageCarousel), to: carouselValue, observedAt, itineraryMutation: false });
  }
  return updates;
}

function summarizeFlightStatus(input) {
  return {
    ok: input?.ok === true,
    provider: input?.provider || null,
    status: input?.status || null,
    code: input?.code || null,
    count: Number(input?.count || (Array.isArray(input?.flights) ? input.flights.length : 0)),
    broker: input?.broker || null,
    cache: input?.cache || null,
    secretsExposed: false
  };
}

function chooseFlight(flights, input) {
  if (!Array.isArray(flights) || !flights.length) return null;
  const expectedOrigin = code(input.connection?.arrivalAirport ? input.flight?.origin : input.flight?.origin || input.origin);
  const expectedDestination = code(input.connection?.arrivalAirport || input.flight?.destination || input.destination);
  const scored = flights.map((flight, index) => ({
    flight,
    score: (expectedOrigin && code(flight?.route?.departure) === expectedOrigin ? 2 : 0)
      + (expectedDestination && code(flight?.route?.arrival) === expectedDestination ? 3 : 0)
      + (flight?.freshness?.updatedAt ? 1 : 0)
      - index * 0.001
  }));
  return scored.sort((a, b) => b.score - a.score)[0]?.flight || null;
}

function normalizeFlightQuery(input = {}) {
  const carrier = String(input.carrier || input.airline || '').trim().toUpperCase();
  let flight = String(input.flight || input.flightNumber || '').trim().toUpperCase().replace(/\s+/g, '');
  if (carrier && flight.startsWith(carrier)) flight = flight.slice(carrier.length);
  const date = String(input.date || input.departureDate || '').trim();
  if (!/^[A-Z0-9]{2,3}$/.test(carrier) || !/^[0-9]{1,4}[A-Z]?$/.test(flight) || !validDate(date)) return null;
  return { carrier, flight, date };
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function safeDateTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function text(value, max) {
  const clean = String(value || '').trim();
  return clean ? clean.slice(0, max) : null;
}

function code(value) {
  const clean = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{3,4}$/.test(clean) ? clean : null;
}
