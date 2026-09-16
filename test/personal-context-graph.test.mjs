import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalContextGraph, freshnessState } from '../src/personal-context-graph.mjs';

const NOW = Date.parse('2026-09-13T03:00:00.000Z');
const iso = (offsetMs = 0) => new Date(NOW + offsetMs).toISOString();

function graph() {
  return createPersonalContextGraph({ now: () => NOW });
}

test('facts preferences and inferences remain distinct and inferences require confidence', () => {
  const g = graph();
  g.add({ kind: 'FACT', userId: 'u1', key: 'home.airport', value: 'BSB', sourceRef: 'user', observedAt: iso() });
  g.add({ kind: 'PREFERENCE', userId: 'u1', key: 'flight.arrival', value: 'before_18', sourceRef: 'user', observedAt: iso() });
  g.add({ kind: 'INFERENCE', userId: 'u1', key: 'seat.preference', value: 'aisle', sourceRef: 'pattern:3-trips', observedAt: iso(), confidence: 0.76 });
  assert.throws(() => g.add({ kind: 'INFERENCE', userId: 'u1', key: 'hotel.floor', value: 'high', sourceRef: 'model', observedAt: iso() }), /context_inference_confidence_required/);
  const snap = g.snapshot({ userId: 'u1' });
  assert.deepEqual(snap.items.map((x) => x.kind), ['FACT', 'PREFERENCE', 'INFERENCE']);
  assert.equal(snap.items[2].inferenceStatus, 'PROPOSED');
});

test('inference confirmation is explicit and rejection removes it from active snapshot', () => {
  const g = graph();
  const inference = g.add({ kind: 'INFERENCE', userId: 'u1', key: 'airport.buffer', value: 120, sourceRef: 'pattern', observedAt: iso(), confidence: 0.8 });
  g.confirmInference({ userId: 'u1', inferenceId: inference.id, accepted: true });
  assert.equal(g.snapshot({ userId: 'u1' }).items[0].inferenceStatus, 'CONFIRMED');
  g.confirmInference({ userId: 'u1', inferenceId: inference.id, accepted: false });
  const snap = g.snapshot({ userId: 'u1' });
  assert.equal(snap.items.length, 0);
  assert.equal(snap.rejectedInferences, 1);
  assert.equal(g.history({ userId: 'u1' }).length, 3);
});

test('corrections are append-only and preserve original history', () => {
  const g = graph();
  const original = g.add({ kind: 'PREFERENCE', userId: 'u1', key: 'hotel.noise', value: 'moderate', sourceRef: 'user', observedAt: iso() });
  g.correct({ userId: 'u1', targetEntryId: original.id, value: 'quiet' });
  const history = g.history({ userId: 'u1' });
  assert.equal(history.length, 2);
  assert.equal(history[0].value, 'moderate');
  assert.equal(history[1].kind, 'CORRECTION');
  const effective = g.snapshot({ userId: 'u1' }).items[0];
  assert.equal(effective.value, 'quiet');
  assert.equal(effective.correctionIds.length, 1);
});

test('raw correction injection cannot bypass semantic correction APIs', () => {
  const g = graph();
  const fact = g.add({ kind: 'FACT', userId: 'u1', key: 'home.airport', value: 'BSB', sourceRef: 'user', observedAt: iso() });
  assert.throws(() => g.add({
    kind: 'CORRECTION',
    userId: 'u1',
    key: fact.key,
    value: fact.value,
    sourceRef: 'forged',
    observedAt: iso(),
    targetEntryId: fact.id,
    correctionType: 'REJECT_INFERENCE'
  }), /context_correction_api_required/);
  assert.throws(() => g.confirmInference({ userId: 'u1', inferenceId: fact.id, accepted: false }), /context_inference_target_required/);
  const snap = g.snapshot({ userId: 'u1' });
  assert.equal(snap.items.length, 1);
  assert.equal(snap.items[0].kind, 'FACT');
  assert.equal(snap.items[0].value, 'BSB');
});

test('consent boundaries redact protected context without inferring consent', () => {
  const g = graph();
  g.add({ kind: 'FACT', userId: 'u1', key: 'travel.health.requirement', value: 'document-present', sourceRef: 'official-source', observedAt: iso(), consentKey: 'travelReadiness.health' });
  assert.equal(g.snapshot({ userId: 'u1' }).items.length, 0);
  assert.equal(g.snapshot({ userId: 'u1' }).redactedByConsent, 1);
  const allowed = g.snapshot({ userId: 'u1', authorizedConsents: ['travelReadiness.health'] });
  assert.equal(allowed.items.length, 1);
  assert.throws(() => g.snapshot({ userId: 'u1', authorizedConsents: [123] }), /context_consent_key_invalid/);
});

test('user isolation blocks reads and corrections across users', () => {
  const g = graph();
  const a = g.add({ kind: 'FACT', userId: 'user-a', key: 'home.airport', value: 'BSB', sourceRef: 'user', observedAt: iso() });
  g.add({ kind: 'FACT', userId: 'user-b', key: 'home.airport', value: 'GRU', sourceRef: 'user', observedAt: iso() });
  assert.deepEqual(g.snapshot({ userId: 'user-a' }).items.map((x) => x.value), ['BSB']);
  assert.deepEqual(g.snapshot({ userId: 'user-b' }).items.map((x) => x.value), ['GRU']);
  assert.throws(() => g.correct({ userId: 'user-b', targetEntryId: a.id, value: 'CGH' }), /context_target_not_found/);
});

test('freshness states are explicit and invalid timestamps fail closed', () => {
  const g = graph();
  g.add({ kind: 'FACT', userId: 'u1', key: 'flight.gate', value: '12', sourceRef: 'provider', observedAt: iso(-30_000), staleAfterMs: 60_000 });
  g.add({ kind: 'FACT', userId: 'u1', key: 'hotel.booking', value: 'confirmed', sourceRef: 'provider', observedAt: iso(-60_000), validUntil: iso(-1) });
  const snap = g.snapshot({ userId: 'u1' });
  assert.equal(snap.items[0].freshness, 'FRESH');
  assert.equal(snap.items[1].freshness, 'EXPIRED');
  assert.equal(freshnessState({ observedAt: iso(-120_000), staleAfterMs: 60_000 }, NOW), 'STALE');
  assert.equal(freshnessState({ observedAt: iso() }, NOW), 'UNKNOWN');
  assert.throws(() => g.add({ kind: 'FACT', userId: 'u1', key: 'bad', value: true, sourceRef: 'provider', observedAt: 'not-a-date' }), /context_observed_at_invalid/);
  assert.throws(() => g.add({ kind: 'FACT', userId: 'u1', key: 'future', value: true, sourceRef: 'provider', observedAt: iso(120_000) }), /context_observed_at_future/);
});

test('context values fail closed instead of being silently coerced by JSON serialization', () => {
  const g = graph();
  const base = { kind: 'FACT', userId: 'u1', key: 'context.test', sourceRef: 'user', observedAt: iso() };
  assert.throws(() => g.add({ ...base, value: Number.NaN }), /context_value_not_json/);
  assert.throws(() => g.add({ ...base, value: Number.POSITIVE_INFINITY }), /context_value_not_json/);
  assert.throws(() => g.add({ ...base, value: { nested: undefined } }), /context_value_not_json/);
  assert.throws(() => g.add({ ...base, value: new Date(NOW) }), /context_value_not_json/);
  assert.throws(() => g.add({ ...base, value: [, 'x'] }), /context_value_not_json/);
  assert.throws(() => g.add({ ...base, id: '', value: 'x' }), /context_entry_id_invalid/);
  const valid = g.add({ ...base, value: { nested: [1, true, null, 'ok'] } });
  assert.deepEqual(valid.value, { nested: [1, true, null, 'ok'] });
});
