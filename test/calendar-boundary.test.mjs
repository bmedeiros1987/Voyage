import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVacationBridge, calendarBoundaryCapabilities, projectAuthorizedWindow } from '../src/calendar-boundary.mjs';

const CREW = { memberships: { CREWCHECK: { state: 'ACTIVE' } } };
const VISITOR = { memberships: { CREWCHECK: { state: 'VISITOR' } } };
const WINDOW = { vacationStart: '2027-05-10T00:00:00Z', vacationEnd: '2027-05-25T00:00:00Z', label: 'Férias' };
const CONSENTED = { CREWCHECK_VOYAGE_CONNECTION: true };

test('the operational roster stays owned by CrewCheck', () => {
  const caps = calendarBoundaryCapabilities();
  for (const owned of ['DUTY_ROSTER', 'FLIGHT_ASSIGNMENTS', 'LEGALITY_LIMITS']) {
    assert.ok(caps.crewCheckOwned.includes(owned));
    assert.equal(caps.voyageOwned.includes(owned), false);
  }
});

test('only the vacation-window projection crosses into Voyage', () => {
  const projected = projectAuthorizedWindow({
    ...WINDOW, DUTY_ROSTER: ['AF457'], FLIGHT_ASSIGNMENTS: ['x'], LEGALITY_LIMITS: { max: 100 }
  });
  assert.equal(projected.window.origin, 'CREWCHECK');
  assert.deepEqual(projected.rejectedOperationalFields, ['DUTY_ROSTER', 'FLIGHT_ASSIGNMENTS', 'LEGALITY_LIMITS']);
  assert.deepEqual(Object.keys(projected.window).sort(), ['end', 'label', 'origin', 'start']);
});

test('a non-crew user never sees the bridge and is never asked about it', () => {
  const bridge = buildVacationBridge({ identity: VISITOR, entitlements: ['UNIFIED_CALENDAR'], consents: CONSENTED });
  assert.equal(bridge.available, false);
  assert.equal(bridge.visibleToUser, false);
  assert.equal(bridge.mustNotPromptUser, true);
  assert.equal(bridge.reason, 'NO_ACTIVE_CREWCHECK_MEMBERSHIP');
});

test('the bridge is premium-gated', () => {
  const bridge = buildVacationBridge({ identity: CREW, entitlements: [], consents: CONSENTED, crewCheckWindow: WINDOW });
  assert.equal(bridge.available, false);
  assert.equal(bridge.reason, 'ENTITLEMENT_REQUIRED');
});

test('the integration is opt-in even for an entitled crew member', () => {
  const bridge = buildVacationBridge({
    identity: CREW, entitlements: ['VOYAGE_PREMIUM', 'UNIFIED_CALENDAR'], consents: {}, crewCheckWindow: WINDOW
  });
  assert.equal(bridge.available, false);
  assert.equal(bridge.reason, 'CONNECTION_CONSENT_REQUIRED');
});

test('personal travel is overlaid on the vacation window with explicit origins', () => {
  const bridge = buildVacationBridge({
    identity: CREW,
    entitlements: ['VOYAGE_PREMIUM', 'UNIFIED_CALENDAR'],
    consents: CONSENTED,
    crewCheckWindow: WINDOW,
    personalEvents: [
      { id: 'e1', title: 'Voo pessoal para Roma', start: '2027-05-12T09:00:00Z' },
      { id: 'e2', title: 'Jantar fora da janela', start: '2027-06-30T20:00:00Z' }
    ]
  });
  assert.equal(bridge.available, true);
  assert.equal(bridge.vacationWindow.origin, 'CREWCHECK');
  assert.equal(bridge.overlay.insideWindow.length, 1);
  assert.equal(bridge.overlay.insideWindow[0].origin, 'VOYAGE');
  assert.equal(bridge.overlay.outsideWindow.length, 1);
});

test('the bridge never duplicates operational features and stays approval-gated', () => {
  const bridge = buildVacationBridge({
    identity: CREW, entitlements: ['UNIFIED_CALENDAR'], consents: CONSENTED, crewCheckWindow: WINDOW
  });
  assert.equal(bridge.boundary.rosterRemainsInCrewCheck, true);
  assert.equal(bridge.boundary.voyageDuplicatesOperationalFeatures, false);
  assert.equal(bridge.boundary.itineraryMutationRequiresApproval, true);
});
