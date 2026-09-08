import test from 'node:test';
import assert from 'node:assert/strict';

import { createMysqlTidbExecute } from '../src/persistence.mjs';

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
