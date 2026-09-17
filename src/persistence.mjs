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
            // mysql2 normalizes the TLS options in place, so hand it a mutable
            // copy: the canonical config stays frozen and unforgeable.
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
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw namedError('tidb_database_url_invalid', 503);
  }

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

async function defaultMysqlDriverLoader() {
  return import('mysql2/promise');
}

export function createMemoryPersistence() {
  const sessions = new Map();
  const proposals = new Map();
  const users = new Map();
  const identities = new Map();
  const googleConnections = new Map();
  const oauthConsents = new Map();

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
    async upsertGoogleIdentity(input) {
      const identity = normalizeGoogleIdentityInput(input);
      const identityKey = `GOOGLE:${identity.googleSubject}`;
      const existingIdentity = identities.get(identityKey);
      if (existingIdentity) {
        const current = users.get(existingIdentity.userId);
        const next = {
          ...current,
          email: identity.email || current?.email || null,
          displayName: identity.displayName || current?.displayName || null,
          avatarUrl: identity.avatarUrl || current?.avatarUrl || null
        };
        users.set(existingIdentity.userId, next);
        identities.set(identityKey, {
          ...existingIdentity,
          providerEmail: identity.email || existingIdentity.providerEmail || null
        });
        return structuredClone({ userId: existingIdentity.userId, ...next });
      }
      if (identity.email) {
        const collision = [...users.values()].find((user) => user.email && user.email.toLowerCase() === identity.email.toLowerCase());
        if (collision) throw namedError('identity_link_confirmation_required', 409);
      }
      const userId = randomUUID();
      const user = {
        userId,
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl
      };
      users.set(userId, user);
      identities.set(identityKey, {
        userId,
        provider: 'GOOGLE',
        providerSubject: identity.googleSubject,
        providerEmail: identity.email
      });
      return structuredClone(user);
    },
    async upsertGoogleConnection(input) {
      const connection = normalizeGoogleConnectionInput(input);
      const existing = googleConnections.get(connection.googleSubject);
      if (existing && existing.userId !== connection.userId) throw namedError('google_connection_owner_mismatch', 409);
      const encryptedRefreshToken = connection.encryptedRefreshToken || existing?.encryptedRefreshToken || null;
      const tokenKeyVersion = connection.tokenKeyVersion || existing?.tokenKeyVersion || null;
      if (!encryptedRefreshToken) throw namedError('google_refresh_token_required', 409);
      const next = {
        userId: connection.userId,
        googleSubject: connection.googleSubject,
        encryptedRefreshToken,
        tokenKeyVersion,
        grantedScopes: connection.grantedScopes,
        status: 'CONNECTED',
        connectedAt: existing?.connectedAt || new Date().toISOString(),
        revokedAt: null
      };
      googleConnections.set(connection.googleSubject, next);
      return structuredClone(next);
    },
    async getGoogleConnectionByUserId(userId) {
      requireId(userId, 'google_connection_user_required');
      const match = [...googleConnections.values()].find((entry) => entry.userId === userId && entry.status === 'CONNECTED' && !entry.revokedAt);
      return match ? structuredClone(match) : null;
    },
    async recordOAuthConsent(input) {
      const consent = normalizeOAuthConsentInput(input);
      const record = {
        id: randomUUID(),
        ...consent,
        grantedAt: new Date().toISOString(),
        revokedAt: null
      };
      oauthConsents.set(record.id, record);
      return structuredClone(record);
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
      const [result] = await execute(
        'UPDATE user_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL',
        [toSqlDate(revokedAt), sessionId]
      );
      return Number(result?.affectedRows || 0) > 0;
    },
    async upsertGoogleIdentity(input) {
      const identity = normalizeGoogleIdentityInput(input);
      const [existingRows] = await execute(
        `SELECT i.user_id AS userId,u.email,u.display_name AS displayName,u.avatar_url AS avatarUrl
           FROM identities i JOIN users u ON u.id=i.user_id
          WHERE i.provider='GOOGLE' AND i.provider_subject=? LIMIT 1`,
        [identity.googleSubject]
      );
      if (Array.isArray(existingRows) && existingRows[0]) {
        const row = existingRows[0];
        await execute(
          'UPDATE users SET email=COALESCE(?,email), display_name=COALESCE(?,display_name), avatar_url=COALESCE(?,avatar_url) WHERE id=?',
          [identity.email, identity.displayName, identity.avatarUrl, row.userId]
        );
        await execute(
          `UPDATE identities SET provider_email=COALESCE(?,provider_email) WHERE provider='GOOGLE' AND provider_subject=?`,
          [identity.email, identity.googleSubject]
        );
        return {
          userId: String(row.userId),
          email: identity.email || row.email || null,
          displayName: identity.displayName || row.displayName || null,
          avatarUrl: identity.avatarUrl || row.avatarUrl || null
        };
      }
      if (identity.email) {
        const [emailRows] = await execute('SELECT id FROM users WHERE email=? LIMIT 1', [identity.email]);
        if (Array.isArray(emailRows) && emailRows[0]) throw namedError('identity_link_confirmation_required', 409);
      }
      const userId = randomUUID();
      await execute(
        'INSERT INTO users (id,email,display_name,avatar_url) VALUES (?,?,?,?)',
        [userId, identity.email, identity.displayName, identity.avatarUrl]
      );
      await execute(
        `INSERT INTO identities (id,user_id,provider,provider_subject,provider_email) VALUES (?,?,'GOOGLE',?,?)`,
        [randomUUID(), userId, identity.googleSubject, identity.email]
      );
      return {
        userId,
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl
      };
    },
    async upsertGoogleConnection(input) {
      const connection = normalizeGoogleConnectionInput(input);
      const [rows] = await execute(
        `SELECT user_id AS userId,encrypted_refresh_token AS encryptedRefreshToken,token_key_version AS tokenKeyVersion,connected_at AS connectedAt
           FROM google_connections WHERE google_subject=? LIMIT 1`,
        [connection.googleSubject]
      );
      const existing = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (existing && String(existing.userId) !== connection.userId) throw namedError('google_connection_owner_mismatch', 409);
      const encryptedRefreshToken = connection.encryptedRefreshToken || existing?.encryptedRefreshToken || null;
      const tokenKeyVersion = connection.tokenKeyVersion || existing?.tokenKeyVersion || null;
      if (!encryptedRefreshToken) throw namedError('google_refresh_token_required', 409);
      if (existing) {
        await execute(
          `UPDATE google_connections
              SET encrypted_refresh_token=?, token_key_version=?, granted_scopes=?, status='CONNECTED', revoked_at=NULL
            WHERE google_subject=?`,
          [encryptedRefreshToken, tokenKeyVersion, JSON.stringify(connection.grantedScopes), connection.googleSubject]
        );
      } else {
        await execute(
          `INSERT INTO google_connections (id,user_id,google_subject,encrypted_refresh_token,token_key_version,granted_scopes,status)
           VALUES (?,?,?,?,?,?,'CONNECTED')`,
          [randomUUID(), connection.userId, connection.googleSubject, encryptedRefreshToken, tokenKeyVersion, JSON.stringify(connection.grantedScopes)]
        );
      }
      return {
        userId: connection.userId,
        googleSubject: connection.googleSubject,
        encryptedRefreshToken,
        tokenKeyVersion,
        grantedScopes: connection.grantedScopes,
        status: 'CONNECTED'
      };
    },
    async getGoogleConnectionByUserId(userId) {
      requireId(userId, 'google_connection_user_required');
      const [rows] = await execute(
        `SELECT user_id AS userId,google_subject AS googleSubject,encrypted_refresh_token AS encryptedRefreshToken,token_key_version AS tokenKeyVersion,granted_scopes AS grantedScopes,status,connected_at AS connectedAt,revoked_at AS revokedAt
           FROM google_connections WHERE user_id=? AND status='CONNECTED' AND revoked_at IS NULL ORDER BY connected_at DESC LIMIT 1`,
        [userId]
      );
      return Array.isArray(rows) && rows[0] ? normalizeDbGoogleConnection(rows[0]) : null;
    },
    async recordOAuthConsent(input) {
      const consent = normalizeOAuthConsentInput(input);
      const record = {
        id: randomUUID(),
        ...consent,
        grantedAt: new Date().toISOString(),
        revokedAt: null
      };
      await execute(
        `INSERT INTO oauth_consents (id,user_id,provider,purpose,scopes,policy_version,granted_at,revoked_at)
         VALUES (?,?,?,?,?,?,?,NULL)`,
        [record.id, record.userId, record.provider, record.purpose, JSON.stringify(record.scopes), record.policyVersion, toSqlDate(record.grantedAt)]
      );
      return record;
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
        `SELECT id,trip_id AS tripId,created_by_user_id AS createdByUserId,base_version AS baseVersion,proposal_version AS version,status,changes_json AS changesJson,created_at AS createdAt,expires_at AS expiresAt,approved_by_user_id AS approvedByUserId,approved_at AS approvedAt
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

function normalizeGoogleIdentityInput(input = {}) {
  requireId(input.googleSubject, 'google_subject_required');
  const email = input.email ? String(input.email).trim().toLowerCase().slice(0, 320) : null;
  return {
    googleSubject: String(input.googleSubject),
    email,
    emailVerified: input.emailVerified === true,
    displayName: input.displayName ? String(input.displayName).trim().slice(0, 160) : null,
    avatarUrl: input.avatarUrl ? String(input.avatarUrl).trim().slice(0, 2048) : null
  };
}

function normalizeGoogleConnectionInput(input = {}) {
  requireId(input.userId, 'google_connection_user_required');
  requireId(input.googleSubject, 'google_subject_required');
  const scopes = [...new Set(
    (Array.isArray(input.grantedScopes) ? input.grantedScopes : []).map(String).filter(Boolean)
  )].slice(0, 50);
  if (!scopes.length) throw namedError('google_scopes_required');
  return {
    userId: String(input.userId),
    googleSubject: String(input.googleSubject),
    encryptedRefreshToken: input.encryptedRefreshToken ? String(input.encryptedRefreshToken) : null,
    tokenKeyVersion: input.tokenKeyVersion ? String(input.tokenKeyVersion).slice(0, 64) : null,
    grantedScopes: scopes
  };
}

function normalizeOAuthConsentInput(input = {}) {
  requireId(input.userId, 'oauth_consent_user_required');
  const provider = String(input.provider || '').toUpperCase();
  if (!provider || provider.length > 32) throw namedError('oauth_consent_provider_required');
  const purpose = String(input.purpose || '').toUpperCase();
  if (!purpose || purpose.length > 64) throw namedError('oauth_consent_purpose_required');
  const scopes = [...new Set(
    (Array.isArray(input.scopes) ? input.scopes : []).map(String).filter(Boolean)
  )].slice(0, 50);
  if (!scopes.length) throw namedError('oauth_consent_scopes_required');
  const policyVersion = String(input.policyVersion || '').trim();
  if (!policyVersion || policyVersion.length > 64) throw namedError('oauth_consent_policy_required');
  return {
    userId: String(input.userId),
    provider,
    purpose,
    scopes,
    policyVersion
  };
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
    id: String(row.id),
    userId: String(row.userId),
    tokenFingerprint: String(row.tokenFingerprint),
    issuedAt: new Date(row.issuedAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
    revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null
  };
}

function normalizeDbGoogleConnection(row) {
  let grantedScopes = row.grantedScopes;
  if (typeof grantedScopes === 'string') {
    try {
      grantedScopes = JSON.parse(grantedScopes);
    } catch {
      grantedScopes = [];
    }
  }
  return {
    userId: String(row.userId),
    googleSubject: String(row.googleSubject),
    encryptedRefreshToken: row.encryptedRefreshToken ? String(row.encryptedRefreshToken) : null,
    tokenKeyVersion: row.tokenKeyVersion ? String(row.tokenKeyVersion) : null,
    grantedScopes: Array.isArray(grantedScopes) ? grantedScopes.map(String) : [],
    status: String(row.status || 'CONNECTED'),
    connectedAt: row.connectedAt ? new Date(row.connectedAt).toISOString() : null,
    revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : null
  };
}

function normalizeDbProposal(row) {
  let changes = row.changesJson;
  if (typeof changes === 'string') {
    try {
      changes = JSON.parse(changes);
    } catch {
      throw namedError('proposal_changes_corrupt', 500);
    }
  }
  return {
    id: String(row.id),
    tripId: String(row.tripId),
    createdByUserId: String(row.createdByUserId),
    baseVersion: Number(row.baseVersion),
    version: Number(row.version),
    status: String(row.status),
    changes,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
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

function toSqlDate(value) {
  return normalizeIso(value).slice(0, 23).replace('T', ' ');
}

function nullableSqlDate(value) {
  return value ? toSqlDate(value) : null;
}

function namedError(code, statusCode = 400, cause) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
