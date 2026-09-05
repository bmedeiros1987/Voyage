import { evidenceConfidenceScore, type EvidenceConfidence, type EvidenceSource } from '../contracts.js';

export type NoiseSource =
  | 'road_traffic'
  | 'aircraft'
  | 'construction'
  | 'elevator'
  | 'corridor'
  | 'neighbor_guest'
  | 'leisure_area'
  | 'hotel_infrastructure'
  | 'nightlife'
  | 'temporary_event'
  | 'unknown';

export type NoiseIntensity = 'low' | 'moderate' | 'high';
export type NoiseRecurrence = 'single' | 'occasional' | 'recurring' | 'continuous';

export type NoiseObservation = {
  id: string;
  hotelId: string;
  roomId?: string;
  reporterKey?: string;
  source: EvidenceSource;
  noiseSource: NoiseSource;
  intensity: NoiseIntensity;
  recurrence: NoiseRecurrence;
  observedAt: string;
  confidence: EvidenceConfidence;
  validUntil?: string;
  hotelConfirmed?: boolean;
  periods?: Array<{ start: string; end: string }>;
  note?: string;
};

export type NoiseFingerprintItem = {
  noiseSource: NoiseSource;
  label: string;
  intensity: NoiseIntensity;
  recurrence: NoiseRecurrence;
  structural: boolean;
  evidenceCount: number;
  distinctReporterCount: number;
  confidence: EvidenceConfidence;
  lastObservedAt: string;
  evidenceIds: string[];
  periods: Array<{ start: string; end: string }>;
};

export type RoomNoiseFingerprint = {
  hotelId: string;
  roomId?: string;
  asOf: string;
  items: NoiseFingerprintItem[];
};

export type RoomRestAdvice = {
  disposition: 'prefer' | 'neutral' | 'caution' | 'avoid';
  score: number;
  reasons: string[];
  evidenceIds: string[];
};

const LABELS: Record<NoiseSource, string> = {
  road_traffic: 'trânsito/avenida',
  aircraft: 'aeronaves/rota aérea',
  construction: 'obra/reforma',
  elevator: 'elevador',
  corridor: 'corredor',
  neighbor_guest: 'hóspede/quarto vizinho',
  leisure_area: 'área de lazer/restaurante/eventos',
  hotel_infrastructure: 'infraestrutura do hotel',
  nightlife: 'vida noturna externa',
  temporary_event: 'evento temporário',
  unknown: 'origem não identificada',
};

const FRESHNESS_DAYS: Record<NoiseSource, number> = {
  road_traffic: 365,
  aircraft: 365,
  construction: 21,
  elevator: 365,
  corridor: 90,
  neighbor_guest: 3,
  leisure_area: 180,
  hotel_infrastructure: 365,
  nightlife: 365,
  temporary_event: 3,
  unknown: 14,
};

const POTENTIALLY_STRUCTURAL = new Set<NoiseSource>([
  'road_traffic',
  'aircraft',
  'elevator',
  'corridor',
  'leisure_area',
  'hotel_infrastructure',
  'nightlife',
]);

const intensityScore = (value: NoiseIntensity): number => value === 'high' ? 3 : value === 'moderate' ? 2 : 1;
const recurrenceScore = (value: NoiseRecurrence): number => value === 'continuous' ? 4 : value === 'recurring' ? 3 : value === 'occasional' ? 2 : 1;

function validDate(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFresh(observation: NoiseObservation, nowMs: number): boolean {
  const observedAt = validDate(observation.observedAt);
  if (observedAt === null) return false;
  const validUntil = observation.validUntil ? validDate(observation.validUntil) : null;
  if (validUntil !== null) return nowMs <= validUntil;
  return nowMs - observedAt <= FRESHNESS_DAYS[observation.noiseSource] * 86_400_000;
}

function strongestIntensity(items: NoiseObservation[]): NoiseIntensity {
  return items.reduce<NoiseIntensity>((current, item) =>
    intensityScore(item.intensity) > intensityScore(current) ? item.intensity : current, 'low');
}

function strongestRecurrence(items: NoiseObservation[]): NoiseRecurrence {
  return items.reduce<NoiseRecurrence>((current, item) =>
    recurrenceScore(item.recurrence) > recurrenceScore(current) ? item.recurrence : current, 'single');
}

function aggregateConfidence(items: NoiseObservation[]): EvidenceConfidence {
  const score = items.reduce((sum, item) => sum + evidenceConfidenceScore(item.confidence), 0) / Math.max(1, items.length);
  const corroboration = items.length >= 3 ? 0.18 : items.length === 2 ? 0.1 : 0;
  const finalScore = Math.min(1, score + corroboration);
  if (finalScore >= 0.82) return 'high';
  if (finalScore >= 0.5) return 'medium';
  return 'low';
}

function isStructural(noiseSource: NoiseSource, items: NoiseObservation[], distinctReporterCount: number): boolean {
  if (!POTENTIALLY_STRUCTURAL.has(noiseSource)) return false;
  if (items.some((item) => item.hotelConfirmed)) return true;
  const recurringEvidence = items.filter((item) => item.recurrence === 'recurring' || item.recurrence === 'continuous').length;
  return distinctReporterCount >= 2 || recurringEvidence >= 2;
}

export function buildNoiseFingerprint(
  observations: NoiseObservation[],
  now = new Date(),
): RoomNoiseFingerprint | null {
  const nowMs = now.getTime();
  const fresh = observations.filter((item) => isFresh(item, nowMs));
  if (!fresh.length) return null;

  const hotelId = fresh[0]!.hotelId;
  const roomId = fresh.every((item) => item.roomId === fresh[0]!.roomId) ? fresh[0]!.roomId : undefined;
  const grouped = new Map<NoiseSource, NoiseObservation[]>();

  for (const observation of fresh) {
    if (observation.hotelId !== hotelId) continue;
    if (roomId !== undefined && observation.roomId !== roomId) continue;
    const current = grouped.get(observation.noiseSource) ?? [];
    current.push(observation);
    grouped.set(observation.noiseSource, current);
  }

  const items: NoiseFingerprintItem[] = Array.from(grouped.entries()).map(([noiseSource, evidence]) => {
    const reporterKeys = new Set(evidence.map((item) => item.reporterKey).filter((value): value is string => Boolean(value)));
    const distinctReporterCount = reporterKeys.size || Math.min(1, evidence.length);
    const lastObservedAt = evidence
      .map((item) => item.observedAt)
      .sort((a, b) => (validDate(b) ?? 0) - (validDate(a) ?? 0))[0]!;
    const periods = Array.from(new Map(
      evidence.flatMap((item) => item.periods ?? []).map((period) => [`${period.start}-${period.end}`, period] as const),
    ).values());

    return {
      noiseSource,
      label: LABELS[noiseSource],
      intensity: strongestIntensity(evidence),
      recurrence: strongestRecurrence(evidence),
      structural: isStructural(noiseSource, evidence, distinctReporterCount),
      evidenceCount: evidence.length,
      distinctReporterCount,
      confidence: aggregateConfidence(evidence),
      lastObservedAt,
      evidenceIds: evidence.map((item) => item.id),
      periods,
    };
  });

  items.sort((a, b) => {
    const structuralDelta = Number(b.structural) - Number(a.structural);
    if (structuralDelta) return structuralDelta;
    const intensityDelta = intensityScore(b.intensity) - intensityScore(a.intensity);
    if (intensityDelta) return intensityDelta;
    return recurrenceScore(b.recurrence) - recurrenceScore(a.recurrence);
  });

  return {
    hotelId,
    ...(roomId !== undefined ? { roomId } : {}),
    asOf: now.toISOString(),
    items,
  };
}

export function roomRestAdvice(
  fingerprint: RoomNoiseFingerprint | null,
  restPriority: 'normal' | 'high' = 'normal',
): RoomRestAdvice {
  if (!fingerprint?.items.length) {
    return { disposition: 'neutral', score: 0, reasons: [], evidenceIds: [] };
  }

  let score = 0;
  const reasons: string[] = [];
  const evidenceIds = new Set<string>();

  for (const item of fingerprint.items) {
    const base = intensityScore(item.intensity) * (item.structural ? 1.35 : 0.55);
    const recurrence = recurrenceScore(item.recurrence) * (item.structural ? 0.35 : 0.15);
    const confidence = item.confidence === 'high' ? 1 : item.confidence === 'medium' ? 0.8 : 0.5;
    const itemScore = (base + recurrence) * confidence;
    score += itemScore;
    item.evidenceIds.forEach((id) => evidenceIds.add(id));

    if (item.structural) {
      const period = item.periods.length ? `, sobretudo ${item.periods.map((p) => `${p.start}–${p.end}`).join(', ')}` : '';
      reasons.push(`${item.label}: ${item.intensity}, ${item.recurrence}${period}`);
    } else if (item.noiseSource === 'construction' && item.recurrence !== 'single') {
      reasons.push(`obra/reforma recente: ${item.intensity}`);
    }
  }

  const adjusted = restPriority === 'high' ? score * 1.25 : score;
  const disposition = adjusted >= 6 ? 'avoid' : adjusted >= 3.2 ? 'caution' : adjusted <= 0.8 ? 'prefer' : 'neutral';

  return {
    disposition,
    score: Number(adjusted.toFixed(2)),
    reasons,
    evidenceIds: Array.from(evidenceIds),
  };
}
