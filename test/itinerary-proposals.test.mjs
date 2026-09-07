import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryPersistence } from '../src/persistence.mjs';
import { approveItineraryProposal, createItineraryProposal, getItineraryProposal } from '../src/itinerary-proposals.mjs';

const actor = Object.freeze({ userId: 'user-1', permissions: [] });

test('proposal creation never applies itinerary changes in the same call', async () => {
  const persistence = createMemoryPersistence();
  const proposal = await createItineraryProposal({
    actor,
    tripId: 'trip-1',
    baseVersion: 7,
    changes: [{ operation: 'UPDATE', entityId: 'stop-1', payload: { startsAt: '2027-05-12T10:00:00Z' } }]
  }, { persistence, now: () => 1_800_000_000_000 });

  assert.equal(proposal.status, 'PENDING');
  assert.equal(proposal.version, 1);
  assert.equal(proposal.approvalRequired, true);
  assert.equal(Object.hasOwn(proposal, 'applyCommand'), false);
});

test('approval requires a separate call with exact server proposal version', async () => {
  const persistence = createMemoryPersistence();
  const proposal = await createItineraryProposal({
    actor,
    tripId: 'trip-1',
    baseVersion: 3,
    changes: [{ operation: 'MOVE', entityId: 'stop-2', payload: { afterEntityId: 'stop-1' } }]
  }, { persistence, now: () => 1_800_000_000_000 });

  await assert.rejects(() => approveItineraryProposal({ actor, proposalId: proposal.proposalId, version: 2 }, { persistence, now: () => 1_800_000_010_000 }), /proposal_version_conflict/);

  const approval = await approveItineraryProposal({ actor, proposalId: proposal.proposalId, version: 1 }, { persistence, now: () => 1_800_000_010_000 });
  assert.equal(approval.proposal.status, 'APPROVED');
  assert.equal(approval.applyCommand.proposalId, proposal.proposalId);
  assert.equal(approval.applyCommand.expectedTripVersion, 3);
  assert.equal(approval.applyCommand.proposalVersion, 1);
});

test('unrelated user cannot read or approve a proposal', async () => {
  const persistence = createMemoryPersistence();
  const proposal = await createItineraryProposal({
    actor,
    tripId: 'trip-1',
    baseVersion: 0,
    changes: [{ operation: 'ADD', entityId: 'stop-3', payload: { title: 'Museu' } }]
  }, { persistence, now: () => 1_800_000_000_000 });
  const stranger = { userId: 'user-2', permissions: [] };

  await assert.rejects(() => getItineraryProposal({ actor: stranger, proposalId: proposal.proposalId }, { persistence }), /proposal_read_forbidden/);
  await assert.rejects(() => approveItineraryProposal({ actor: stranger, proposalId: proposal.proposalId, version: 1 }, { persistence, now: () => 1_800_000_010_000 }), /proposal_approval_forbidden/);
});

test('expired proposals cannot be approved', async () => {
  const persistence = createMemoryPersistence();
  const proposal = await createItineraryProposal({
    actor,
    tripId: 'trip-1',
    baseVersion: 1,
    ttlMs: 60_000,
    changes: [{ operation: 'REMOVE', entityId: 'stop-4', payload: null }]
  }, { persistence, now: () => 1_800_000_000_000 });

  await assert.rejects(() => approveItineraryProposal({ actor, proposalId: proposal.proposalId, version: 1 }, { persistence, now: () => 1_800_000_061_000 }), /proposal_expired/);
  const stored = await persistence.getProposal(proposal.proposalId);
  assert.equal(stored.status, 'EXPIRED');
});
