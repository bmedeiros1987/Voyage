-- Additive; raw PDFs are not retained. Original extraction and user-confirmed
-- facts remain distinct, with provenance, in the immutable journey snapshot.
CREATE TABLE IF NOT EXISTS voyage_imports (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_voyage_import_owner (user_id, created_at)
);
CREATE TABLE IF NOT EXISTS voyage_journeys (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  import_id CHAR(36) NOT NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_voyage_journey_import (user_id, import_id),
  KEY idx_voyage_journey_owner (user_id, created_at)
);
