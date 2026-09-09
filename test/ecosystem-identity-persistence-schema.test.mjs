import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../db/007_ecosystem_identity_entitlements.sql', import.meta.url);

async function migrationSql() {
  return readFile(migrationUrl, 'utf8');
}

test('ecosystem identity migration persists the shared human identity and product memberships', async () => {
  const sql = await migrationSql();
  for (const table of [
    'ecosystem_identities',
    'ecosystem_memberships',
    'auth_provider_links',
    'user_consents',
    'product_subscriptions',
    'user_entitlements'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(sql, /global_user_id VARCHAR\(64\) NOT NULL/);
});

test('provider linking is independent from Gmail authorization and proposals stay canonical', async () => {
  const sql = await migrationSql();
  assert.match(sql, /Gmail OAuth grants remain separate provider authorization records/);
  assert.match(sql, /itinerary proposals remain canonical in itinerary_proposals/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS voyage_proposals\b/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS user_sessions\b/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS itinerary_proposals\b/);
});

test('subscriptions and entitlements do not encode cross-product consent implicitly', async () => {
  const sql = await migrationSql();
  assert.match(sql, /subscriptions\/entitlements never imply cross-product consent/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_consents\b/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_entitlements\b/);
});
