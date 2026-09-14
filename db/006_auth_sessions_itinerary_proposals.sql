-- Authenticated Voyage sessions and explicit itinerary proposal approval.
-- Tokens themselves are never stored; only SHA-256 fingerprints are persisted.

CREATE TABLE IF NOT EXISTS user_sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_fingerprint CHAR(64) NOT NULL,
  issued_at TIMESTAMP(3) NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  revoked_at TIMESTAMP(3) NULL,
  last_seen_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_session_fingerprint (token_fingerprint),
  KEY idx_sessions_user_expiry (user_id, expires_at),
  KEY idx_sessions_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS itinerary_proposals (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  created_by_user_id CHAR(36) NOT NULL,
  base_version BIGINT UNSIGNED NOT NULL,
  proposal_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  changes_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL,
  expires_at TIMESTAMP(3) NULL,
  approved_by_user_id CHAR(36) NULL,
  approved_at TIMESTAMP(3) NULL,
  applied_at TIMESTAMP(3) NULL,
  KEY idx_itinerary_proposal_trip_status (trip_id, status, created_at),
  KEY idx_itinerary_proposal_creator (created_by_user_id, created_at),
  KEY idx_itinerary_proposal_expiry (status, expires_at)
);
