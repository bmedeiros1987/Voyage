import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimePersistence } from '../src/persistence.mjs';

test('development uses explicit ephemeral memory persistence when TiDB is not wired', () => {
  const persistence = createRuntimePersistence({ nodeEnv: 'development', databaseConfigured: false });
  assert.equal(persistence.kind, 'memory');
  assert.equal(persistence.durability, 'ephemeral');
});

test('production fails closed instead of silently using memory persistence', () => {
  assert.throws(
    () => createRuntimePersistence({ nodeEnv: 'production', databaseConfigured: false }),
    /production_persistence_required/
  );
});

test('database-configured runtime requires a real TiDB executor', () => {
  assert.throws(
    () => createRuntimePersistence({ nodeEnv: 'production', databaseConfigured: true }),
    /tidb_execute_required/
  );
});

test('database-configured runtime uses the canonical TiDB persistence when executor exists', () => {
  const execute = async () => [[], {}];
  const persistence = createRuntimePersistence({ nodeEnv: 'production', databaseConfigured: true, execute });
  assert.equal(persistence.kind, 'tidb');
  assert.equal(persistence.durability, 'persistent');
});
