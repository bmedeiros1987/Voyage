import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createTidbPersistence } from '../src/persistence.mjs';

const databaseUrl = process.env.VOYAGE_TEST_DATABASE_URL;

test('SQL ecosystem profile survives pool recreation and remains owner-scoped', { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, '/voyage_test', 'Only the disposable CI database is allowed');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));

  const { createPool } = await import('mysql2/promise');
  let pool = createPool(databaseUrl);
  const execute = (...args) => pool.execute(...args);
  execute.transaction = async (work) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work((...args) => connection.execute(...args));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };

  const globalUserId = `gid_sql_${randomUUID().replaceAll('-', '')}`;
  const otherUserId = `gid_sql_${randomUUID().replaceAll('-', '')}`;

  try {
    const sql = (await readFile(new URL('../db/007_ecosystem_identity_entitlements.sql', import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
    for (const statement of sql.split(';').filter((part) => part.trim())) await pool.query(statement);

    let store = createTidbPersistence({ execute });
    await store.putMembership({
      globalUserId,
      product: 'CREWCHECK',
      active: true,
      seen: true,
      verifiedByProduct: true,
      productAccountId: 'synthetic-crew-account',
      crewRole: 'CABIN_CREW'
    });
    await assert.rejects(
      () => store.putMembership({
        globalUserId: otherUserId,
        product: 'CREWCHECK',
        active: true,
        seen: true,
        verifiedByProduct: true,
        productAccountId: 'synthetic-crew-account',
        crewRole: 'CABIN_CREW'
      }),
      (error) => {
        assert.equal(error.code, 'product_account_owner_mismatch');
        assert.equal(error.statusCode, 409);
        return true;
      }
    );

    await assert.rejects(
      () => pool.execute(
        `INSERT INTO ecosystem_memberships (global_user_id,product,state,verified_by_product,product_account_id,crew_role,linked_at,deleted_at)
         VALUES (?, 'CREWCHECK', 'ACTIVE', TRUE, 'synthetic-crew-account', 'CABIN_CREW', NULL, NULL)`,
        [otherUserId]
      ),
      (error) => error?.code === 'ER_DUP_ENTRY'
    );

    await store.putSubscription({ globalUserId, product: 'VOYAGE', state: 'ACTIVE', source: 'TEST' });
    await store.setConsent(globalUserId, 'CREWCHECK_VOYAGE_CONNECTION', true, { source: 'TEST' });

    await pool.end();
    pool = createPool(databaseUrl);
    store = createTidbPersistence({ execute });

    const restored = await store.getEcosystemProfile(globalUserId);
    assert.equal(restored.memberships.length, 1);
    assert.equal(restored.memberships[0].product, 'CREWCHECK');
    assert.equal(restored.memberships[0].active, true);
    assert.equal(restored.subscriptions.length, 1);
    assert.equal(restored.subscriptions[0].product, 'VOYAGE');
    assert.equal(restored.consents.length, 1);
    assert.equal(restored.consents[0].granted, true);

    assert.deepEqual(await store.getEcosystemProfile(otherUserId), {
      memberships: [],
      subscriptions: [],
      consents: []
    });
  } finally {
    await pool.execute('DELETE FROM user_consents WHERE global_user_id=?', [globalUserId]);
    await pool.execute('DELETE FROM product_subscriptions WHERE global_user_id=?', [globalUserId]);
    await pool.execute('DELETE FROM ecosystem_memberships WHERE global_user_id IN (?,?)', [globalUserId, otherUserId]);
    await pool.execute('DELETE FROM ecosystem_identities WHERE global_user_id IN (?,?)', [globalUserId, otherUserId]);
    await pool.end();
  }
});
