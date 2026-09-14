import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimePersistence, createMysqlTidbExecute, parseTidbDatabaseUrl } from '../src/persistence.mjs';

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

test('database-configured runtime requires a valid TiDB database URL when executor is not injected', () => {
  assert.throws(
    () => createRuntimePersistence({ nodeEnv: 'production', databaseConfigured: true, databaseUrl: '' }),
    /tidb_database_url_required/
  );
  assert.throws(
    () => createRuntimePersistence({ nodeEnv: 'production', databaseConfigured: true, databaseUrl: 'https://example.com/db' }),
    /tidb_database_url_invalid/
  );
});

test('database-configured runtime uses canonical TiDB persistence with an injected executor', () => {
  const execute = async () => [[], {}];
  const persistence = createRuntimePersistence({ nodeEnv: 'production', databaseConfigured: true, execute });
  assert.equal(persistence.kind, 'tidb');
  assert.equal(persistence.durability, 'persistent');
});

test('database-configured runtime lazily wires mysql2-compatible TiDB driver with verified TLS', async () => {
  let receivedConfig = null;
  let executed = null;
  const driverLoader = async () => ({
    createPool(config) {
      receivedConfig = config;
      return {
        async execute(sql, params) {
          executed = { sql, params };
          return [[], {}];
        }
      };
    }
  });

  const persistence = createRuntimePersistence({
    nodeEnv: 'production',
    databaseConfigured: true,
    databaseUrl: 'mysql://voyage:secret@tidb.example.com:4000/voyage',
    driverLoader
  });

  assert.equal(persistence.kind, 'tidb');
  assert.equal(persistence.durability, 'persistent');
  assert.equal(await persistence.getSession('session-1'), null);
  assert.equal(receivedConfig.host, 'tidb.example.com');
  assert.equal(receivedConfig.port, 4000);
  assert.equal(receivedConfig.database, 'voyage');
  assert.deepEqual(receivedConfig.ssl, { minVersion: 'TLSv1.2', rejectUnauthorized: true });
  assert.match(executed.sql, /FROM user_sessions/);
  assert.deepEqual(executed.params, ['session-1']);
});

test('TiDB URL parsing never returns credentials outside the driver config and requires a database name', () => {
  const parsed = parseTidbDatabaseUrl('mysqls://user:p%40ss@cluster.example.com:4000/appdb');
  assert.equal(parsed.user, 'user');
  assert.equal(parsed.password, 'p@ss');
  assert.equal(parsed.database, 'appdb');
  assert.throws(() => parseTidbDatabaseUrl('mysql://user:secret@cluster.example.com:4000/'), /tidb_database_url_invalid/);
});

test('lazy TiDB executor fails closed when the runtime driver cannot be loaded', async () => {
  const execute = createMysqlTidbExecute({
    databaseUrl: 'mysql://user:secret@cluster.example.com:4000/appdb',
    driverLoader: async () => { throw new Error('missing module'); }
  });
  await assert.rejects(() => execute('SELECT 1'), /tidb_driver_unavailable/);
});
