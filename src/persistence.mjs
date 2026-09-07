// Persistence abstraction. The repository interface is what the rest of the app
// depends on; the in-memory driver backs tests and local runs, and a SQL driver
// binds the same interface to the existing TiDB schemas.
//
// Deliberately read/write only — no driver here issues DDL, DROP or TRUNCATE, so
// wiring this against a real database cannot destroy data.

const COLLECTIONS = Object.freeze([
  'identities', 'memberships', 'preferences', 'consents', 'subscriptions', 'entitlements', 'proposals'
]);

const FORBIDDEN_SQL = /\b(drop|truncate|alter|delete\s+from|create\s+table)\b/i;

export function persistenceCapabilities() {
  return Object.freeze({
    version: '1.0',
    collections: COLLECTIONS,
    drivers: ['memory', 'sql'],
    schemaFiles: [
      'db/001_initial.sql', 'db/002_universal_importer.sql', 'db/003_trip_planner.sql',
      'db/004_dietary_safety.sql', 'db/005_planner_learning.sql', 'db/006_identity_and_entitlements.sql'
    ],
    principles: [
      'The application depends on the repository interface, never on a concrete driver.',
      'No driver performs destructive DDL or DML; migrations are applied out of band.',
      'Every persisted row is scoped by globalUserId.'
    ]
  });
}

export function createMemoryRepository() {
  const tables = new Map(COLLECTIONS.map((name) => [name, new Map()]));

  const keyOf = (globalUserId, id) => `${globalUserId}::${id}`;

  return Object.freeze({
    driver: 'memory',
    async get(collection, globalUserId, id) {
      assertCollection(collection);
      return tables.get(collection).get(keyOf(globalUserId, id)) || null;
    },
    async put(collection, globalUserId, id, value) {
      assertCollection(collection);
      if (!globalUserId) throw namedError('persistence_global_user_id_required', 400);
      const record = Object.freeze({ ...value, globalUserId, id, updatedAt: new Date().toISOString() });
      tables.get(collection).set(keyOf(globalUserId, id), record);
      return record;
    },
    async list(collection, globalUserId) {
      assertCollection(collection);
      return [...tables.get(collection).values()].filter((row) => row.globalUserId === globalUserId);
    },
    async remove(collection, globalUserId, id) {
      assertCollection(collection);
      return tables.get(collection).delete(keyOf(globalUserId, id));
    }
  });
}

// `execute` is injected (a mysql2/TiDB connection's query method, for example) so
// this module never owns a socket and stays unit-testable.
export function createSqlRepository({ execute, tablePrefix = 'voyage_' } = {}) {
  if (typeof execute !== 'function') throw namedError('persistence_execute_required', 500);

  const table = (collection) => {
    assertCollection(collection);
    return `${tablePrefix}${collection}`;
  };

  const guard = (sql) => {
    if (FORBIDDEN_SQL.test(sql)) throw namedError('persistence_destructive_statement_blocked', 500);
    return sql;
  };

  return Object.freeze({
    driver: 'sql',
    async get(collection, globalUserId, id) {
      const rows = await execute(
        guard(`SELECT payload FROM ${table(collection)} WHERE global_user_id = ? AND id = ? LIMIT 1`),
        [globalUserId, id]
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      return row ? parsePayload(row.payload) : null;
    },
    async put(collection, globalUserId, id, value) {
      if (!globalUserId) throw namedError('persistence_global_user_id_required', 400);
      const record = { ...value, globalUserId, id, updatedAt: new Date().toISOString() };
      await execute(
        guard(`INSERT INTO ${table(collection)} (global_user_id, id, payload, updated_at)
               VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = VALUES(updated_at)`),
        [globalUserId, id, JSON.stringify(record), record.updatedAt]
      );
      return Object.freeze(record);
    },
    async list(collection, globalUserId) {
      const rows = await execute(
        guard(`SELECT payload FROM ${table(collection)} WHERE global_user_id = ?`),
        [globalUserId]
      );
      return (Array.isArray(rows) ? rows : []).map((row) => parsePayload(row.payload)).filter(Boolean);
    },
    async remove(collection, globalUserId, id) {
      // Soft delete: the row is tombstoned, never removed, so a driver bug cannot
      // destroy a user's history.
      await execute(
        guard(`UPDATE ${table(collection)} SET deleted_at = ? WHERE global_user_id = ? AND id = ?`),
        [new Date().toISOString(), globalUserId, id]
      );
      return true;
    }
  });
}

function parsePayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'object') return payload;
  try { return JSON.parse(String(payload)); } catch { return null; }
}

function assertCollection(collection) {
  if (!COLLECTIONS.includes(collection)) throw namedError('persistence_unknown_collection', 400);
}

function namedError(message, statusCode) {
  const error = new Error(message);
  error.code = message;
  error.statusCode = statusCode;
  return error;
}
