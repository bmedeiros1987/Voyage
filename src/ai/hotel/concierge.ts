import type { ConciergeRecommendation } from '../contracts.js';
import { roomRestAdvice, type RoomNoiseFingerprint } from './noiseIntelligence.js';

export type HotelConciergeContext = {
  hotelName: string;
  roomLabel?: string;
  restPriority?: 'normal' | 'high';
  noiseFingerprint: RoomNoiseFingerprint | null;
};

export function buildHotelConciergeRecommendation(
  context: HotelConciergeContext,
  now = new Date(),
): ConciergeRecommendation {
  const advice = roomRestAdvice(context.noiseFingerprint, context.restPriority ?? 'normal');
  const room = context.roomLabel ? ` ${context.roomLabel}` : '';

  if (!context.noiseFingerprint?.items.length) {
    return {
      id: `hotel-noise-${context.hotelName}-${now.toISOString()}`,
      domain: 'hotel',
      action: 'silence',
      title: 'Sem evidência suficiente sobre ruído',
      summary: `Ainda não há histórico confiável de ruído para o quarto${room}.`,
      rationale: [],
      evidenceIds: [],
      confidence: 'low',
      generatedAt: now.toISOString(),
    };
  }

  const structural = context.noiseFingerprint.items.filter((item) => item.structural);
  const transient = context.noiseFingerprint.items.filter((item) => !item.structural);

  if (advice.disposition === 'avoid' || advice.disposition === 'caution') {
    const firstReason = advice.reasons[0] ?? 'há ruído recorrente com evidência recente';
    return {
      id: `hotel-noise-${context.hotelName}-${now.toISOString()}`,
      domain: 'hotel',
      action: advice.disposition === 'avoid' ? 'warn' : 'suggest',
      title: advice.disposition === 'avoid' ? 'Vale tentar outro quarto' : 'Considere um quarto mais silencioso',
      summary: `Para o quarto${room}, ${firstReason}.`,
      rationale: advice.reasons,
      evidenceIds: advice.evidenceIds,
      confidence: structural.some((item) => item.confidence === 'high') ? 'high' : 'medium',
      generatedAt: now.toISOString(),
    };
  }

  if (!structural.length && transient.length) {
    return {
      id: `hotel-noise-${context.hotelName}-${now.toISOString()}`,
      domain: 'hotel',
      action: 'inform',
      title: 'Relato pontual, não característica do quarto',
      summary: `Há relato recente de ruído no quarto${room}, mas a origem parece circunstancial e não estrutural.`,
      rationale: transient.map((item) => `${item.label}: ${item.evidenceCount} evidência(s)`),
      evidenceIds: transient.flatMap((item) => item.evidenceIds),
      confidence: 'medium',
      generatedAt: now.toISOString(),
    };
  }

  return {
    id: `hotel-noise-${context.hotelName}-${now.toISOString()}`,
    domain: 'hotel',
    action: 'inform',
    title: 'Perfil acústico do quarto disponível',
    summary: advice.reasons.length ? advice.reasons.join(' · ') : `Não há sinal forte de ruído recorrente no quarto${room}.`,
    rationale: advice.reasons,
    evidenceIds: advice.evidenceIds,
    confidence: structural.some((item) => item.confidence === 'high') ? 'high' : 'medium',
    generatedAt: now.toISOString(),
  };
}
