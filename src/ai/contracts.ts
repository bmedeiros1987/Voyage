export type EvidenceConfidence = 'low' | 'medium' | 'high';
export type EvidenceSource = 'user' | 'hotel' | 'community' | 'provider' | 'derived';

export type Evidence<T> = {
  id: string;
  value: T;
  source: EvidenceSource;
  observedAt: string;
  confidence: EvidenceConfidence;
  validUntil?: string;
};

export type IntelligenceFact<T> = {
  kind: string;
  value: T;
  confidence: EvidenceConfidence;
  evidenceIds: string[];
  asOf: string;
  expiresAt?: string;
};

export type ConciergeRecommendation = {
  id: string;
  domain: 'hotel' | 'flight' | 'mobility' | 'journey' | 'recovery';
  action: 'inform' | 'suggest' | 'warn' | 'ask' | 'silence';
  title: string;
  summary: string;
  rationale: string[];
  evidenceIds: string[];
  confidence: EvidenceConfidence;
  generatedAt: string;
};

export type AIResponseEnvelope = {
  recommendations: ConciergeRecommendation[];
  facts: IntelligenceFact<unknown>[];
  missingFacts: string[];
  generatedAt: string;
};

export const evidenceConfidenceScore = (confidence: EvidenceConfidence): number => {
  if (confidence === 'high') return 1;
  if (confidence === 'medium') return 0.66;
  return 0.33;
};
