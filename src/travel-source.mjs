const SOURCE_TYPES = new Set(['gmail', 'outlook', 'upload', 'booking', 'cvc', 'onfly', 'manual']);

export function normalizeTravelSource(input = {}) {
  const sourceType = SOURCE_TYPES.has(input.sourceType) ? input.sourceType : 'manual';
  return Object.freeze({
    sourceType,
    sourceId: String(input.sourceId || cryptoSafeId()),
    provider: input.provider ? String(input.provider) : null,
    receivedAt: normalizeDate(input.receivedAt),
    freshnessAt: normalizeDate(input.freshnessAt || input.receivedAt),
    confidence: normalizeConfidence(input.confidence),
    contentType: input.contentType ? String(input.contentType) : 'unknown'
  });
}

export function buildTravelFact({ type, value, source, confidence, freshnessAt }) {
  if (!type) throw new Error('travel_fact_type_required');
  const normalizedSource = normalizeTravelSource(source);
  return Object.freeze({
    type: String(type),
    value,
    provenance: {
      sourceType: normalizedSource.sourceType,
      sourceId: normalizedSource.sourceId,
      provider: normalizedSource.provider
    },
    confidence: normalizeConfidence(confidence ?? normalizedSource.confidence),
    freshnessAt: normalizeDate(freshnessAt || normalizedSource.freshnessAt)
  });
}

export function pipelineContract() {
  return Object.freeze([
    'TravelSource',
    'DocumentNormalizer',
    'DocumentClassifier',
    'TravelEntityExtractor',
    'ReservationFingerprint',
    'ReservationMatcher',
    'TripGraph',
    'DomainProjections'
  ]);
}

function normalizeConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function cryptoSafeId() {
  return `source-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
