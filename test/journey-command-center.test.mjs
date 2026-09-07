import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJourneyCommandCenter, journeyCommandCenterCapabilities } from '../src/journey-command-center.mjs';

test('capabilities enforce explicit approval before itinerary mutation', () => {
  const capabilities = journeyCommandCenterCapabilities();
  assert.equal(capabilities.mutationPolicy.applyAutomatically, false);
  assert.equal(capabilities.mutationPolicy.explicitUserApprovalRequired, true);
  assert.ok(capabilities.layers.includes('BAGGAGE'));
  assert.ok(capabilities.layers.includes('AIRPORT_INDOOR_NAVIGATION'));
});

test('explicit friend stay becomes lodging base and readiness sees covered night', () => {
  const result = buildJourneyCommandCenter({
    trip: { startDate: '2026-10-01', endDate: '2026-10-02', destinationId: 'RIO' },
    hostStays: [{
      id: 'friend-rio',
      type: 'FRIEND_HOME',
      destinationId: 'RIO',
      locationId: 'private-host-rio',
      confirmed: true,
      userProvided: true
    }],
    lodgingChoice: { hostStayId: 'friend-rio' },
    readiness: {
      documents: { required: false },
      transport: { continuityComplete: true },
      weather: { checked: true, severeRisk: false },
      offline: { packageReady: true },
      emergency: { configured: true }
    }
  });

  assert.equal(result.lodging.status, 'READY');
  assert.equal(result.lodging.nights[0].lodgingType, 'FRIEND_HOME');
  assert.equal(result.lodging.nights[0].locationId, 'private-host-rio');
  assert.equal(result.readiness.checks.find((item) => item.dimension === 'LODGING_COVERAGE').level, 'OK');
});

test('baggage pickup guidance can alert automatically without mutating itinerary', () => {
  const result = buildJourneyCommandCenter({
    baggageConnection: {
      connection: {
        arrivalAirport: 'GRU',
        departureAirport: 'CGH',
        interAirportTransfer: true,
        finalDestinationAirport: 'BSB'
      },
      baggage: { hasCheckedBag: true },
      evidence: { mustCollect: true },
      carousel: { name: '7A', provider: 'CIRIUM' }
    },
    readiness: {
      documents: { required: false },
      transport: { continuityComplete: true },
      lodging: { required: false },
      budget: { configured: true, remainingAmount: 1000 },
      localCash: { required: false },
      airportConnections: { required: false },
      weather: { checked: true, severeRisk: false },
      offline: { packageReady: true },
      emergency: { configured: true }
    }
  });

  assert.equal(result.baggage.decision, 'COLLECT_REQUIRED');
  assert.equal(result.baggage.carousel.name, '7A');
  assert.ok(result.alerts.some((alert) => alert.type === 'COLLECT_BAG'));
  assert.equal(result.mutationPolicy.automaticMutationAllowed, false);
});

test('service router prefers eligible CrewCheck shared currency service', () => {
  const result = buildJourneyCommandCenter({
    now: '2026-09-06T20:00:00Z',
    budget: {
      budget: {
        homeCurrency: 'BRL',
        destinationCurrency: 'EUR',
        totalBudget: 10000,
        cardBudget: 8000,
        cashBudget: 2000,
        localCashOnHand: 200,
        emergencyCashTargetLocal: 100,
        fx: { from: 'EUR', to: 'BRL', rate: 6 }
      }
    },
    services: [{
      id: 'crewcheck-awesomeapi',
      name: 'CrewCheck AwesomeAPI Shared',
      provider: 'AwesomeAPI',
      origin: 'CREWCHECK',
      status: 'ACTIVE',
      sharedWithVoyage: true,
      allowsVoyageUse: true,
      capabilities: ['CURRENCY'],
      endpointVersion: 'v1',
      dataIsolation: 'PRODUCT_SCOPED',
      observedAt: '2026-09-06T19:55:00Z'
    }],
    readiness: {
      documents: { required: false },
      transport: { continuityComplete: true },
      lodging: { required: false },
      baggage: { checkedBag: false },
      airportConnections: { required: false },
      weather: { checked: true, severeRisk: false },
      offline: { packageReady: true },
      emergency: { configured: true }
    }
  });

  assert.equal(result.services.resolved[0].route, 'SHARED_CREWCHECK_SERVICE');
  assert.equal(result.services.resolved[0].service.provider, 'AwesomeAPI');
});

test('proposed itinerary change remains proposal-only until user approval', () => {
  const proposalOnly = buildJourneyCommandCenter({
    proposedChanges: [{ id: 'move-tour', type: 'MOVE_ACTIVITY', reason: 'WEATHER', before: '10:00', after: '15:00' }],
    readiness: {
      documents: { required: false },
      transport: { continuityComplete: true },
      lodging: { required: false },
      budget: { configured: true, remainingAmount: 1000 },
      localCash: { required: false },
      baggage: { checkedBag: false },
      airportConnections: { required: false },
      weather: { checked: true, severeRisk: false },
      offline: { packageReady: true },
      emergency: { configured: true }
    }
  });

  assert.equal(proposalOnly.proposal.state, 'AWAITING_USER_APPROVAL');
  assert.equal(proposalOnly.proposal.canApply, false);
  assert.equal(proposalOnly.mutationPolicy.executionState, 'PROPOSAL_ONLY');

  // A userApproval flag travelling in the same request that proposes the change
  // must NOT approve it. Approval is a separate authenticated request against a
  // server-issued proposalId and version (src/proposals.mjs).
  const selfApproved = buildJourneyCommandCenter({
    proposedChanges: [{ id: 'move-tour', type: 'MOVE_ACTIVITY', before: '10:00', after: '15:00' }],
    userApproval: true,
    readiness: {
      documents: { required: false },
      transport: { continuityComplete: true },
      lodging: { required: false },
      budget: { configured: true, remainingAmount: 1000 },
      localCash: { required: false },
      baggage: { checkedBag: false },
      airportConnections: { required: false },
      weather: { checked: true, severeRisk: false },
      offline: { packageReady: true },
      emergency: { configured: true }
    }
  });

  assert.equal(selfApproved.proposal.state, 'AWAITING_USER_APPROVAL');
  assert.equal(selfApproved.proposal.canApply, false);
  assert.equal(selfApproved.proposal.approvalRoute, 'POST /api/v1/proposals/:id/approve');
  assert.equal(selfApproved.mutationPolicy.executionState, 'PROPOSAL_ONLY');
});
