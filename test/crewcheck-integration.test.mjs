import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crewCheckIntegrationCapabilities,
  buildCrewCheckVoyageContext,
  buildCrewCheckBridgePreview
} from '../src/crewcheck-integration.mjs';

test('CrewCheck Explorer concept is replaced by Voyage integrated surface', () => {
  const capabilities = crewCheckIntegrationCapabilities();
  assert.equal(capabilities.surfaceName, 'Voyage integrado');
  assert.equal(capabilities.legacyConceptReplaced, 'CREWCHECK_EXPLORER');
  assert.equal(capabilities.approval.requiredBeforeSharingRosterContext, true);
  assert.equal(capabilities.approval.automaticItineraryMutationAllowed, false);
});

test('roster context is not transferred before explicit user approval', () => {
  const result = buildCrewCheckVoyageContext({
    profile: { baseAirport: 'BSB' },
    roster: { year: 2026, month: 9, days: [{ date: '2026-09-10', type: 'FOLGA' }] }
  });
  assert.equal(result.status, 'AWAITING_USER_APPROVAL');
  assert.equal(result.roster, null);
  assert.equal(result.availability, null);
  assert.equal(result.approval.crewCheckContextShareApproved, false);
});

test('approved CrewCheck context only treats explicit off days as free', () => {
  const result = buildCrewCheckVoyageContext({
    userApprovedShare: true,
    profile: { baseAirport: 'BSB', timeZone: 'America/Sao_Paulo', locale: 'pt-BR' },
    roster: {
      year: 2026,
      month: 9,
      days: [
        { date: '2026-09-10', type: 'FOLGA' },
        { date: '2026-09-11', type: 'FLIGHT', startsAt: '2026-09-11T12:00:00-03:00', endsAt: '2026-09-11T18:00:00-03:00', origin: 'BSB', destination: 'GRU' },
        { date: '2026-09-12', type: 'REPOUSO' }
      ]
    }
  });
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.availability.explicitFreeDates, ['2026-09-10']);
  assert.deepEqual(result.availability.hardUnavailableDates, ['2026-09-11']);
  assert.deepEqual(result.availability.unknownDates, ['2026-09-12']);
  assert.equal(result.planningContext.policies.protectRequiredRestAndUnknownDays, true);
});

test('CrewCheck work flights are constraints and not silently converted into personal itinerary', () => {
  const result = buildCrewCheckVoyageContext({
    userApprovedShare: true,
    roster: {
      period: '2026-09',
      days: [{
        date: '2026-09-15',
        type: 'FLIGHT',
        legs: [{ flightNumber: 'LA3000', origin: 'BSB', destination: 'CGH', departureAt: '2026-09-15T10:00:00-03:00', arrivalAt: '2026-09-15T11:45:00-03:00' }]
      }]
    }
  });
  assert.equal(result.roster.workAnchors.length, 1);
  assert.equal(result.roster.workAnchors[0].flightNumber, 'LA3000');
  assert.equal(result.planningContext.policies.crewFlightsBecomePersonalTripItemsAutomatically, false);
  assert.equal(result.approval.itineraryMutationApproved, false);
});

test('bridge preview exposes Voyage integrated entry without allowing automatic mutation', () => {
  const preview = buildCrewCheckBridgePreview({ userApprovedShare: true, roster: { period: '2026-09', days: [] } });
  assert.equal(preview.surface, 'VOYAGE_INTEGRATED');
  assert.equal(preview.legacySurface, 'CREWCHECK_EXPLORER');
  assert.equal(preview.entry.badge, 'Integrado ao CrewCheck');
  assert.equal(preview.mutationPolicy.automaticApplyAllowed, false);
});
