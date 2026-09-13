import { randomUUID } from 'node:crypto';

const KINDS = new Set(['FACT', 'PREFERENCE', 'INFERENCE', 'CORRECTION']);
const CORRECTIONS = new Set(['VALUE', 'CONFIRM_INFERENCE', 'REJECT_INFERENCE']);
const MAX_ID = 160;

export function createPersonalContextGraph({ now = Date.now } = {}) {
  const entries = new Map();

  function add(input) {
    const entry = normalizeEntry(input, now);
    if (entries.has(entry.id)) throw problem('context_entry_id_conflict', 409);
    entries.set(entry.id, entry);
    return structuredClone(entry);
  }

  function targetFor(userId, targetEntryId) {
    requireText(userId, 'context_user_id_required');
    requireText(targetEntryId, 'context_target_id_required');
    const target = entries.get(targetEntryId);
    if (!target || target.userId !== userId) throw problem('context_target_not_found', 404);
    return target;
  }

  return Object.freeze({
    add,
    correct({ userId, targetEntryId, value, sourceRef = 'user', observedAt } = {}) {
      const target = targetFor(userId, targetEntryId);
      if (target.kind === 'CORRECTION') throw problem('context_correction_target_invalid');
      return add({
        kind: 'CORRECTION', userId, key: target.key, value, sourceRef,
        observedAt: observedAt ?? new Date(Number(now())).toISOString(),
        consentKey: target.consentKey, targetEntryId, correctionType: 'VALUE'
      });
    },
    confirmInference({ userId, inferenceId, accepted, sourceRef = 'user', observedAt } = {}) {
      const target = targetFor(userId, inferenceId);
      if (target.kind !== 'INFERENCE') throw problem('context_inference_target_required');
      if (typeof accepted !== 'boolean') throw problem('context_inference_confirmation_required');
      return add({
        kind: 'CORRECTION', userId, key: target.key, value: target.value, sourceRef,
        observedAt: observedAt ?? new Date(Number(now())).toISOString(),
        consentKey: target.consentKey, targetEntryId: inferenceId,
        correctionType: accepted ? 'CONFIRM_INFERENCE' : 'REJECT_INFERENCE'
      });
    },
    history({ userId } = {}) {
      requireText(userId, 'context_user_id_required');
      return [...entries.values()]
        .filter((entry) => entry.userId === userId)
        .map((entry) => structuredClone(entry));
    },
    snapshot({ userId, authorizedConsents = [], at = now() } = {}) {
      requireText(userId, 'context_user_id_required');
      const atMs = asClock(at);
      if (!Array.isArray(authorizedConsents)) throw problem('context_consents_invalid');
      const consents = new Set(authorizedConsents.map((value) => requireText(String(value), 'context_consent_key_invalid')));
      const own = [...entries.values()].filter((entry) => entry.userId === userId);
      const corrections = new Map();
      for (const entry of own.filter((entry) => entry.kind === 'CORRECTION')) {
        const list = corrections.get(entry.targetEntryId) || [];
        list.push(entry);
        corrections.set(entry.targetEntryId, list);
      }
      const items = [];
      let redactedByConsent = 0;
      let rejectedInferences = 0;
      for (const entry of own.filter((entry) => entry.kind !== 'CORRECTION')) {
        if (entry.consentKey && !consents.has(entry.consentKey)) {
          redactedByConsent += 1;
          continue;
        }
        const materialized = applyCorrections(entry, corrections.get(entry.id) || [], atMs);
        if (materialized.inferenceStatus === 'REJECTED') {
          rejectedInferences += 1;
          continue;
        }
        items.push(materialized);
      }
      return Object.freeze({
        userId,
        generatedAt: new Date(atMs).toISOString(),
        items: Object.freeze(items),
        redactedByConsent,
        rejectedInferences
      });
    }
  });
}

export function freshnessState(entry, at = Date.now()) {
  const atMs = asClock(at);
  const observed = parseTime(entry?.observedAt, 'context_observed_at_invalid');
  if (entry?.validUntil && parseTime(entry.validUntil, 'context_valid_until_invalid') <= atMs) return 'EXPIRED';
  if (entry?.staleAfterMs != null) {
    const ttl = Number(entry.staleAfterMs);
    if (!Number.isFinite(ttl) || ttl <= 0) return 'INVALID';
    return atMs - observed > ttl ? 'STALE' : 'FRESH';
  }
  return entry?.validUntil ? 'FRESH' : 'UNKNOWN';
}

function normalizeEntry(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem('context_entry_required');
  const kind = String(input.kind || '').trim().toUpperCase();
  if (!KINDS.has(kind)) throw problem('context_entry_kind_invalid');
  const nowMs = asClock(now());
  const observedAt = normalizeTime(input.observedAt ?? new Date(nowMs).toISOString(), 'context_observed_at_invalid');
  if (Date.parse(observedAt) > nowMs + 60_000) throw problem('context_observed_at_future');
  const validUntil = input.validUntil == null ? null : normalizeTime(input.validUntil, 'context_valid_until_invalid');
  if (validUntil && Date.parse(validUntil) <= Date.parse(observedAt)) throw problem('context_valid_until_invalid');
  const confidence = input.confidence == null ? null : Number(input.confidence);
  if (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw problem('context_confidence_invalid');
  if (kind === 'INFERENCE' && confidence == null) throw problem('context_inference_confidence_required');
  const staleAfterMs = input.staleAfterMs == null ? null : Number(input.staleAfterMs);
  if (staleAfterMs != null && (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0)) throw problem('context_stale_after_invalid');
  let targetEntryId = null;
  let correctionType = null;
  if (kind === 'CORRECTION') {
    targetEntryId = requireText(input.targetEntryId, 'context_correction_target_required');
    correctionType = String(input.correctionType || '').trim().toUpperCase();
    if (!CORRECTIONS.has(correctionType)) throw problem('context_correction_type_invalid');
  }
  return Object.freeze({
    id: input.id ? requireText(input.id, 'context_entry_id_invalid') : randomUUID(),
    userId: requireText(input.userId, 'context_user_id_required'),
    kind,
    key: requireText(input.key, 'context_key_required'),
    value: jsonClone(input.value),
    sourceRef: requireText(input.sourceRef, 'context_source_ref_required'),
    observedAt,
    validUntil,
    staleAfterMs,
    confidence,
    consentKey: input.consentKey == null ? null : requireText(input.consentKey, 'context_consent_key_invalid'),
    targetEntryId,
    correctionType,
    createdAt: new Date(nowMs).toISOString()
  });
}

function applyCorrections(original, corrections, atMs) {
  let value = jsonClone(original.value);
  let sourceRef = original.sourceRef;
  let observedAt = original.observedAt;
  let inferenceStatus = original.kind === 'INFERENCE' ? 'PROPOSED' : null;
  const correctionIds = [];
  for (const correction of corrections) {
    correctionIds.push(correction.id);
    if (correction.correctionType === 'VALUE') {
      value = jsonClone(correction.value);
      sourceRef = correction.sourceRef;
      observedAt = correction.observedAt;
    }
    if (correction.correctionType === 'CONFIRM_INFERENCE') inferenceStatus = 'CONFIRMED';
    if (correction.correctionType === 'REJECT_INFERENCE') inferenceStatus = 'REJECTED';
  }
  return Object.freeze({
    ...original,
    value,
    sourceRef,
    observedAt,
    inferenceStatus,
    freshness: freshnessState({ ...original, observedAt }, atMs),
    correctionIds: Object.freeze(correctionIds)
  });
}

function jsonClone(value) {
  if (value === undefined) throw problem('context_value_required');
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('unsupported');
    return JSON.parse(encoded);
  } catch {
    throw problem('context_value_not_json');
  }
}
function normalizeTime(value, code) { return new Date(parseTime(value, code)).toISOString(); }
function parseTime(value, code) { const ms = Date.parse(value); if (!Number.isFinite(ms)) throw problem(code); return ms; }
function asClock(value) { const ms = value instanceof Date ? value.getTime() : Number(value); if (!Number.isFinite(ms)) throw problem('context_clock_invalid'); return ms; }
function requireText(value, code) { if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_ID) throw problem(code); return value.trim(); }
function problem(code, statusCode = 400) { const error = new Error(code); error.code = code; error.statusCode = statusCode; return error; }
