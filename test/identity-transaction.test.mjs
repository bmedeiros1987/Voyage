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

import { createMemoryPersistence } from '../src/persistence.mjs';
test('unverified email cannot reserve or replace another account address', async () => {
  const store = createMemoryPersistence();
  const unverified = await store.upsertGoogleIdentity({ googleSubject: 'attacker', email: 'victim@example.test', emailVerified: false });
  assert.equal(unverified.email, null);
  const victim = await store.upsertGoogleIdentity({ googleSubject: 'victim', email: 'victim@example.test', emailVerified: true });
  assert.equal(victim.email, 'victim@example.test');
  const updated = await store.upsertGoogleIdentity({ googleSubject: 'victim', email: 'other@example.test', emailVerified: false });
  assert.equal(updated.email, 'victim@example.test');
  const omitted = await store.upsertGoogleIdentity({ googleSubject: 'omitted', email: 'victim@example.test' });
  assert.equal(omitted.email, null);
});
test('SQL identity ignores unverified email in writes and collision checks', async () => {
  const calls = [];
  const execute = async (sql, params) => { calls.push({ sql, params }); return sql.startsWith('SELECT') ? [[]] : [{ affectedRows: 1 }]; };
  execute.transaction = (work) => work(execute);
  const result = await createTidbPersistence({ execute }).upsertGoogleIdentity({ googleSubject: 'unverified', email: 'victim@example.test', emailVerified: false });
  assert.equal(result.email, null);
  assert.equal(JSON.stringify(calls).includes('victim@example.test'), false);
});
