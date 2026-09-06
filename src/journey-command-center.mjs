import { resolveLodgingPlan } from './lodging-intelligence.mjs';
import { buildChronologicalItinerary } from './chronological-itinerary.mjs';
import { buildTransportChoice } from './transport-intelligence.mjs';
import { buildDepartureDecision } from './departure-intelligence.mjs';
import { buildAirportConnectionPlan } from './airport-connection-intelligence.mjs';
import { buildBaggageConnectionDecision } from './baggage-intelligence.mjs';
import { buildAirportIndoorRoute } from './airport-indoor-navigation.mjs';
import { buildBudgetPlan } from './budget-intelligence.mjs';
import { buildJourneyReadiness } from './journey-readiness.mjs';
import { resolveEcosystemCapabilities } from './ecosystem-service-router.mjs';

export function journeyCommandCenterCapabilities() {
  return {
    version: '1.0',
    purpose: 'Compose Voyage intelligence into one operational trip state without silently mutating the itinerary.',
    layers: [
      'LODGING',
      'CHRONOLOGY',
      'TRANSPORT',
      'DEPARTURE',
      'AIRPORT_CONNECTION',
      'BAGGAGE',
      'AIRPORT_INDOOR_NAVIGATION',
      'BUDGET',
      'JOURNEY_READINESS',
      'ECOSYSTEM_SERVICES'
    ],
    principles: [
      'The active itinerary remains unchanged until the user explicitly approves a proposed mutation.',
      'Operational alerts such as leave-now, baggage pickup and gate or carousel guidance may be emitted automatically because they do not mutate the itinerary.',
      'CrewCheck shared services are preferred when eligible; personal user context stays product-scoped.',
      'Unknown operational facts remain unresolved instead of being guessed.',
      'Every material recommendation exposes the facts, gaps and approval state used to produce it.'
    ],
    mutationPolicy: {
      detectAutomatically: true,
      explainAutomatically: true,
      proposeAutomatically: true,
      applyAutomatically: false,
      explicitUserApprovalRequired: true
    }
  };
}

export function buildJourneyCommandCenter(input = {}) {
  const services = input.services
    ? resolveEcosystemCapabilities({
        requestedCapabilities: input.requestedCapabilities || defaultRequestedCapabilities(input),
        services: input.services,
        now: input.now,
        maxAgeMinutes: input.serviceMaxAgeMinutes
      })
    : null;

  const lodging = hasAny(input, ['lodging', 'trip', 'lodgingReservations', 'reservations', 'hostStays', 'privateHostStays'])
    ? resolveLodgingPlan({
        trip: input.trip,
        reservations: input.lodgingReservations || input.reservations,
        hostStays: input.hostStays || input.privateHostStays,
        userChoice: input.lodgingChoice || input.lodgingPreference
      })
    : null;

  const chronologyInput = input.chronology || input.itinerary;
  const chronology = chronologyInput
    ? buildChronologicalItinerary({
        ...chronologyInput,
        trip: chronologyInput.trip || input.trip
      })
    : null;

  const transport = input.transportChoice
    ? buildTransportChoice(input.transportChoice)
    : null;

  const departure = input.departure
    ? buildDepartureDecision(input.departure)
    : null;

  const airportConnection = input.airportConnection
    ? buildAirportConnectionPlan(input.airportConnection)
    : null;

  const baggage = input.baggageConnection
    ? buildBaggageConnectionDecision(input.baggageConnection)
    : null;

  const indoorNavigation = input.indoorNavigation
    ? buildAirportIndoorRoute(input.indoorNavigation)
    : null;

  const budget = input.budget
    ? buildBudgetPlan(input.budget)
    : null;

  const readiness = buildJourneyReadiness(buildReadinessInput({
    input,
    lodging,
    chronology,
    budget,
    baggage,
    airportConnection
  }));

  const alerts = buildOperationalAlerts({
    departure,
    airportConnection,
    baggage,
    indoorNavigation,
    budget,
    readiness
  });

  const proposal = buildMutationProposal(input.proposedChanges || input.proposal, input.userApproval);

  return {
    version: '1.0',
    generatedAt: safeDateTime(input.now) || new Date().toISOString(),
    status: commandStatus(readiness, proposal),
    services,
    lodging,
    chronology,
    transport,
    departure,
    airportConnection,
    baggage,
    indoorNavigation,
    budget,
    readiness,
    alerts,
    proposal,
    mutationPolicy: {
      automaticMutationAllowed: false,
      explicitUserApprovalRequired: true,
      activeItineraryRemainsCurrentUntilApproval: true,
      executionState: proposal?.approved ? 'APPROVED_CHANGE' : proposal ? 'PROPOSAL_ONLY' : 'NO_CHANGE_PROPOSED'
    }
  };
}

function buildReadinessInput({ input, lodging, chronology, budget, baggage, airportConnection }) {
  const uncoveredNights = lodging?.nights?.filter((night) => night.status === 'UNRESOLVED').length ?? undefined;
  const lodgingRequired = Array.isArray(lodging?.nights) ? lodging.nights.length > 0 : undefined;
  const chronologyContinuity = chronology?.completeness?.allLocationChangesRouted;
  const unresolvedRequiredSegments = chronology?.researchNeeds?.filter((need) => String(need).startsWith('ROUTE:')).length;
  const remainingBudget = budget?.spending?.remainingTotalHome;

  const baggageDecisionKnown = baggage
    ? !['VERIFY_WITH_AIRLINE', 'VERIFY_INTERAIRPORT_TRANSFER'].includes(baggage.decision)
    : undefined;

  const connectionAtRisk = airportConnection
    ? ['HIGH', 'IMPOSSIBLE'].includes(airportConnection?.recommended?.riskLevel)
      || ['HIGH', 'IMPOSSIBLE'].includes(airportConnection?.connectionRisk)
      || airportConnection.status === 'IMPOSSIBLE'
    : undefined;

  return {
    documents: input.readiness?.documents || input.documents || {},
    transport: {
      ...(input.readiness?.transport || {}),
      continuityComplete: chronologyContinuity,
      unresolvedRequiredSegments: Number.isFinite(unresolvedRequiredSegments) ? unresolvedRequiredSegments : undefined
    },
    lodging: {
      ...(input.readiness?.lodging || {}),
      required: lodgingRequired,
      uncoveredNights,
      allNightsCovered: uncoveredNights === 0 && lodgingRequired === true
    },
    budget: {
      ...(input.readiness?.budget || {}),
      configured: Boolean(budget?.budget?.totalBudget !== null && budget?.budget?.totalBudget !== undefined),
      remainingAmount: remainingBudget,
      overBudget: Number.isFinite(remainingBudget) ? remainingBudget < 0 : undefined
    },
    localCash: {
      ...(input.readiness?.localCash || {}),
      required: budget?.localCash?.international,
      internationalTrip: budget?.localCash?.international,
      localCurrencyAvailable: Number(budget?.localCash?.onHand) > 0,
      emergencyReserveCovered: Number.isFinite(Number(budget?.localCash?.shortfall)) ? Number(budget.localCash.shortfall) <= 0 : undefined,
      cashOnlyShortfall: Number(budget?.localCash?.shortfall || 0)
    },
    baggage: {
      ...(input.readiness?.baggage || {}),
      checkedBag: baggage?.baggage?.hasCheckedBag,
      connectionRequiresDecision: Boolean(baggage && baggage?.baggage?.hasCheckedBag),
      pickupRuleKnown: baggageDecisionKnown
    },
    airportConnections: {
      ...(input.readiness?.airportConnections || {}),
      required: airportConnection?.airportChange,
      feasible: connectionAtRisk === undefined ? undefined : !connectionAtRisk
    },
    weather: input.readiness?.weather || input.weatherReadiness || {},
    offline: input.readiness?.offline || input.offline || {},
    emergency: input.readiness?.emergency || input.emergency || {}
  };
}

function buildOperationalAlerts({ departure, airportConnection, baggage, indoorNavigation, budget, readiness }) {
  const alerts = [];

  if (departure?.status && !['WATCHING', 'NEEDS_DATA', 'ARRIVED'].includes(departure.status)) {
    alerts.push({
      type: `DEPARTURE_${departure.status}`,
      priority: ['AT_RISK', 'LATE'].includes(departure.status) ? 'CRITICAL' : 'HIGH',
      mutation: false,
      data: departure.notification || null
    });
  }

  for (const alert of baggage?.alerts || []) {
    alerts.push({ ...alert, source: 'BAGGAGE', mutation: false });
  }

  if (airportConnection?.status === 'IMPOSSIBLE' || ['HIGH', 'IMPOSSIBLE'].includes(airportConnection?.connectionRisk)) {
    alerts.push({ type: 'AIRPORT_CONNECTION_RISK', priority: 'CRITICAL', source: 'AIRPORT_CONNECTION', mutation: false });
  }

  if (indoorNavigation?.status === 'NEEDS_INDOOR_MAP_DATA') {
    alerts.push({ type: 'INDOOR_MAP_DATA_MISSING', priority: 'MEDIUM', source: 'AIRPORT_INDOOR_NAVIGATION', mutation: false });
  }

  if (budget?.status === 'ACTION_NEEDED') {
    alerts.push({ type: 'BUDGET_ACTION_NEEDED', priority: 'HIGH', source: 'BUDGET', mutation: false });
  }

  for (const blocker of readiness?.blockers || []) {
    alerts.push({ type: `READINESS_BLOCKER_${blocker}`, priority: 'CRITICAL', source: 'JOURNEY_READINESS', mutation: false });
  }

  return dedupeAlerts(alerts);
}

function buildMutationProposal(proposedChanges, userApproval) {
  if (!proposedChanges) return null;
  const changes = Array.isArray(proposedChanges) ? proposedChanges : proposedChanges.changes || [];
  const approved = userApproval === true || proposedChanges.userApproved === true;
  return {
    state: approved ? 'APPROVED' : 'AWAITING_USER_APPROVAL',
    approved,
    changes: changes.slice(0, 100).map((change, index) => ({
      id: String(change.id || `change-${index + 1}`),
      type: String(change.type || 'ITINERARY_CHANGE').toUpperCase(),
      reason: change.reason ? String(change.reason) : null,
      before: change.before ?? null,
      after: change.after ?? null
    })),
    canApply: approved,
    automaticApplyAllowed: false,
    userApprovalRequired: !approved
  };
}

function defaultRequestedCapabilities(input) {
  const requested = new Set();
  if (input.airportConnection || input.baggageConnection || input.indoorNavigation) {
    ['FLIGHT_STATUS', 'AIRPORT_OPERATIONS', 'GATE', 'TERMINAL', 'BAGGAGE_CAROUSEL'].forEach((item) => requested.add(item));
  }
  if (input.transportChoice || input.departure || input.airportConnection) {
    ['ROUTES', 'LIVE_TRAFFIC', 'TRANSIT'].forEach((item) => requested.add(item));
  }
  if (input.budget) requested.add('CURRENCY');
  return [...requested];
}

function commandStatus(readiness, proposal) {
  if (readiness?.status === 'BLOCKED') return 'BLOCKED';
  if (proposal && !proposal.approved) return 'AWAITING_USER_APPROVAL';
  if (readiness?.status === 'ATTENTION') return 'ATTENTION';
  return 'READY';
}

function dedupeAlerts(alerts) {
  const seen = new Set();
  return alerts.filter((alert) => {
    const key = `${alert.type}:${alert.source || ''}:${alert.carousel || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasAny(input, keys) {
  return keys.some((key) => input[key] !== undefined && input[key] !== null);
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
