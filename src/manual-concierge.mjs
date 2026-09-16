import { randomUUID } from 'node:crypto';

const SESSION_STATES = new Set(['STARTED', 'GUIDANCE_RECORDED', 'COMPLETED']);
const GUIDANCE_STATUSES = new Set(['ACTION_RECOMMENDED', 'NO_ACTION_REQUIRED', 'INSUFFICIENT_INFORMATION']);
const FRESHNESS = new Set(['FRESH', 'STALE', 'EXPIRED', 'UNKNOWN']);
const MAX_TEXT = 4000;

export function createManualConciergeRecorder({ now = Date.now, idFactory = randomUUID } = {}) {
  const sessions = new Map();

  function startSession(input = {}) {
    const session = normalizeSession(input, { now, idFactory });
    if (sessions.has(session.sessionId)) throw problem('manual_concierge_session_conflict', 409);
    sessions.set(session.sessionId, session);
    return clone(session);
  }

  function recordGuidance({ sessionId, userId, guidance } = {}) {
    const current = ownedSession(sessions, sessionId, userId);
    if (current.state !== 'STARTED') throw problem('manual_concierge_guidance_state_invalid', 409);
    const normalized = normalizeGuidance(guidance, current);
    const updated = Object.freeze({
      ...current,
      state: 'GUIDANCE_RECORDED',
      guidance: normalized,
      guidanceRecordedAt: clockIso(now)
    });
    sessions.set(sessionId, updated);
    return clone(updated);
  }

  function recordOutcome({ sessionId, userId, outcome } = {}) {
    const current = ownedSession(sessions, sessionId, userId);
    if (current.state !== 'GUIDANCE_RECORDED') throw problem('manual_concierge_outcome_state_invalid', 409);
    const normalized = normalizeOutcome(outcome);
    const updated = Object.freeze({
      ...current,
      state: 'COMPLETED',
      outcome: normalized,
      completedAt: clockIso(now)
    });
    sessions.set(sessionId, updated);
    return clone(updated);
  }

  function getSession({ sessionId, userId } = {}) {
    return clone(ownedSession(sessions, sessionId, userId));
  }

  function listSessions({ userId, state } = {}) {
    requireText(userId, 'manual_concierge_user_id_required');
    if (state != null && !SESSION_STATES.has(state)) throw problem('manual_concierge_state_invalid');
    return [...sessions.values()]
      .filter((session) => session.userId === userId && (state == null || session.state === state))
      .map(clone);
  }

  function metrics({ userId } = {}) {
    requireText(userId, 'manual_concierge_user_id_required');
    const completed = [...sessions.values()].filter((session) => session.userId === userId && session.state === 'COMPLETED');
    const total = completed.length;
    const sum = (selector) => completed.reduce((acc, item) => acc + selector(item.outcome), 0);
    const rate = (selector) => total ? sum((outcome) => selector(outcome) ? 1 : 0) / total : 0;
    return Object.freeze({
      completedSessions: total,
      perceivedTimeSavedMinutes: sum((outcome) => outcome.perceivedTimeSavedMinutes),
      manualChecksAvoided: sum((outcome) => outcome.manualChecksAvoided),
      averageHelpfulness: total ? sum((outcome) => outcome.helpfulness) / total : 0,
      overrideRate: rate((outcome) => outcome.override),
      correctionRate: rate((outcome) => outcome.corrected),
      openedOtherAppRate: rate((outcome) => outcome.openedOtherApp),
      repeatTrustRate: rate((outcome) => outcome.repeatTrust),
      criticalFalseClaimCount: sum((outcome) => outcome.criticalFalseClaim ? 1 : 0)
    });
  }

  return Object.freeze({ startSession, recordGuidance, recordOutcome, getSession, listSessions, metrics });
}

function normalizeSession(input, { now, idFactory }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem('manual_concierge_session_required');
  const sessionId = input.sessionId == null ? requireText(idFactory(), 'manual_concierge_session_id_invalid') : requireText(input.sessionId, 'manual_concierge_session_id_invalid');
  const userId = requireText(input.userId, 'manual_concierge_user_id_required');
  const tripId = input.tripId == null ? null : requireText(input.tripId, 'manual_concierge_trip_id_invalid');
  const decision = requireText(input.decision, 'manual_concierge_decision_required');
  const contextFacts = normalizeArray(input.contextFacts, normalizeFact, 'manual_concierge_facts_invalid');
  const declaredPreferences = normalizeArray(input.declaredPreferences, normalizePreference, 'manual_concierge_preferences_invalid');
  const inferences = normalizeArray(input.inferences, normalizeInference, 'manual_concierge_inferences_invalid');
  return Object.freeze({
    sessionId,
    userId,
    tripId,
    decision,
    state: 'STARTED',
    contextFacts: Object.freeze(contextFacts),
    declaredPreferences: Object.freeze(declaredPreferences),
    inferences: Object.freeze(inferences),
    guidance: null,
    outcome: null,
    startedAt: clockIso(now),
    guidanceRecordedAt: null,
    completedAt: null
  });
}

function normalizeFact(input) {
  requireObject(input, 'manual_concierge_fact_invalid');
  return Object.freeze({
    key: requireText(input.key, 'manual_concierge_fact_key_required'),
    value: jsonClone(input.value),
    sourceRef: requireText(input.sourceRef, 'manual_concierge_fact_source_required'),
    observedAt: normalizeTime(input.observedAt, 'manual_concierge_fact_observed_at_invalid'),
    freshness: requireEnum(input.freshness, FRESHNESS, 'manual_concierge_fact_freshness_invalid')
  });
}

function normalizePreference(input) {
  requireObject(input, 'manual_concierge_preference_invalid');
  return Object.freeze({
    key: requireText(input.key, 'manual_concierge_preference_key_required'),
    value: jsonClone(input.value),
    sourceRef: requireText(input.sourceRef, 'manual_concierge_preference_source_required')
  });
}

function normalizeInference(input) {
  requireObject(input, 'manual_concierge_inference_invalid');
  const confidence = numberBetween(input.confidence, 0, 1, 'manual_concierge_inference_confidence_invalid');
  return Object.freeze({
    key: requireText(input.key, 'manual_concierge_inference_key_required'),
    value: jsonClone(input.value),
    sourceRef: requireText(input.sourceRef, 'manual_concierge_inference_source_required'),
    confidence,
    label: 'INFERENCE'
  });
}

function normalizeGuidance(input, session) {
  requireObject(input, 'manual_concierge_guidance_required');
  const status = requireEnum(input.status, GUIDANCE_STATUSES, 'manual_concierge_guidance_status_invalid');
  const recommendation = input.recommendation == null ? null : requireText(input.recommendation, 'manual_concierge_recommendation_invalid');
  if (status === 'ACTION_RECOMMENDED' && !recommendation) throw problem('manual_concierge_recommendation_required');
  if (status === 'ACTION_RECOMMENDED' && session.contextFacts.length === 0) throw problem('manual_concierge_action_requires_fact');
  return Object.freeze({
    status,
    recommendation,
    why: requireText(input.why, 'manual_concierge_why_required'),
    confidence: numberBetween(input.confidence, 0, 1, 'manual_concierge_guidance_confidence_invalid'),
    alternatives: Object.freeze(textArray(input.alternatives, 'manual_concierge_alternatives_invalid')),
    tradeoff: input.tradeoff == null ? null : requireText(input.tradeoff, 'manual_concierge_tradeoff_invalid'),
    missingInformation: Object.freeze(textArray(input.missingInformation, 'manual_concierge_missing_information_invalid'))
  });
}

function normalizeOutcome(input) {
  requireObject(input, 'manual_concierge_outcome_required');
  return Object.freeze({
    userDecision: requireText(input.userDecision, 'manual_concierge_user_decision_required'),
    corrected: requireBoolean(input.corrected, 'manual_concierge_corrected_required'),
    override: requireBoolean(input.override, 'manual_concierge_override_required'),
    perceivedTimeSavedMinutes: nonNegativeNumber(input.perceivedTimeSavedMinutes, 'manual_concierge_time_saved_invalid'),
    manualChecksAvoided: nonNegativeInteger(input.manualChecksAvoided, 'manual_concierge_manual_checks_invalid'),
    helpfulness: numberBetween(input.helpfulness, 1, 5, 'manual_concierge_helpfulness_invalid'),
    openedOtherApp: requireBoolean(input.openedOtherApp, 'manual_concierge_other_app_required'),
    repeatTrust: requireBoolean(input.repeatTrust, 'manual_concierge_repeat_trust_required'),
    criticalFalseClaim: requireBoolean(input.criticalFalseClaim, 'manual_concierge_false_claim_required')
  });
}

function ownedSession(sessions, sessionId, userId) {
  requireText(sessionId, 'manual_concierge_session_id_required');
  requireText(userId, 'manual_concierge_user_id_required');
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) throw problem('manual_concierge_session_not_found', 404);
  return session;
}

function normalizeArray(value, mapper, code) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw problem(code);
  return value.map(mapper);
}

function textArray(value, code) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw problem(code);
  return value.map((item) => requireText(item, code));
}

function requireObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem(code);
}

function requireText(value, code) {
  if (typeof value !== 'string') throw problem(code);
  const text = value.trim();
  if (!text || text.length > MAX_TEXT) throw problem(code);
  return text;
}

function requireEnum(value, allowed, code) {
  if (typeof value !== 'string' || !allowed.has(value)) throw problem(code);
  return value;
}

function requireBoolean(value, code) {
  if (typeof value !== 'boolean') throw problem(code);
  return value;
}

function numberBetween(value, min, max, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw problem(code);
  return number;
}

function nonNegativeNumber(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw problem(code);
  return number;
}

function nonNegativeInteger(value, code) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw problem(code);
  return number;
}

function normalizeTime(value, code) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw problem(code);
  return new Date(ms).toISOString();
}

function clockIso(now) {
  const ms = Number(now());
  if (!Number.isFinite(ms)) throw problem('manual_concierge_clock_invalid');
  return new Date(ms).toISOString();
}

function jsonClone(value) {
  if (value === undefined) throw problem('manual_concierge_value_required');
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('not_json');
    return JSON.parse(serialized);
  } catch {
    throw problem('manual_concierge_value_not_json');
  }
}

function clone(value) {
  return structuredClone(value);
}

function problem(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
