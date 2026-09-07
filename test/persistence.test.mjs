import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, createSqlRepository, persistenceCapabilities } from '../src/persistence.mjs';

test('every persisted collection required by the product is modelled', () => {
  const { collections } = persistenceCapabilities();
  for (const name of ['preferences', 'consents', 'memberships', 'subscriptions', 'entitlements']) {
    assert.ok(collections.includes(name), `${name} must be persisted`);
  }
});

test('records round-trip and are scoped by globalUserId', async () => {
  const repo = createMemoryRepository();
  await repo.put('preferences', 'gid_a', 'home', { density: 'COMPACT' });
  await repo.put('preferences', 'gid_b', 'home', { density: 'COMFORTABLE' });

  assert.equal((await repo.get('preferences', 'gid_a', 'home')).density, 'COMPACT');
  // One user must never read another user's row.
  assert.equal((await repo.list('preferences', 'gid_a')).length, 1);
  assert.equal((await repo.get('preferences', 'gid_b', 'home')).density, 'COMFORTABLE');
});

test('a write without an identity is refused', async () => {
  const repo = createMemoryRepository();
  await assert.rejects(() => repo.put('preferences', null, 'home', {}), /global_user_id_required/);
});

test('an unknown collection is refused', async () => {
  const repo = createMemoryRepository();
  await assert.rejects(() => repo.get('secrets', 'gid_a', 'x'), /unknown_collection/);
});

test('the SQL driver issues no destructive statement', async () => {
  const statements = [];
  const repo = createSqlRepository({ execute: async (sql) => { statements.push(sql); return []; } });

  await repo.get('preferences', 'gid_a', 'home');
  await repo.put('preferences', 'gid_a', 'home', { density: 'COMPACT' });
  await repo.list('preferences', 'gid_a');
  await repo.remove('preferences', 'gid_a', 'home');

  assert.ok(statements.length >= 4);
  for (const sql of statements) {
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|ALTER|CREATE\s+TABLE)\b/i, `destructive: ${sql}`);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i, `hard delete: ${sql}`);
  }
  // remove() must tombstone rather than erase.
  assert.match(statements[3], /UPDATE .* SET deleted_at/i);
});

test('every SQL statement is parameterised, never interpolated', async () => {
  const calls = [];
  const repo = createSqlRepository({ execute: async (sql, params) => { calls.push({ sql, params }); return []; } });
  await repo.get('preferences', "gid_a'; DROP TABLE voyage_preferences; --", 'home');
  assert.equal(calls[0].sql.includes('DROP'), false);
  assert.equal(calls[0].params[0], "gid_a'; DROP TABLE voyage_preferences; --");
});
