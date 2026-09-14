-- Voyage by CrewCheck — Dietary Safety
-- Additive TiDB/MySQL-compatible migration.

CREATE TABLE IF NOT EXISTS dietary_profiles (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  profile_version INT UNSIGNED NOT NULL DEFAULT 1,
  avoids_cross_contact BOOLEAN NOT NULL DEFAULT FALSE,
  requires_staff_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  emergency_note_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  preferred_cuisines JSON NULL,
  avoided_cuisines JSON NULL,
  free_text_note TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_dietary_profile_user (user_id)
);

CREATE TABLE IF NOT EXISTS dietary_restrictions (
  id CHAR(36) PRIMARY KEY,
  dietary_profile_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  restriction_code VARCHAR(80) NOT NULL,
  display_label VARCHAR(120) NULL,
  severity VARCHAR(32) NOT NULL,
  notes VARCHAR(500) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_dietary_restriction_profile_code (dietary_profile_id, restriction_code),
  KEY idx_dietary_restriction_user_active (user_id, active)
);

CREATE TABLE IF NOT EXISTS venue_dietary_evidence (
  id CHAR(36) PRIMARY KEY,
  venue_reference VARCHAR(255) NOT NULL,
  provider VARCHAR(120) NULL,
  restriction_code VARCHAR(80) NOT NULL,
  status VARCHAR(32) NOT NULL,
  cross_contact_status VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
  confidence VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
  source_reference VARCHAR(512) NULL,
  checked_at TIMESTAMP(3) NULL,
  expires_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_venue_dietary_lookup (venue_reference, restriction_code, checked_at),
  KEY idx_venue_dietary_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS trip_dietary_snapshots (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  dietary_profile_id CHAR(36) NULL,
  snapshot JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_trip_dietary_snapshot_trip (trip_id, created_at),
  KEY idx_trip_dietary_snapshot_user (user_id, trip_id)
);

CREATE TABLE IF NOT EXISTS meal_safety_checks (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  planner_item_id CHAR(36) NULL,
  venue_reference VARCHAR(255) NULL,
  user_id CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL,
  blockers JSON NULL,
  warnings JSON NULL,
  evidence_snapshot JSON NULL,
  checked_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_meal_safety_trip (trip_id, checked_at),
  KEY idx_meal_safety_user_status (user_id, status, checked_at)
);
