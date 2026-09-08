import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { RAW_BLOB_TTL_MS, purgedRecord, rawBlobRetention } from '../app/www/retention-policy.js';

const NOW = Date.UTC(2026, 8, 8, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return new Date(NOW - days * DAY).toISOString();
}

function queuedPdf(overrides = {}) {
  return {
    id: 'rec-1',
    sha256: 'a'.repeat(64),
    name: 'boarding-pass.pdf',
    type: 'application/pdf',
    size: 1024,
    status: 'LOCAL_QUEUED',
    createdAt: daysAgo(1),
    blob: { size: 1024 },
    sourceMode: 'MANUAL_PDF',
    textPreview: 'PASSENGER NAME ...',
    extractedFacts: { flightNumber: '1234' },
    reviewReasons: ['MANUAL_CONFIRMATION_REQUIRED'],
    ...overrides
  };
}

function manualEntry(overrides = {}) {
  return {
    id: 'rec-manual',
    sha256: null,
    name: 'Jantar em Roma',
    type: 'application/vnd.voyage.manual+json',
    size: 0,
    status: 'LOCAL_MANUAL_QUEUED',
    createdAt: daysAgo(400),
    sourceMode: 'MANUAL_ENTRY',
    manualPayload: { title: 'Jantar em Roma', category: 'RESTAURANT' },
    userConfirmed: true,
    ...overrides
  };
}

test('a never-synced PDF older than the TTL expires on createdAt', () => {
  const decision = rawBlobRetention(queuedPdf({ createdAt: daysAgo(31) }), NOW);
  assert.equal(decision.scope, 'LOCAL');
  assert.equal(decision.expired, true);
});

test('a never-synced PDF inside the TTL is preserved', () => {
  for (const age of [0, 1, 29, 30]) {
    const decision = rawBlobRetention(queuedPdf({ createdAt: daysAgo(age) }), NOW);
    assert.equal(decision.expired, false, `${age} days old must be kept`);
  }
});

test('a manual JSON entry is never treated as a raw document, however old', () => {
  const decision = rawBlobRetention(manualEntry(), NOW);
  assert.equal(decision.holdsRawBytes, false);
  assert.equal(decision.scope, 'NOT_RAW_DOCUMENT');
  assert.equal(decision.expired, false);
});

test('a synced record still follows the synced clock, not createdAt', () => {
  const longAgoCreatedButFreshlySynced = queuedPdf({
    status: 'PARSED',
    createdAt: daysAgo(400),
    syncedAt: daysAgo(2)
  });
  assert.equal(rawBlobRetention(longAgoCreatedButFreshlySynced, NOW).scope, 'SYNCED');
  assert.equal(rawBlobRetention(longAgoCreatedButFreshlySynced, NOW).expired, false);

  const staleSynced = queuedPdf({ status: 'PARSED', createdAt: daysAgo(400), syncedAt: daysAgo(31) });
  assert.equal(rawBlobRetention(staleSynced, NOW).expired, true);
});

test('a syncedAt left on a still-queued record does not count as synced', () => {
  const decision = rawBlobRetention(
    queuedPdf({ status: 'LOCAL_QUEUED', syncedAt: daysAgo(1), createdAt: daysAgo(31) }),
    NOW
  );
  assert.equal(decision.scope, 'LOCAL', 'status decides, so a stray syncedAt cannot extend local retention');
  assert.equal(decision.expired, true);
});

test('an unreadable timestamp never justifies deleting a document', () => {
  for (const createdAt of ['', 'not-a-date', null, undefined]) {
    assert.equal(rawBlobRetention(queuedPdf({ createdAt }), NOW).expired, false, `${createdAt} must not purge`);
  }
  assert.equal(
    rawBlobRetention(queuedPdf({ status: 'PARSED', syncedAt: 'nonsense', createdAt: daysAgo(400) }), NOW).expired,
    false
  );
});

test('purging drops the bytes and the raw text but keeps the structured record', () => {
  const record = queuedPdf({ createdAt: daysAgo(31) });
  const purged = purgedRecord(record, new Date(NOW).toISOString());

  assert.equal(purged.blob, null);
  assert.equal(purged.textPreview, '');
  assert.equal(purged.retentionState, 'LOCAL_BLOB_EXPIRED');
  assert.equal(purged.rawBlobPurgedAt, new Date(NOW).toISOString());

  assert.equal(purged.id, record.id);
  assert.equal(purged.name, record.name);
  assert.equal(purged.sha256, record.sha256);
  assert.deepEqual(purged.extractedFacts, record.extractedFacts);
  assert.deepEqual(purged.reviewReasons, record.reviewReasons);
});

test('a synced purge keeps its own state, distinct from a local expiry', () => {
  const purged = purgedRecord(queuedPdf({ status: 'PARSED', syncedAt: daysAgo(31) }), new Date(NOW).toISOString());
  assert.equal(purged.retentionState, 'BLOB_PURGED');
});

test('purging is idempotent: a purged record no longer holds raw bytes', () => {
  const purged = purgedRecord(queuedPdf({ createdAt: daysAgo(31) }), new Date(NOW).toISOString());
  const second = rawBlobRetention(purged, NOW);
  assert.equal(second.holdsRawBytes, false);
  assert.equal(second.expired, false);
});

test('the TTL is the conservative 30 days the policy documents', () => {
  assert.equal(RAW_BLOB_TTL_MS, 30 * DAY);
});

test('the importer runs the purge at boot, when imports open and when back online', async () => {
  const source = await readFile(new URL('../app/www/import-enhancements.js', import.meta.url), 'utf8');
  assert.match(source, /voyage:imports-open'[\s\S]{0,80}purgeExpiredRawBlobs\(\)/, 'opening imports must purge first');
  assert.match(source, /'online'[\s\S]{0,80}purgeExpiredRawBlobs\(\)/, 'coming back online must purge first');
  assert.match(source, /await purgeExpiredRawBlobs\(\);/, 'bootstrap must purge');
  assert.doesNotMatch(source, /SYNCED_RAW_BLOB_TTL_MS/, 'the local TTL now lives in the shared policy');
});

test('the normative policy documents the local IndexedDB queue, not only synced storage', async () => {
  const doc = await readFile(new URL('../docs/DOCUMENT_RETENTION_SECURITY.md', import.meta.url), 'utf8');
  assert.match(doc, /IndexedDB/, 'the policy must name the store where raw bytes actually persist');
  assert.match(doc, /LOCAL_QUEUED/, 'the policy must cover the never-synced case');
  assert.match(doc, /30 days/, 'the policy must state the local TTL');
});
