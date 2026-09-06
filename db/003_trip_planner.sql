-- Voyage by CrewCheck — Automatic Trip Planner / collaborative planning
-- Additive TiDB/MySQL-compatible migration.

CREATE TABLE IF NOT EXISTS planner_profiles (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL DEFAULT 'Preferências de viagem',
  user_type VARCHAR(32) NOT NULL DEFAULT 'PASSENGER',
  pace VARCHAR(24) NOT NULL DEFAULT 'BALANCED',
  breakfast_mode VARCHAR(24) NOT NULL DEFAULT 'FLEXIBLE',
  hotel_breakfast_included BOOLEAN NULL,
  meal_windows JSON NULL,
  dietary_preferences JSON NULL,
  preferred_activity_types JSON NULL,
  avoided_activity_types JSON NULL,
  interest_tags JSON NULL,
  accessibility_needs JSON NULL,
  work_preferences JSON NULL,
  fitness_preferences JSON NULL,
  budget_preferences JSON NULL,
  target_sleep_hours DECIMAL(4,2) NULL,
  minimum_transition_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  return_margin_hours SMALLINT UNSIGNED NOT NULL DEFAULT 2,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_planner_profiles_user (user_id, updated_at)
);

CREATE TABLE IF NOT EXISTS trip_plan_versions (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  created_by_user_id CHAR(36) NOT NULL,
  parent_version_id CHAR(36) NULL,
  version_number INT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  planner_mode VARCHAR(32) NOT NULL DEFAULT 'AUTOMATIC',
  optimization_priority VARCHAR(32) NOT NULL DEFAULT 'BALANCED',
  planner_profile_snapshot JSON NOT NULL,
  source_snapshot JSON NULL,
  objective_snapshot JSON NULL,
  generated_at TIMESTAMP(3) NULL,
  approved_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_trip_plan_version_number (trip_id, version_number),
  KEY idx_trip_plan_versions_status (trip_id, status, created_at)
);

CREATE TABLE IF NOT EXISTS trip_plan_items (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  plan_version_id CHAR(36) NOT NULL,
  source_reservation_id CHAR(36) NULL,
  place_reference VARCHAR(512) NULL,
  item_type VARCHAR(48) NOT NULL,
  title VARCHAR(255) NOT NULL,
  starts_at TIMESTAMP(3) NULL,
  ends_at TIMESTAMP(3) NULL,
  local_date DATE NULL,
  time_zone VARCHAR(100) NULL,
  address VARCHAR(512) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  duration_minutes SMALLINT UNSIGNED NULL,
  travel_from_previous_minutes SMALLINT UNSIGNED NULL,
  distance_from_previous_meters INT UNSIGNED NULL,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  planner_score DECIMAL(8,4) NULL,
  rationale JSON NULL,
  provenance JSON NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_trip_plan_items_version (plan_version_id, local_date, sort_order),
  KEY idx_trip_plan_items_reservation (source_reservation_id)
);

CREATE TABLE IF NOT EXISTS trip_collaborators (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  invited_by_user_id CHAR(36) NOT NULL,
  role VARCHAR(24) NOT NULL DEFAULT 'VIEWER',
  status VARCHAR(24) NOT NULL DEFAULT 'INVITED',
  joined_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_trip_collaborator_user (trip_id, user_id),
  KEY idx_trip_collaborators_status (trip_id, status)
);

CREATE TABLE IF NOT EXISTS trip_plan_proposals (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  plan_version_id CHAR(36) NOT NULL,
  proposed_by_user_id CHAR(36) NOT NULL,
  proposal_type VARCHAR(48) NOT NULL,
  target_item_id CHAR(36) NULL,
  payload JSON NOT NULL,
  rationale TEXT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  decided_by_user_id CHAR(36) NULL,
  decided_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_trip_plan_proposals_open (trip_id, status, created_at),
  KEY idx_trip_plan_proposals_version (plan_version_id)
);

CREATE TABLE IF NOT EXISTS trip_plan_comments (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  plan_version_id CHAR(36) NOT NULL,
  plan_item_id CHAR(36) NULL,
  proposal_id CHAR(36) NULL,
  user_id CHAR(36) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  edited_at TIMESTAMP(3) NULL,
  deleted_at TIMESTAMP(3) NULL,
  KEY idx_trip_plan_comments_version (plan_version_id, created_at),
  KEY idx_trip_plan_comments_item (plan_item_id, created_at)
);

CREATE TABLE IF NOT EXISTS trip_plan_votes (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  proposal_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  vote VARCHAR(16) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_trip_plan_vote_user (proposal_id, user_id),
  KEY idx_trip_plan_votes_trip (trip_id, proposal_id)
);

CREATE TABLE IF NOT EXISTS external_itinerary_imports (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  trip_id CHAR(36) NULL,
  source_type VARCHAR(48) NOT NULL,
  source_url VARCHAR(2000) NULL,
  file_name VARCHAR(255) NULL,
  content_sha256 CHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
  detected_items_count INT UNSIGNED NOT NULL DEFAULT 0,
  normalized_payload JSON NULL,
  error_code VARCHAR(120) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at TIMESTAMP(3) NULL,
  KEY idx_external_itinerary_user (user_id, created_at),
  KEY idx_external_itinerary_trip (trip_id, created_at)
);

CREATE TABLE IF NOT EXISTS place_community_signals (
  id CHAR(36) PRIMARY KEY,
  place_key VARCHAR(512) NOT NULL,
  provider VARCHAR(80) NOT NULL,
  provider_place_id VARCHAR(255) NULL,
  aggregate_rating DECIMAL(4,2) NULL,
  rating_count INT UNSIGNED NOT NULL DEFAULT 0,
  voyage_rating DECIMAL(4,2) NULL,
  voyage_rating_count INT UNSIGNED NOT NULL DEFAULT 0,
  structured_tags JSON NULL,
  provenance JSON NOT NULL,
  freshness_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_place_signal_provider (place_key, provider),
  KEY idx_place_signal_freshness (freshness_at)
);

CREATE TABLE IF NOT EXISTS planner_export_jobs (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  trip_id CHAR(36) NOT NULL,
  plan_version_id CHAR(36) NOT NULL,
  format VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
  options JSON NULL,
  storage_reference VARCHAR(512) NULL,
  content_sha256 CHAR(64) NULL,
  error_code VARCHAR(120) NULL,
  expires_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at TIMESTAMP(3) NULL,
  KEY idx_planner_exports_trip (trip_id, created_at),
  KEY idx_planner_exports_status (status, created_at)
);
