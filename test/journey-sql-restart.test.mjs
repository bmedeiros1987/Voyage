import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createTidbPersistence } from '../src/persistence.mjs';
const databaseUrl = process.env.VOYAGE_TEST_DATABASE_URL;
test('SQL journey data and sessions survive pool recreation and retain owner isolation', { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, '/voyage_test', 'Only the disposable CI database is allowed');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  const { createPool } = await import('mysql2/promise');
  let pool = createPool(databaseUrl);
  const execute = (...args) => pool.execute(...args);
  execute.transaction = async (work) => {
    const connection = await pool.getConnection();
    try { await connection.beginTransaction(); const result = await work((...args) => connection.execute(...args)); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  };
  const userId = randomUUID(); const importId = randomUUID(); const journeyId = randomUUID(); const sessionId = randomUUID();
  try {
    for (const name of ['001_initial.sql', '006_auth_sessions_itinerary_proposals.sql', '008_operational_journeys.sql']) {
      const sql = (await readFile(new URL('../db/' + name, import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
      for (const statement of sql.split(';').filter((s) => s.trim())) await pool.query(statement);
    }
    let store = createTidbPersistence({ execute });
    const identity = { googleSubject: userId, email: userId + '@example.test', emailVerified: true };
    const firstIdentity = await store.upsertGoogleIdentity(identity);
    assert.equal((await store.upsertGoogleIdentity(identity)).userId, firstIdentity.userId);
    const record = { id: journeyId, importId, title: 'Persistent journey', facts: { destination: 'Rio' } };
    await store.saveImport(userId, { importId, facts: record.facts });
    await store.saveJourney(userId, record);
    await store.putSession({ id: sessionId, userId, tokenFingerprint: 'a'.repeat(64), issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+3600000).toISOString(), revokedAt: null });
    await pool.end(); pool = createPool(databaseUrl);
    store = createTidbPersistence({ execute });
    assert.deepEqual(await store.readJourney(userId, journeyId), record);
    assert.equal((await store.getSession(sessionId)).userId, userId);
    assert.equal(await store.readJourney('another-user', journeyId), null);
    assert.equal(await store.readImport('another-user', importId), null);
    assert.deepEqual(await store.listJourneys('another-user'), []);
    const retry = await store.saveJourney(userId, { ...record, id: randomUUID() });
    assert.equal(retry.id, journeyId);
    assert.equal((await store.listJourneys(userId)).length, 1);
    await store.revokeSession(sessionId); assert.ok((await store.getSession(sessionId)).revokedAt);
  } finally {
    await pool.execute('DELETE FROM voyage_journeys WHERE user_id=?', [userId]);
    await pool.execute('DELETE FROM voyage_imports WHERE user_id=?', [userId]);
    await pool.execute("DELETE u FROM users u JOIN identities i ON i.user_id=u.id WHERE i.provider='GOOGLE' AND i.provider_subject=?", [userId]);
    await pool.execute("DELETE FROM identities WHERE provider='GOOGLE' AND provider_subject=?", [userId]);
    await pool.execute('DELETE FROM user_sessions WHERE user_id=?', [userId]);
    await pool.end();
  }
});
