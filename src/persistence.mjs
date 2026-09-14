import { randomUUID } from 'node:crypto';

export function createRuntimePersistence({
  nodeEnv = 'development',
  databaseConfigured = false,
  databaseUrl = process.env.DATABASE_URL,
  execute,
  driverLoader
} = {}) {
  const environment = String(nodeEnv || 'development').trim().toLowerCase();
  if (databaseConfigured) {
    const resolvedExecute = typeof execute === 'function'
      ? execute
      : createMysqlTidbExecute({ databaseUrl, driverLoader });
    return createTidbPersistence({ execute: resolvedExecute });
  }
  if (environment === 'production') throw namedError('production_persistence_required', 503);
  return createMemoryPersistence();
}

export function createMysqlTidbExecute({ databaseUrl, driverLoader = defaultMysqlDriverLoader } = {}) {
  const config = parseTidbDatabaseUrl(databaseUrl);
  let poolPromise = null;

  return async function execute(sql, params = []) {
    if (!poolPromise) {
      poolPromise = Promise.resolve()
        .then(() => driverLoader())
        .then((module) => {
          const createPool = module?.createPool || module?.default?.createPool;
          if (typeof createPool !== 'function') throw namedError('tidb_driver_invalid', 503);
          return createPool({
            ...config,
            ssl: { ...config.ssl },
            waitForConnections: true,
            connectionLimit: 10,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0
          });
        })
        .catch((error) => {
          poolPromise = null;
          if (error?.code === 'tidb_driver_invalid') throw error;
          throw namedError('tidb_driver_unavailable', 503, error);
        });
    }

    const pool = await poolPromise;
    if (!pool || typeof pool.execute !== 'function') throw namedError('tidb_driver_invalid', 503);
    return pool.execute(sql, params);
  };
}

export function parseTidbDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) throw namedError('tidb_database_url_required', 503);

  let parsed;
  try { parsed = new URL(databaseUrl); }
  catch { throw namedError('tidb_database_url_invalid', 503); }

  if (!['mysql:', 'mysqls:'].includes(parsed.protocol)) throw namedError('tidb_database_url_invalid', 503);
  if (!parsed.hostname || !parsed.username) throw namedError('tidb_database_url_invalid', 503);

  const database = parsed.pathname.replace(/^\//, '').trim();
  if (!database) throw namedError('tidb_database_url_invalid', 503);

  return Object.freeze({
    host: parsed.hostname,
    port: Number(parsed.port || 4000),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password || ''),
    database,
    ssl: Object.freeze({ minVersion: 'TLSv1.2', rejectUnauthorized: true })
  });
}

async function defaultMysqlDriverLoader() { return import('mysql2/promise'); }

export function createMemoryPersistence() {
  const sessions = new Map();
  const proposals = new Map();
  const memberships = new Map();
  const subscriptions = new Map();
  const consents = new Map();

  return Object.freeze({
    kind: 'memory',
    durability: 'ephemeral',
    async putSession(session) {
      validateSessionRecord(session);
      sessions.set(session.id, structuredClone(session));
      return structuredClone(session);
    },
    async getSession(sessionId) {
      return sessions.has(sessionId) ? structuredClone(sessions.get(sessionId)) : null;
    },
    async revokeSession(sessionId, revokedAt = new Date().toISOString()) {
      const current = sessions.get(sessionId);
      if (!current) return false;
      sessions.set(sessionId, { ...current, revokedAt });
      return true;
    },
    async createProposal(proposal) {
      validateProposalRecord(proposal);
      if (proposals.has(proposal.id)) throw namedError('proposal_id_conflict', 409);
      proposals.set(proposal.id, structuredClone(proposal));
      return structuredClone(proposal);
    },
    async getProposal(proposalId) {
      return proposals.has(proposalId) ? structuredClone(proposals.get(proposalId)) : null;
    },
    async updateProposal(proposalId, updater) {
      const current = proposals.get(proposalId);
      if (!current) return null;
      const next = updater(structuredClone(current));
      validateProposalRecord(next);
      proposals.set(proposalId, structuredClone(next));
      return structuredClone(next);
    },
    async putMembership(input) {
      const record = normalizeEcosystemMembership(input);
      memberships.set(`${record.globalUserId}:${record.product}`, structuredClone(record));
      return structuredClone(record);
    },
    async putSubscription(input) {
      const record = normalizeProductSubscription(input);
      subscriptions.set(`${record.globalUserId}:${record.product}`, structuredClone(record));
      return structuredClone(record);
    },
    async setConsent(globalUserId, consentKey, granted, options = {}) {
      const record = normalizeConsent({ globalUserId, consentKey, granted, ...options });
      consents.set(`${record.globalUserId}:${record.consentKey}`, structuredClone(record));
      return structuredClone(record);
    },
    async getEcosystemProfile(globalUserId) {
      requireId(globalUserId, 'global_user_id_required');
      const byUser = (record) => record.globalUserId === globalUserId;
      return {
        memberships: [...memberships.values()].filter(byUser).map(membershipForIdentity),
        subscriptions: [...subscriptions.values()].filter(byUser).map(subscriptionForEntitlements),
        consents: [...consents.values()].filter(byUser).map((record) => structuredClone(record))
      };
    }
  });
}

export function createTidbPersistence({ execute } = {}) {
  if (typeof execute !== 'function') throw namedError('tidb_execute_required', 503);
  return Object.freeze({
    kind: 'tidb',
    durability: 'persistent',
    async putSession(session) {
      validateSessionRecord(session);
      await execute(
        `INSERT INTO user_sessions (id,user_id,token_fingerprint,issued_at,expires_at,revoked_at,last_seen_at)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE token_fingerprint=VALUES(token_fingerprint), expires_at=VALUES(expires_at), revoked_at=VALUES(revoked_at), last_seen_at=VALUES(last_seen_at)`,
        [session.id, session.userId, session.tokenFingerprint, toSqlDate(session.issuedAt), toSqlDate(session.expiresAt), nullableSqlDate(session.revokedAt), nullableSqlDate(session.lastSeenAt)]
      );
      return structuredClone(session);
    },
    async getSession(sessionId) {
      const [rows] = await execute(
        `SELECT id,user_id AS userId,token_fingerprint AS tokenFingerprint,issued_at AS issuedAt,expires_at AS expiresAt,revoked_at AS revokedAt,last_seen_at AS lastSeenAt
           FROM user_sessions WHERE id=? LIMIT 1`,
        [sessionId]
      );
      return Array.isArray(rows) && rows[0] ? normalizeDbSession(rows[0]) : null;
    },
    async revokeSession(sessionId, revokedAt = new Date().toISOString()) {
      const [result] = await execute('UPDATE user_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL', [toSqlDate(revokedAt), sessionId]);
      return Number(result?.affectedRows || 0) > 0;
    },
    async createProposal(proposal) {
      validateProposalRecord(proposal);
      await execute(
        `INSERT INTO itinerary_proposals (id,trip_id,created_by_user_id,base_version,proposal_version,status,changes_json,created_at,expires_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [proposal.id, proposal.tripId, proposal.createdByUserId, proposal.baseVersion, proposal.version, proposal.status, JSON.stringify(proposal.changes), toSqlDate(proposal.createdAt), nullableSqlDate(proposal.expiresAt)]
      );
      return structuredClone(proposal);
    },
    async getProposal(proposalId) {
      const [rows] = await execute(
        `SELECT id,trip_id AS tripId,created_by_user_id AS createdByUserId,base_version AS baseVersion,status,proposal_version AS version,changes_json AS changesJson,created_at AS createdAt,expires_at AS expiresAt,approved_by_user_id AS approvedByUserId,approved_at AS approvedAt
           FROM itinerary_proposals WHERE id=? LIMIT 1`,
        [proposalId]
      );
      return Array.isArray(rows) && rows[0] ? normalizeDbProposal(rows[0]) : null;
    },
    async updateProposal(proposalId, updater) {
      const current = await this.getProposal(proposalId);
      if (!current) return null;
      const next = updater(structuredClone(current));
      validateProposalRecord(next);
      const [result] = await execute(
        `UPDATE itinerary_proposals
            SET status=?, approved_by_user_id=?, approved_at=?
          WHERE id=? AND status=? AND proposal_version=?`,
        [next.status, next.approvedByUserId || null, nullableSqlDate(next.approvedAt), proposalId, current.status, current.version]
      );
      if (Number(result?.affectedRows || 0) !== 1) throw namedError('proposal_concurrent_update', 409);
      return next;
    },
    async putMembership(input) {
      const record = normalizeEcosystemMembership(input);
      await execute(
        `INSERT INTO ecosystem_identities (global_user_id) VALUES (?)
         ON DUPLICATE KEY UPDATE updated_at=CURRENT_TIMESTAMP(3), deleted_at=NULL`,
        [record.globalUserId]
      );
      await execute(
        `INSERT INTO ecosystem_memberships (global_user_id,product,state,verified_by_product,product_account_id,crew_role,linked_at,deleted_at)
         VALUES (?,?,?,?,?,?,?,NULL)
         ON DUPLICATE KEY UPDATE state=VALUES(state), verified_by_product=VALUES(verified_by_product), product_account_id=VALUES(product_account_id), crew_role=VALUES(crew_role), linked_at=VALUES(linked_at), updated_at=CURRENT_TIMESTAMP(3), deleted_at=NULL`,
        [record.globalUserId, record.product, record.state, record.verifiedByProduct, record.productAccountId, record.crewRole, nullableSqlDate(record.linkedAt)]
      );
      return structuredClone(record);
    },
    async putSubscription(input) {
      const record = normalizeProductSubscription(input);
      await execute(
        `INSERT INTO product_subscriptions (global_user_id,product,state,renews_at,source)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE state=VALUES(state), renews_at=VALUES(renews_at), source=VALUES(source), updated_at=CURRENT_TIMESTAMP(3)`,
        [record.globalUserId, record.product, record.state, nullableSqlDate(record.renewsAt), record.source]
      );
      return structuredClone(record);
    },
    async setConsent(globalUserId, consentKey, granted, options = {}) {
      const record = normalizeConsent({ globalUserId, consentKey, granted, ...options });
      await execute(
        `INSERT INTO user_consents (global_user_id,consent_key,granted,granted_at,revoked_at,source)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE granted=VALUES(granted), granted_at=VALUES(granted_at), revoked_at=VALUES(revoked_at), source=VALUES(source), updated_at=CURRENT_TIMESTAMP(3)`,
        [record.globalUserId, record.consentKey, record.granted, record.granted ? toSqlDate(record.updatedAt) : null, record.granted ? null : toSqlDate(record.updatedAt), record.source]
      );
      return structuredClone(record);
    },
    async getEcosystemProfile(globalUserId) {
      requireId(globalUserId, 'global_user_id_required');
      const [membershipRows] = await execute(
        `SELECT product,state,verified_by_product AS verifiedByProduct,product_account_id AS productAccountId,crew_role AS crewRole,linked_at AS linkedAt
           FROM ecosystem_memberships WHERE global_user_id=? AND deleted_at IS NULL`,
        [globalUserId]
      );
      const [subscriptionRows] = await execute(
        `SELECT product,state,renews_at AS renewsAt FROM product_subscriptions WHERE global_user_id=?`,
        [globalUserId]
      );
      const [consentRows] = await execute(
        `SELECT consent_key AS consentKey,granted,updated_at AS updatedAt,source FROM user_consents WHERE global_user_id=?`,
        [globalUserId]
      );
      return {
        memberships: (Array.isArray(membershipRows) ? membershipRows : []).map((row) => membershipForIdentity({
          globalUserId, product: row.product, state: row.state, verifiedByProduct: Boolean(row.verifiedByProduct),
          productAccountId: row.productAccountId || null, crewRole: row.crewRole || null,
          linkedAt: row.linkedAt ? new Date(row.linkedAt).toISOString() : null
        })),
        subscriptions: (Array.isArray(subscriptionRows) ? subscriptionRows : []).map((row) => ({
          product: String(row.product), state: String(row.state), renewsAt: row.renewsAt ? new Date(row.renewsAt).toISOString() : null
        })),
        consents: (Array.isArray(consentRows) ? consentRows : []).map((row) => ({
          consentKey: String(row.consentKey), granted: Boolean(row.granted),
          updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
          source: row.source ? String(row.source) : null
        }))
      };
    }
  });
}

export function newSessionRecord({ userId, tokenFingerprint, issuedAt, expiresAt, sessionId = randomUUID() } = {}) {
  const record = {
    id: sessionId,
    userId,
    tokenFingerprint,
    issuedAt: normalizeIso(issuedAt),
    expiresAt: normalizeIso(expiresAt),
    revokedAt: null,
    lastSeenAt: null
  };
  validateSessionRecord(record);
  return Object.freeze(record);
}

function normalizeEcosystemMembership(input = {}) {
  requireId(input.globalUserId, 'global_user_id_required');
  const product = String(input.product || '').toUpperCase();
  if (!['VOYAGE', 'CREWCHECK'].includes(product)) throw namedError('membership_product_invalid');
  const verifiedByProduct = input.verifiedByProduct === true;
  const active = verifiedByProduct && input.active === true;
  const seen = input.seen === true || verifiedByProduct;
  const state = active ? 'ACTIVE' : seen ? 'VISITOR' : 'NONE';
  return Object.freeze({
    globalUserId: String(input.globalUserId), product, state, active, seen, verifiedByProduct,
    productAccountId: input.productAccountId ? String(input.productAccountId).slice(0, 190) : null,
    crewRole: product === 'CREWCHECK' && active && input.crewRole ? String(input.crewRole).toUpperCase().slice(0, 40) : null,
    linkedAt: input.linkedAt ? normalizeIso(input.linkedAt) : null
  });
}

function membershipForIdentity(record) {
  return {
    product: record.product,
    active: record.state === 'ACTIVE',
    seen: record.state !== 'NONE',
    verifiedByProduct: record.verifiedByProduct === true,
    productAccountId: record.productAccountId || null,
    crewRole: record.crewRole || null,
    linkedAt: record.linkedAt || null
  };
}

function normalizeProductSubscription(input = {}) {
  requireId(input.globalUserId, 'global_user_id_required');
  const product = String(input.product || '').toUpperCase();
  const state = String(input.state || 'NONE').toUpperCase();
  if (!['VOYAGE', 'CREWCHECK'].includes(product)) throw namedError('subscription_product_invalid');
  if (!['ACTIVE', 'GRACE', 'EXPIRED', 'NONE'].includes(state)) throw namedError('subscription_state_invalid');
  return Object.freeze({
    globalUserId: String(input.globalUserId), product, state,
    renewsAt: input.renewsAt ? normalizeIso(input.renewsAt) : null,
    source: input.source ? String(input.source).slice(0, 64) : null
  });
}

function subscriptionForEntitlements(record) {
  return { product: record.product, state: record.state, renewsAt: record.renewsAt || null };
}

function normalizeConsent(input = {}) {
  requireId(input.globalUserId, 'global_user_id_required');
  requireId(input.consentKey, 'consent_key_required');
  if (typeof input.granted !== 'boolean') throw namedError('consent_granted_boolean_required');
  const updatedAt = input.changedAt ? normalizeIso(input.changedAt) : new Date().toISOString();
  return Object.freeze({
    globalUserId: String(input.globalUserId), consentKey: String(input.consentKey), granted: input.granted,
    updatedAt, source: input.source ? String(input.source).slice(0, 64) : null
  });
}

function validateSessionRecord(record) {
  requireId(record?.id, 'session_id_required');
  requireId(record?.userId, 'session_user_id_required');
  if (typeof record?.tokenFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(record.tokenFingerprint)) throw namedError('session_fingerprint_invalid');
  normalizeIso(record.issuedAt);
  normalizeIso(record.expiresAt);
}

function validateProposalRecord(record) {
  requireId(record?.id, 'proposal_id_required');
  requireId(record?.tripId, 'proposal_trip_id_required');
  requireId(record?.createdByUserId, 'proposal_user_id_required');
  if (!Number.isInteger(record?.baseVersion) || record.baseVersion < 0) throw namedError('proposal_base_version_invalid');
  if (!Number.isInteger(record?.version) || record.version < 1) throw namedError('proposal_version_invalid');
  if (!['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'APPLIED'].includes(record?.status)) throw namedError('proposal_status_invalid');
  if (!Array.isArray(record?.changes) || record.changes.length === 0 || record.changes.length > 500) throw namedError('proposal_changes_invalid');
  normalizeIso(record.createdAt);
}

function normalizeDbSession(row) {
  return {
    id: String(row.id), userId: String(row.userId), tokenFingerprint: String(row.tokenFingerprint),
    issuedAt: new Date(row.issuedAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString(),
    revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null
  };
}

function normalizeDbProposal(row) {
  let changes = row.changesJson;
  if (typeof changes === 'string') {
    try { changes = JSON.parse(changes); } catch { throw namedError('proposal_changes_corrupt', 500); }
  }
  return {
    id: String(row.id), tripId: String(row.tripId), createdByUserId: String(row.createdByUserId),
    baseVersion: Number(row.baseVersion), version: Number(row.version), status: String(row.status), changes,
    createdAt: new Date(row.createdAt).toISOString(), expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    approvedByUserId: row.approvedByUserId ? String(row.approvedByUserId) : null,
    approvedAt: row.approvedAt ? new Date(row.approvedAt).toISOString() : null
  };
}

function requireId(value, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw namedError(code);
}
function normalizeIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw namedError('timestamp_invalid');
  return date.toISOString();
}
function toSqlDate(value) { return normalizeIso(value).slice(0, 23).replace('T', ' '); }
function nullableSqlDate(value) { return value ? toSqlDate(value) : null; }
function namedError(code, statusCode = 400, cause) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
