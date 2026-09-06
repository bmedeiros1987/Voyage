-- Voyage by CrewCheck — Universal Travel Importer
-- Idempotent additive migration for TiDB/MySQL-compatible deployments.

CREATE TABLE IF NOT EXISTS import_jobs (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  trip_id CHAR(36) NULL,
  source_type VARCHAR(32) NOT NULL,
  source_reference VARCHAR(512) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
  category_hint VARCHAR(48) NULL,
  detected_category VARCHAR(48) NULL,
  confidence DECIMAL(5,4) NULL,
  error_code VARCHAR(120) NULL,
  review_reasons JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at TIMESTAMP(3) NULL,
  KEY idx_import_jobs_user_status (user_id, status, created_at),
  KEY idx_import_jobs_trip (trip_id, created_at)
);

CREATE TABLE IF NOT EXISTS import_artifacts (
  id CHAR(36) PRIMARY KEY,
  import_job_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  file_name VARCHAR(255) NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT UNSIGNED NULL,
  content_sha256 CHAR(64) NOT NULL,
  storage_reference VARCHAR(512) NULL,
  retention_class VARCHAR(32) NOT NULL DEFAULT 'DERIVED_ONLY',
  extraction_method VARCHAR(80) NULL,
  encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  extracted_text_preview TEXT NULL,
  warnings JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  purged_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_import_artifact_user_digest (user_id, content_sha256),
  KEY idx_import_artifact_job (import_job_id)
);

CREATE TABLE IF NOT EXISTS travel_facts (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  trip_id CHAR(36) NULL,
  import_job_id CHAR(36) NULL,
  reservation_id CHAR(36) NULL,
  fact_type VARCHAR(96) NOT NULL,
  fact_value JSON NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  provenance JSON NOT NULL,
  freshness_at TIMESTAMP(3) NOT NULL,
  superseded_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_travel_facts_trip_type (trip_id, fact_type, freshness_at),
  KEY idx_travel_facts_import (import_job_id),
  KEY idx_travel_facts_reservation (reservation_id)
);

CREATE TABLE IF NOT EXISTS gmail_message_index (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  google_connection_id CHAR(36) NOT NULL,
  gmail_message_id VARCHAR(255) NOT NULL,
  gmail_thread_id VARCHAR(255) NULL,
  internal_date TIMESTAMP(3) NULL,
  sender_domain VARCHAR(255) NULL,
  subject_fingerprint CHAR(64) NULL,
  candidate_category VARCHAR(48) NULL,
  candidate_confidence DECIMAL(5,4) NULL,
  attachment_digests JSON NULL,
  processing_status VARCHAR(32) NOT NULL DEFAULT 'DISCOVERED',
  last_processed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_gmail_message_user (user_id, gmail_message_id),
  KEY idx_gmail_processing (google_connection_id, processing_status, internal_date)
);

CREATE TABLE IF NOT EXISTS gmail_watch_state (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  google_connection_id CHAR(36) NOT NULL,
  last_history_id VARCHAR(255) NULL,
  watch_expiration TIMESTAMP(3) NULL,
  last_successful_sync_at TIMESTAMP(3) NULL,
  continuity_status VARCHAR(32) NOT NULL DEFAULT 'UNINITIALIZED',
  last_error_code VARCHAR(120) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_gmail_watch_connection (google_connection_id),
  KEY idx_gmail_watch_expiration (watch_expiration)
);

CREATE TABLE IF NOT EXISTS reservation_links (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  trip_id CHAR(36) NULL,
  left_reservation_id CHAR(36) NOT NULL,
  right_reservation_id CHAR(36) NOT NULL,
  relation_type VARCHAR(48) NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  evidence JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_reservation_link_pair (left_reservation_id, right_reservation_id, relation_type),
  KEY idx_reservation_links_trip (trip_id)
);
