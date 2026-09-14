import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GmailHistoryContinuityError,
  collectGmailHistoryDelta,
  getGmailAttachment,
  normalizeGmailMessage,
  shouldRenewGmailWatch,
  startGmailWatch
} from '../src/google-gmail-client.mjs';

function jsonResponse(payload, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('Gmail history collection deduplicates changed message ids across pages', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('pageToken=next')) return jsonResponse({ historyId: '103', history: [{ labelsAdded: [{ message: { id: 'm2' } }] }, { messagesDeleted: [{ message: { id: 'm1' } }] }] });
    return jsonResponse({ historyId: '102', nextPageToken: 'next', history: [{ messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm2' } }] }] });
  };
  const delta = await collectGmailHistoryDelta('token', '100', { fetchImpl });
  assert.equal(delta.newestHistoryId, '103');
  assert.deepEqual(delta.messageIds, ['m2']);
  assert.deepEqual(delta.deletedMessageIds, ['m1']);
  assert.equal(delta.pages, 2);
  assert.equal(calls.length, 2);
});

test('expired Gmail history cursor fails closed with continuity error', async () => {
  const fetchImpl = async () => jsonResponse({ error: { message: 'HistoryId too old' } }, 404);
  await assert.rejects(
    () => collectGmailHistoryDelta('token', '1', { fetchImpl }),
    (error) => error instanceof GmailHistoryContinuityError && error.code === 'GMAIL_HISTORY_CONTINUITY_LOST'
  );
});

test('Gmail watch returns normalized history id and expiration', async () => {
  const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const fetchImpl = async (url, init) => {
    assert.ok(url.endsWith('/users/me/watch'));
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { topicName: 'projects/voyage/topics/gmail', labelIds: ['INBOX'], labelFilterBehavior: 'include' });
    return jsonResponse({ historyId: '500', expiration: String(expiration) });
  };
  const watch = await startGmailWatch('token', 'projects/voyage/topics/gmail', { fetchImpl });
  assert.equal(watch.historyId, '500');
  assert.equal(new Date(watch.expiration).getTime(), expiration);
  assert.equal(shouldRenewGmailWatch(watch.expiration, { now: expiration - 2 * 24 * 60 * 60 * 1000 }), false);
  assert.equal(shouldRenewGmailWatch(watch.expiration, { now: expiration - 12 * 60 * 60 * 1000 }), true);
});

test('Gmail message normalization discovers PDF attachments and plain-text body', () => {
  const data = Buffer.from('Hotel reservation Confirmation XYZ987 check-in 12/05/2027').toString('base64url');
  const message = normalizeGmailMessage({
    id: 'm1',
    threadId: 't1',
    historyId: '10',
    internalDate: '1780000000000',
    snippet: 'Reservation confirmed',
    payload: {
      headers: [{ name: 'From', value: 'Booking.com <noreply@booking.com>' }, { name: 'Subject', value: 'Hotel confirmado' }],
      parts: [
        { mimeType: 'text/plain', body: { data } },
        { mimeType: 'application/pdf', filename: 'hotel.pdf', body: { attachmentId: 'a1', size: 1234 } }
      ]
    }
  });
  assert.equal(message.id, 'm1');
  assert.equal(message.subject, 'Hotel confirmado');
  assert.ok(message.bodyPreview.includes('XYZ987'));
  assert.deepEqual(message.attachments[0], { filename: 'hotel.pdf', mimeType: 'application/pdf', attachmentId: 'a1', size: 1234 });
});

test('Gmail attachment bytes decode base64url safely', async () => {
  const source = Buffer.from('%PDF-1.4\nhello');
  const fetchImpl = async () => jsonResponse({ size: source.length, data: source.toString('base64url') });
  const result = await getGmailAttachment('token', 'm1', 'a1', { fetchImpl });
  assert.equal(result.size, source.length);
  assert.deepEqual(result.bytes, source);
});
