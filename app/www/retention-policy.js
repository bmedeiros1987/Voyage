/**
 * Local document retention policy for the importer's IndexedDB queue.
 *
 * A raw PDF is transient input. It lives locally only long enough to be parsed
 * and synced; after that the structured facts and provenance are what the
 * product keeps. Two clocks apply, because a document that never reached the
 * backend has no syncedAt to measure from:
 *
 *   synced   -> measured from syncedAt
 *   local    -> measured from createdAt, so an import that stays LOCAL_QUEUED
 *               (offline device, backend refusing) still expires instead of
 *               sitting on the device forever.
 *
 * Kept pure and DOM-free so every branch is testable without IndexedDB.
 */
export const RAW_BLOB_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Decides what to do with one stored record's raw bytes.
 * Returns { holdsRawBytes, scope, reference, expired } — never mutates.
 */
export function rawBlobRetention(record, now = Date.now()) {
  const holdsRawBytes = Boolean(record && record.blob);
  if (!holdsRawBytes) {
    // Manual JSON entries never carry a blob, so they are out of scope here.
    return Object.freeze({ holdsRawBytes: false, scope: 'NOT_RAW_DOCUMENT', reference: null, expired: false });
  }

  const synced = Boolean(record.syncedAt) && record.status !== 'LOCAL_QUEUED';
  const scope = synced ? 'SYNCED' : 'LOCAL';
  const reference = Date.parse(synced ? record.syncedAt : record.createdAt);

  if (!Number.isFinite(reference)) {
    // An unreadable timestamp must never justify deleting a user's document.
    return Object.freeze({ holdsRawBytes: true, scope, reference: null, expired: false });
  }

  const elapsed = Number(now) - reference;
  const expired = Number.isFinite(elapsed) && elapsed > RAW_BLOB_TTL_MS;
  return Object.freeze({ holdsRawBytes: true, scope, reference, expired });
}

/**
 * The record as it must be stored once its raw bytes expire: the bytes and the
 * raw extracted text go, the structured facts, provenance and review reasons
 * stay. The state distinguishes a document that synced from one that never did.
 */
export function purgedRecord(record, purgedAt = new Date().toISOString()) {
  const { scope } = rawBlobRetention(record, Date.parse(purgedAt) || Date.now());
  return {
    ...record,
    blob: null,
    textPreview: '',
    retentionState: scope === 'SYNCED' ? 'BLOB_PURGED' : 'LOCAL_BLOB_EXPIRED',
    rawBlobPurgedAt: purgedAt
  };
}
