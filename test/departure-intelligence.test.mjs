import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDepartureDecision,
  buildDepartureWatchContract,
  buildTrafficChangeAlert,
  departureIntelligenceCapabilities
} from '../src/departure-intelligence.mjs';

test('departure intelligence calculates a recommended leave time for timed commitments', () => {
  const result = buildDepartureDecision({
    now: '2027-05-18T12:00:00Z',
    commitment: { id: 'meeting', title: 'Reunião', startsAt: '2027-05-18T13:00:00Z', locationId: 'office' },
    route: { currentTravelMinutes: 25, baselineTravelMinutes: 20, updatedAt: '2027-05-18T11:58:00Z', provider: 'synthetic' },
    buffers: { arrivalBufferMinutes: 10, contingencyMinutes: 10 }
  });
  assert.equal(result.recommendedLeaveAt, '2027-05-18T12:15:00.000Z');
  assert.equal(result.latestSafeLeaveAt, '2027-05-18T12:25:00.000Z');
  assert.equal(result.status, 'WATCHING');
});

test('leave soon escalates when departure window approaches', () => {
  const result = buildDepartureDecision({
    now: '2027-05-18T12:08:00Z',
    commitment: { title: 'Jantar', startsAt: '2027-05-18T13:00:00Z', locationId: 'restaurant' },
    route: { currentTravelMinutes: 32, baselineTravelMinutes: 25, updatedAt: '2027-05-18T12:07:00Z' },
    buffers: { arrivalBufferMinutes: 10, contingencyMinutes: 5, leaveSoonWindowMinutes: 15 }
  });
  assert.equal(result.status, 'LEAVE_SOON');
  assert.equal(result.traffic.state, 'TIGHTER');
  assert.match(result.notification.message, /trânsito apertou/i);
});

test('traffic increase is material when delay crosses absolute or relative threshold', () => {
  const alert = buildTrafficChangeAlert({ previousTravelMinutes: 20, currentTravelMinutes: 27 });
  assert.equal(alert.material, true);
  assert.equal(alert.direction, 'WORSE');
  assert.equal(alert.deltaMinutes, 7);
});

test('at risk is raised when the latest safe leave time has passed', () => {
  const result = buildDepartureDecision({
    now: '2027-05-18T12:31:00Z',
    commitment: { title: 'Evento', startsAt: '2027-05-18T13:00:00Z', locationId: 'venue' },
    route: { currentTravelMinutes: 20, updatedAt: '2027-05-18T12:30:00Z' },
    buffers: { arrivalBufferMinutes: 10, contingencyMinutes: 5 }
  });
  assert.equal(result.status, 'AT_RISK');
  assert.equal(result.notification.priority, 'CRITICAL');
});

test('departure watch never authorizes itinerary mutation', () => {
  const contract = buildDepartureWatchContract({
    commitment: { id: 'client-meeting', startsAt: '2027-05-18T13:00:00Z', locationId: 'office' }
  });
  assert.equal(contract.enabled, true);
  assert.equal(contract.itineraryMutationAllowed, false);
  assert.equal(contract.userApprovalRequiredForItineraryChanges, true);
});

test('capabilities expose progressive traffic-aware alerts', () => {
  const capabilities = departureIntelligenceCapabilities();
  assert.ok(capabilities.escalation.includes('LEAVE_NOW'));
  assert.ok(capabilities.principles.some((item) => /traffic/i.test(item)));
});
