-- Voyage by CrewCheck — initial TiDB schema
-- Target database: voyage
-- Business rules remain in services; no triggers or stored procedures.

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(320) NULL,
  display_name VARCHAR(160) NULL,
  avatar_url TEXT NULL,
  locale VARCHAR(20) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_users_email (email)
);

CREATE TABLE IF NOT EXISTS identities (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  provider_email VARCHAR(320) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_identity_provider_subject (provider, provider_subject),
  KEY idx_identities_user (user_id)
);

CREATE TABLE IF NOT EXISTS product_memberships (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  product VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_membership (user_id, product)
);

CREATE TABLE IF NOT EXISTS google_connections (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  google_subject VARCHAR(255) NOT NULL,
  encrypted_refresh_token TEXT NULL,
  token_key_version VARCHAR(64) NULL,
  granted_scopes JSON NOT NULL,
  last_history_id VARCHAR(255) NULL,
  watch_expiration TIMESTAMP(3) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CONNECTED',
  connected_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_google_subject (google_subject),
  KEY idx_google_user (user_id)
);

CREATE TABLE IF NOT EXISTS oauth_consents (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  purpose VARCHAR(64) NOT NULL,
  scopes JSON NOT NULL,
  policy_version VARCHAR(64) NOT NULL,
  granted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at TIMESTAMP(3) NULL,
  KEY idx_oauth_user (user_id)
);

CREATE TABLE IF NOT EXISTS trips (
  id CHAR(36) PRIMARY KEY,
  owner_user_id CHAR(36) NOT NULL,
  title VARCHAR(180) NOT NULL,
  destination_summary VARCHAR(255) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PLANNING',
  cover_key VARCHAR(80) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_trips_owner_dates (owner_user_id, start_date, end_date)
);

CREATE TABLE IF NOT EXISTS trip_members (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  user_id CHAR(36) NULL,
  display_name VARCHAR(160) NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'TRAVELER',
  invitation_status VARCHAR(32) NOT NULL DEFAULT 'ACCEPTED',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_trip_members_trip (trip_id),
  KEY idx_trip_members_user (user_id)
);

CREATE TABLE IF NOT EXISTS trip_sources (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NULL,
  user_id CHAR(36) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_reference VARCHAR(512) NULL,
  provider VARCHAR(80) NULL,
  provenance JSON NULL,
  confidence DECIMAL(5,4) NULL,
  freshness_at TIMESTAMP(3) NULL,
  processed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_trip_source_ref (user_id, source_type, source_reference),
  KEY idx_trip_sources_trip (trip_id)
);

CREATE TABLE IF NOT EXISTS reservations (
  id CHAR(36) PRIMARY KEY,
  trip_id CHAR(36) NOT NULL,
  source_id CHAR(36) NULL,
  reservation_type VARCHAR(32) NOT NULL,
  provider VARCHAR(120) NULL,
  confirmation_code VARCHAR(120) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED',
  currency CHAR(3) NULL,
  total_amount DECIMAL(14,2) NULL,
  booked_at TIMESTAMP(3) NULL,
  raw_fingerprint VARCHAR(128) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_reservations_trip (trip_id),
  KEY idx_reservation_confirmation (provider, confirmation_code)
);

CREATE TABLE IF NOT EXISTS flight_segments (
  id CHAR(36) PRIMARY KEY,
  reservation_id CHAR(36) NOT NULL,
  marketing_carrier VARCHAR(8) NULL,
  flight_number VARCHAR(16) NULL,
  origin_iata CHAR(3) NOT NULL,
  destination_iata CHAR(3) NOT NULL,
  scheduled_departure TIMESTAMP(3) NULL,
  scheduled_arrival TIMESTAMP(3) NULL,
  departure_terminal VARCHAR(32) NULL,
  arrival_terminal VARCHAR(32) NULL,
  departure_gate VARCHAR(32) NULL,
  arrival_gate VARCHAR(32) NULL,
  status VARCHAR(32) NULL,
  provenance JSON NULL,
  freshness_at TIMESTAMP(3) NULL,
  KEY idx_flight_reservation (reservation_id),
  KEY idx_flight_route_time (origin_iata, destination_iata, scheduled_departure)
);

CREATE TABLE IF NOT EXISTS accommodations (
  id CHAR(36) PRIMARY KEY,
  reservation_id CHAR(36) NOT NULL,
  property_name VARCHAR(255) NOT NULL,
  address_text TEXT NULL,
  check_in TIMESTAMP(3) NULL,
  check_out TIMESTAMP(3) NULL,
  room_label VARCHAR(120) NULL,
  room_number VARCHAR(64) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  provenance JSON NULL,
  KEY idx_accommodation_reservation (reservation_id)
);

CREATE TABLE IF NOT EXISTS ground_transport (
  id CHAR(36) PRIMARY KEY,
  reservation_id CHAR(36) NOT NULL,
  transport_type VARCHAR(32) NOT NULL,
  provider VARCHAR(120) NULL,
  origin_text VARCHAR(255) NULL,
  destination_text VARCHAR(255) NULL,
  departure_at TIMESTAMP(3) NULL,
  arrival_at TIMESTAMP(3) NULL,
  provenance JSON NULL,
  KEY idx_ground_reservation (reservation_id)
);

CREATE TABLE IF NOT EXISTS activities (
  id CHAR(36) PRIMARY KEY,
  reservation_id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  venue VARCHAR(255) NULL,
  starts_at TIMESTAMP(3) NULL,
  ends_at TIMESTAMP(3) NULL,
  voucher_reference VARCHAR(255) NULL,
  provenance JSON NULL,
  KEY idx_activity_reservation (reservation_id)
);

CREATE TABLE IF NOT EXISTS travel_documents (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  trip_id CHAR(36) NULL,
  source_id CHAR(36) NULL,
  document_type VARCHAR(48) NOT NULL,
  mime_type VARCHAR(120) NULL,
  storage_reference VARCHAR(512) NULL,
  content_sha256 CHAR(64) NULL,
  retention_class VARCHAR(32) NOT NULL DEFAULT 'DERIVED_ONLY',
  extracted_facts JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  purged_at TIMESTAMP(3) NULL,
  KEY idx_document_user_trip (user_id, trip_id)
);

CREATE TABLE IF NOT EXISTS availability_profiles (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  user_type VARCHAR(32) NOT NULL DEFAULT 'PASSENGER',
  desired_days INT NOT NULL,
  max_days INT NOT NULL,
  optimization_priority VARCHAR(32) NOT NULL DEFAULT 'BALANCED',
  minimum_return_margin_hours INT NOT NULL DEFAULT 0,
  crewcheck_linked BOOLEAN NOT NULL DEFAULT FALSE,
  use_official_days_off_only BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_availability_user (user_id)
);

CREATE TABLE IF NOT EXISTS crew_availability (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'CREWCHECK_API',
  window_start TIMESTAMP(3) NOT NULL,
  window_end TIMESTAMP(3) NOT NULL,
  official_day_off BOOLEAN NOT NULL DEFAULT FALSE,
  preceding_duty_end TIMESTAMP(3) NULL,
  following_report_time TIMESTAMP(3) NULL,
  source_version VARCHAR(120) NULL,
  freshness_at TIMESTAMP(3) NOT NULL,
  provenance JSON NULL,
  KEY idx_crew_window (user_id, window_start, window_end)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  event_type VARCHAR(80) NOT NULL,
  subject_type VARCHAR(80) NULL,
  subject_id CHAR(36) NULL,
  metadata JSON NULL,
  occurred_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_user_time (user_id, occurred_at),
  KEY idx_audit_subject (subject_type, subject_id)
);
