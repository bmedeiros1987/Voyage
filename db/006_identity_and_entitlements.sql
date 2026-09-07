-- Voyage ecosystem identity, consent and entitlement storage.
-- Additive only: this migration creates new tables and never alters or drops
-- anything defined by 001..005.

CREATE TABLE IF NOT EXISTS voyage_identities (
  global_user_id VARCHAR(64) NOT NULL,
  id             VARCHAR(190) NOT NULL,
  payload        JSON NOT NULL,
  updated_at     DATETIME(3) NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (global_user_id, id)
);

CREATE TABLE IF NOT EXISTS voyage_memberships (
  global_user_id VARCHAR(64) NOT NULL,
  id             VARCHAR(190) NOT NULL,
  payload        JSON NOT NULL,
  updated_at     DATETIME(3) NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (global_user_id, id)
);

CREATE TABLE IF NOT EXISTS voyage_preferences (
  global_user_id VARCHAR(64) NOT NULL,
  id             VARCHAR(190) NOT NULL,
  payload        JSON NOT NULL,
  updated_at     DATETIME(3) NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (global_user_id, id)
);

CREATE TABLE IF NOT EXISTS voyage_consents (
  global_user_id VARCHAR(64) NOT NULL,
  id             VARCHAR(190) NOT NULL,
  payload        JSON NOT NULL,
  updated_at     DATETIME(3) NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (global_user_id, id)
);

CREATE TABLE IF NOT EXISTS voyage_subscriptions (
  global_user_id VARCHAR(64) NOT NULL,
  id             VARCHAR(190) NOT NULL,
  payload        JSON NOT NULL,
  updated_at     DATETIME(3) NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (global_user_id, id)
);

CREATE TABLE IF NOT EXISTS voyage_entitlements (
  global_user_id VARCHAR(64) NOT NULL,
  id             VARCHAR(190) NOT NULL,
  payload        JSON NOT NULL,
  updated_at     DATETIME(3) NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (global_user_id, id)
);

CREATE TABLE IF NOT EXISTS voyage_proposals (
  global_user_id VARCHAR(64) NOT NULL,
  id             VARCHAR(190) NOT NULL,
  payload        JSON NOT NULL,
  updated_at     DATETIME(3) NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (global_user_id, id)
);
