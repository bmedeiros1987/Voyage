import test from 'node:test';
import assert from 'node:assert/strict';

import { createMysqlTidbExecute, parseTidbDatabaseUrl } from '../src/persistence.mjs';

test('production TiDB runtime dependency resolves mysql2 promise API', async () => {
  const mysql = await import('mysql2/promise');
  assert.equal(typeof (mysql.createPool || mysql.default?.createPool), 'function');
});

test('canonical TiDB executor can load the installed runtime driver lazily', async () => {
  let loaded = false;
  const execute = createMysqlTidbExecute({
    databaseUrl: 'mysql://voyage:secret@db.example.com:4000/voyage',
    driverLoader: async () => {
      loaded = true;
      return {
        createPool() {
          return { execute: async (sql, params) => [[{ ok: 1, sql, params }], []] };
        }
      };
    }
  });

  assert.equal(loaded, false);
  const [rows] = await execute('SELECT ?', [1]);
  assert.equal(loaded, true);
  assert.equal(rows[0].ok, 1);
});

/**
 * The stubbed loader above never reaches mysql2's own createPool, so it cannot
 * see a config the real driver rejects. Drive the production path with the
 * real driver against a closed local port: the pool must be built (the failure
 * has to be the refused connection, never tidb_driver_unavailable).
 */
test('the real driver accepts the config the canonical executor builds', async () => {
  const execute = createMysqlTidbExecute({
    databaseUrl: 'mysql://voyage:secret@127.0.0.1:1/voyage',
    driverLoader: () => import('mysql2/promise')
  });

  await assert.rejects(execute('SELECT 1'), (error) => {
    assert.notEqual(error.code, 'tidb_driver_unavailable', `driver rejected the config: ${error.cause?.message || error.message}`);
    return true;
  });
});

test('the parsed TiDB config keeps TLS frozen against tampering', () => {
  const config = parseTidbDatabaseUrl('mysql://voyage:secret@db.example.com:4000/voyage');
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.ssl), true);
  assert.throws(() => { config.ssl.rejectUnauthorized = false; }, TypeError);
  assert.equal(config.ssl.rejectUnauthorized, true);
});
