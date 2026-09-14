import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lodgingIntelligenceCapabilities,
  resolveLodgingPlan
} from '../src/lodging-intelligence.mjs';

test('capabilities treat private-host stays as first-class lodging without auto-discovering private homes', () => {
  const capabilities = lodgingIntelligenceCapabilities();
  assert.ok(capabilities.privateHostTypes.includes('FRIEND_HOME'));
  assert.ok(capabilities.privateHostTypes.includes('RELATIVE_HOME'));
  assert.ok(capabilities.policies.some((item) => item.includes('never infers private homes')));
});

test('confirmed reservation remains lodging base when user has not selected a private host', () => {
  const result = resolveLodgingPlan({
    trip: { startDate: '2027-05-01', endDate: '2027-05-03', destinationId: 'CITY_A' },
    reservations: [
      { id: 'hotel-a', type: 'HOTEL', startDate: '2027-05-01', endDate: '2027-05-03', destinationId: 'CITY_A', locationId: 'HOTEL_LOC', confirmed: true }
    ],
    hostStays: [
      { id: 'friend-a', type: 'FRIEND_HOME', destinationId: 'CITY_A', locationId: 'FRIEND_LOC', confirmed: true, userProvided: true }
    ]
  });
  assert.equal(result.status, 'READY');
  assert.ok(result.nights.every((night) => night.lodgingId === 'hotel-a'));
});

test('explicit user choice to stay with a friend overrides paid lodging for planning base', () => {
  const result = resolveLodgingPlan({
    trip: { startDate: '2027-05-01', endDate: '2027-05-02', destinationId: 'CITY_A' },
    reservations: [
      { id: 'hotel-a', type: 'HOTEL', startDate: '2027-05-01', endDate: '2027-05-02', destinationId: 'CITY_A', locationId: 'HOTEL_LOC', confirmed: true }
    ],
    hostStays: [
      { id: 'friend-a', type: 'FRIEND_HOME', destinationId: 'CITY_A', locationId: 'FRIEND_LOC', confirmed: true, userProvided: true }
    ],
    userChoice: { hostStayId: 'friend-a' }
  });
  assert.equal(result.nights[0].lodgingType, 'FRIEND_HOME');
  assert.equal(result.nights[0].locationId, 'FRIEND_LOC');
  assert.equal(result.nights[0].reason, 'USER_SELECTED_HOST');
});

test('when no reservation exists a confirmed relative stay becomes a valid lodging fallback', () => {
  const result = resolveLodgingPlan({
    trip: { startDate: '2027-06-10', endDate: '2027-06-12', destinationId: 'CITY_B' },
    hostStays: [
      { id: 'relative-b', type: 'RELATIVE_HOME', destinationId: 'CITY_B', locationId: 'RELATIVE_LOC', confirmed: true, userProvided: true }
    ]
  });
  assert.equal(result.status, 'READY');
  assert.ok(result.nights.every((night) => night.lodgingType === 'RELATIVE_HOME'));
  assert.ok(result.baseLocations.every((base) => base.locationId === 'RELATIVE_LOC'));
});

test('unconfirmed friend stay is proposed but requires host confirmation', () => {
  const result = resolveLodgingPlan({
    trip: { startDate: '2027-07-01', endDate: '2027-07-02', destinationId: 'CITY_C' },
    hostStays: [
      { id: 'friend-c', type: 'FRIEND_HOME', destinationId: 'CITY_C', locationId: 'FRIEND_LOC_C', confirmed: false, userProvided: true }
    ]
  });
  assert.equal(result.status, 'NEEDS_HOST_CONFIRMATION');
  assert.equal(result.nights[0].status, 'PENDING_CONFIRMATION');
  assert.ok(result.questions.some((question) => question.id === 'CONFIRM_HOST_STAY:2027-07-01'));
});

test('when neither reservation nor host is known planner asks about friends or relatives instead of assuming a hotel', () => {
  const result = resolveLodgingPlan({
    trip: { startDate: '2027-08-20', endDate: '2027-08-21', destinationId: 'CITY_D' }
  });
  assert.equal(result.status, 'NEEDS_LODGING');
  assert.equal(result.nights[0].status, 'UNRESOLVED');
  assert.ok(result.questions.some((question) => question.id === 'ASK_FRIENDS_OR_FAMILY:2027-08-20'));
  assert.ok(result.researchNeeds.includes('LODGING:2027-08-20'));
});

test('private-home breakfast is unknown unless explicitly provided', () => {
  const unknown = resolveLodgingPlan({
    trip: { startDate: '2027-09-01', endDate: '2027-09-02', destinationId: 'CITY_E' },
    hostStays: [
      { id: 'friend-e', type: 'FRIEND_HOME', destinationId: 'CITY_E', locationId: 'FRIEND_LOC_E', confirmed: true, userProvided: true }
    ]
  });
  assert.equal(unknown.nights[0].breakfastKnown, false);
  assert.equal(unknown.nights[0].breakfastIncluded, null);

  const explicit = resolveLodgingPlan({
    trip: { startDate: '2027-09-01', endDate: '2027-09-02', destinationId: 'CITY_E' },
    hostStays: [
      { id: 'relative-e', type: 'RELATIVE_HOME', destinationId: 'CITY_E', locationId: 'RELATIVE_LOC_E', confirmed: true, userProvided: true, breakfastAvailable: true }
    ]
  });
  assert.equal(explicit.nights[0].breakfastKnown, true);
  assert.equal(explicit.nights[0].breakfastIncluded, true);
});
