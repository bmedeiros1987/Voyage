import test from 'node:test';
import assert from 'node:assert/strict';
import { createMysqlTidbExecute, createTidbPersistence } from '../src/persistence.mjs';
test('failed Google identity insert rolls back user creation and releases connection', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'), commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'), release: () => events.push('release'),
    execute: async (sql) => {
      if (sql.startsWith('SELECT')) return [[]];
      if (sql.startsWith('INSERT INTO users')) { events.push('insert-user'); return [{ affectedRows: 1 }]; }
      if (sql.includes('INSERT INTO identities')) { const error = new Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error; }
      throw new Error('unexpected SQL');
    }
  };
  const execute = createMysqlTidbExecute({ databaseUrl: 'mysql://test:test@localhost/voyage_test', driverLoader: async () => ({ createPool: () => ({ execute: connection.execute, getConnection: async () => connection }) }) });
  await assert.rejects(createTidbPersistence({ execute }).upsertGoogleIdentity({ googleSubject: 'subject', email: 'person@example.test', emailVerified: true }), /identity_link_confirmation_required/);
  assert.deepEqual(events, ['begin', 'insert-user', 'rollback', 'release']);
});
