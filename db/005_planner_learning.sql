-- Voyage by CrewCheck — Planner Brain learning and explainability
-- Additive TiDB/MySQL-compatible migration.

CREATE TABLE IF NOT EXISTS planner_preference_events (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  trip_id CHAR(36) NULL,
  source VARCHAR(48) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  dimension VARCHAR(80) NOT NULL,
  value_json JSON NULL,
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0.5000,
  explicit_user_choice BOOLEAN NOT NULL DEFAULT FALSE,
  reversible BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_by_event_id CHAR(36) NULL,
  expires_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_planner_pref_user_dimension (user_id, dimension, created_at),
  KEY idx_planner_pref_trip (trip_id, created_at)
);

CREATE TABLE IF NOT EXISTS trip_plan_decisions (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  plan_version_id CHAR(36) NOT NULL,
  decision_type VARCHAR(80) NOT NULL,
  target_item_id CHAR(36) NULL,
  input_snapshot JSON NULL,
  selected_option JSON NULL,
  alternatives_snapshot JSON NULL,
  rationale JSON NOT NULL,
  confidence DECIMAL(5,4) NULL,
  provenance JSON NULL,
  reversible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_plan_decisions_version (plan_version_id, created_at),
  KEY idx_plan_decisions_trip (trip_id, created_at)
);

CREATE TABLE IF NOT EXISTS trip_replan_events (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  from_plan_version_id CHAR(36) NOT NULL,
  to_plan_version_id CHAR(36) NULL,
  trigger_type VARCHAR(64) NOT NULL,
  trigger_source VARCHAR(80) NULL,
  trigger_payload JSON NULL,
  preserved_locked_items JSON NULL,
  changed_items JSON NULL,
  explanation JSON NULL,
  scope VARCHAR(32) NOT NULL DEFAULT 'LOCAL',
  status VARCHAR(24) NOT NULL DEFAULT 'PROPOSED',
  accepted_by_user BOOLEAN NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at TIMESTAMP(3) NULL,
  KEY idx_replan_trip (trip_id, created_at),
  KEY idx_replan_status (status, created_at)
);

CREATE TABLE IF NOT EXISTS trip_place_feedback (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  trip_id CHAR(36) NOT NULL,
  plan_item_id CHAR(36) NULL,
  place_key VARCHAR(512) NOT NULL,
  feedback_type VARCHAR(48) NOT NULL,
  rating DECIMAL(3,2) NULL,
  structured_tags JSON NULL,
  note TEXT NULL,
  observed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_place_feedback_user (user_id, created_at),
  KEY idx_place_feedback_place (place_key, created_at),
  KEY idx_place_feedback_trip (trip_id, created_at)
);
