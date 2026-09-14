import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGmailCandidate, detectReservationEventState } from '../src/gmail-travel.mjs';

test('cancellation request does not prematurely cancel the reservation', () => {
  const text = 'Booking.com: We have received your request to cancel reservation 123456789. A charge may apply.';
  assert.equal(detectReservationEventState(text), 'CANCELLATION_REQUESTED');
  const candidate = classifyGmailCandidate({
    from: 'Booking.com <noreply@booking.com>',
    subject: 'Your cancellation request (123456789)',
    bodyPreview: text
  });
  assert.equal(candidate.eventState, 'CANCELLATION_REQUESTED');
  assert.equal(candidate.mutationIntent, 'MARK_CANCELLATION_PENDING');
});

test('confirmed cancellation still cancels the matched reservation', () => {
  const candidate = classifyGmailCandidate({
    from: 'Booking.com <noreply@booking.com>',
    subject: 'Your reservation has been cancelled',
    bodyPreview: 'Booking cancelled. Cancelamento confirmado.'
  });
  assert.equal(candidate.eventState, 'CANCELLED');
  assert.equal(candidate.mutationIntent, 'CANCEL_MATCHED_RESERVATION');
});
