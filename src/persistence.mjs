import { randomUUID } from 'node:crypto';

export function createMemoryPersistence() {
  const sessions = new Map();
  const proposals = new Map();
  return Object.freeze({
    kind: 'memory',
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
    }
  });
}

export function createTidbPersistence({ execute } = {}) {
  if (typeof execute !== 'function') throw namedError('tidb_execute_required');
  return Object.freeze({
    kind: 'tidb',
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
function namedError(code, statusCode = 400) { const error = new Error(code); error.code = code; error.statusCode = statusCode; return error; }
