import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualConciergeRecorder } from '../src/manual-concierge.mjs';

const NOW = Date.parse('2026-09-16T14:40:00.000Z');

function recorder() {
  let seq = 0;
  return createManualConciergeRecorder({
    now: () => NOW,
    idFactory: () => `session-${++seq}`
  });
}

function remoteGateSession(g, userId = 'u1') {
  return g.startSession({
    userId,
    tripId: 'trip-gru',
    decision: 'O que importa agora para o embarque no portão 252?',
    contextFacts: [{
      key: 'airport.gate.remote_bus',
      value: { airport: 'GRU', terminal: 'T2', gate: '252', remoteBus: true },
      sourceRef: 'field-observation:gru-t2',
      observedAt: '2026-09-16T08:00:00.000Z',
      freshness: 'FRESH'
    }],
    declaredPreferences: [{ key: 'airport.guidance', value: 'concise', sourceRef: 'user' }],
    inferences: [{ key: 'airport.buffer.preference', value: 'conservative', sourceRef: 'pattern', confidence: 0.72 }]
  });
}

test('records a Wizard-of-Oz session with provenance and explicit inference labels', () => {
  const g = recorder();
  const started = remoteGateSession(g);
  assert.equal(started.state, 'STARTED');
  assert.equal(started.contextFacts[0].sourceRef, 'field-observation:gru-t2');
  assert.equal(started.inferences[0].label, 'INFERENCE');
  assert.equal(started.inferences[0].confidence, 0.72);
});

test('action guidance requires a current fact and preserves explainability fields', () => {
  const g = recorder();
  const started = remoteGateSession(g);
  const updated = g.recordGuidance({
    sessionId: started.sessionId,
    userId: 'u1',
    guidance: {
      status: 'ACTION_RECOMMENDED',
      recommendation: 'Siga direto ao portão e acompanhe a chamada do ônibus.',
      why: 'O portão 252 pertence a um grupo de embarque remoto por ônibus confirmado em campo.',
      confidence: 0.92,
      alternatives: ['Se já estiver no portão, apenas aguarde a chamada de embarque.'],
      tradeoff: 'Ir antes ao portão pode reduzir tempo disponível para uma parada opcional.',
      missingInformation: ['tempo de caminhada ao portão', 'horário real de despacho do ônibus']
    }
  });
  assert.equal(updated.state, 'GUIDANCE_RECORDED');
  assert.equal(updated.guidance.status, 'ACTION_RECOMMENDED');
  assert.equal(updated.guidance.missingInformation.length, 2);

  const empty = g.startSession({ userId: 'u1', decision: 'Devo agir agora?' });
  assert.throws(() => g.recordGuidance({
    sessionId: empty.sessionId,
    userId: 'u1',
    guidance: { status: 'ACTION_RECOMMENDED', recommendation: 'Faça algo', why: 'sem fatos', confidence: 0.5 }
  }), /manual_concierge_action_requires_fact/);

  const expired = g.startSession({
    userId: 'u1', decision: 'Devo agir com base nisso?',
    contextFacts: [{ key: 'flight.gate', value: '252', sourceRef: 'old-cache', observedAt: '2026-09-15T08:00:00Z', freshness: 'EXPIRED' }]
  });
  assert.throws(() => g.recordGuidance({
    sessionId: expired.sessionId,
    userId: 'u1',
    guidance: { status: 'ACTION_RECOMMENDED', recommendation: 'Vá ao portão', why: 'fonte expirada', confidence: 0.2 }
  }), /manual_concierge_action_requires_current_fact/);
});

test('NO_ACTION_REQUIRED and INSUFFICIENT_INFORMATION are valid non-action outputs', () => {
  const g = recorder();
  const noAction = g.startSession({ userId: 'u1', decision: 'Preciso fazer algo agora?' });
  const guided = g.recordGuidance({
    sessionId: noAction.sessionId,
    userId: 'u1',
    guidance: {
      status: 'NO_ACTION_REQUIRED',
      why: 'Nenhum fato atual exige ação.',
      confidence: 0.8,
      alternatives: [],
      missingInformation: []
    }
  });
  assert.equal(guided.guidance.recommendation, null);

  const unknown = g.startSession({ userId: 'u1', decision: 'Quanto tempo leva até o portão?' });
  const insufficient = g.recordGuidance({
    sessionId: unknown.sessionId,
    userId: 'u1',
    guidance: {
      status: 'INSUFFICIENT_INFORMATION',
      why: 'Não há fonte atual de tempo de caminhada.',
      confidence: 1,
      missingInformation: ['tempo de caminhada atual']
    }
  });
  assert.equal(insufficient.guidance.status, 'INSUFFICIENT_INFORMATION');
});

test('outcomes produce the validation metrics required by phase 2', () => {
  const g = recorder();
  const first = remoteGateSession(g);
  g.recordGuidance({
    sessionId: first.sessionId,
    userId: 'u1',
    guidance: {
      status: 'ACTION_RECOMMENDED', recommendation: 'Siga ao portão.', why: 'Portão remoto por ônibus.', confidence: 0.9
    }
  });
  g.recordOutcome({
    sessionId: first.sessionId,
    userId: 'u1',
    outcome: {
      userDecision: 'Seguiu ao portão',
      corrected: false,
      override: false,
      perceivedTimeSavedMinutes: 7,
      manualChecksAvoided: 2,
      helpfulness: 5,
      openedOtherApp: false,
      repeatTrust: true,
      criticalFalseClaim: false
    }
  });

  const metrics = g.metrics({ userId: 'u1' });
  assert.equal(metrics.completedSessions, 1);
  assert.equal(metrics.perceivedTimeSavedMinutes, 7);
  assert.equal(metrics.manualChecksAvoided, 2);
  assert.equal(metrics.averageHelpfulness, 5);
  assert.equal(metrics.overrideRate, 0);
  assert.equal(metrics.openedOtherAppRate, 0);
  assert.equal(metrics.repeatTrustRate, 1);
  assert.equal(metrics.criticalFalseClaimCount, 0);
});

test('session ownership fails closed across users', () => {
  const g = recorder();
  const started = remoteGateSession(g, 'user-a');
  assert.throws(() => g.getSession({ sessionId: started.sessionId, userId: 'user-b' }), /manual_concierge_session_not_found/);
  assert.deepEqual(g.listSessions({ userId: 'user-b' }), []);
  assert.equal(g.listSessions({ userId: 'user-a' }).length, 1);
});

test('material values and measurement fields fail closed on invalid data', () => {
  const g = recorder();
  assert.throws(() => g.startSession({
    userId: 'u1', decision: 'x',
    contextFacts: [{ key: 'bad', value: Number.NaN, sourceRef: 'source', observedAt: '2026-09-16T08:00:00Z', freshness: 'FRESH' }]
  }), /manual_concierge_value_not_json/);
  assert.throws(() => g.startSession({
    userId: 'u1', decision: 'x',
    contextFacts: [{ key: 'bad', value: true, sourceRef: '', observedAt: '2026-09-16T08:00:00Z', freshness: 'FRESH' }]
  }), /manual_concierge_fact_source_required/);
  assert.throws(() => g.startSession({
    userId: 'u1', decision: 'x',
    inferences: [{ key: 'guess', value: true, sourceRef: 'model', confidence: 2 }]
  }), /manual_concierge_inference_confidence_invalid/);
  assert.throws(() => g.startSession({
    userId: 'u1', decision: 'x',
    inferences: [{ key: 'guess', value: true, sourceRef: 'model', confidence: '0.7' }]
  }), /manual_concierge_inference_confidence_invalid/);
  assert.throws(() => g.startSession({
    userId: 'u1', decision: 'x',
    contextFacts: [{ key: 'future', value: true, sourceRef: 'source', observedAt: '2026-09-16T14:42:00Z', freshness: 'FRESH' }]
  }), /manual_concierge_fact_observed_at_future/);
});
