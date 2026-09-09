-- Voyage ecosystem identity, provider-link, consent and entitlement storage.
-- Additive migration: complements 006_auth_sessions_itinerary_proposals.sql.
-- It deliberately does NOT create another proposal/session stack.

CREATE TABLE IF NOT EXISTS ecosystem_identities (
  global_user_id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (global_user_id),
  KEY idx_ecosystem_identity_deleted (deleted_at)
);

CREATE TABLE IF NOT EXISTS ecosystem_memberships (
  global_user_id VARCHAR(64) NOT NULL,
  product VARCHAR(24) NOT NULL,
  state VARCHAR(24) NOT NULL,
  verified_by_product BOOLEAN NOT NULL DEFAULT FALSE,
  product_account_id VARCHAR(190) NULL,
  crew_role VARCHAR(40) NULL,
  linked_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (global_user_id, product),
  KEY idx_ecosystem_membership_account (product, product_account_id),
  KEY idx_ecosystem_membership_state (product, state)
);

CREATE TABLE IF NOT EXISTS auth_provider_links (
  global_user_id VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_subject VARCHAR(190) NOT NULL,
  email VARCHAR(254) NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  granted_scopes JSON NOT NULL,
  linked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (provider, provider_subject),
  KEY idx_auth_provider_links_global_user (global_user_id),
  KEY idx_auth_provider_links_email (email)
);

CREATE TABLE IF NOT EXISTS user_consents (
  global_user_id VARCHAR(64) NOT NULL,
  consent_key VARCHAR(96) NOT NULL,
  granted BOOLEAN NOT NULL,
  granted_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  source VARCHAR(64) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (global_user_id, consent_key)
);

CREATE TABLE IF NOT EXISTS product_subscriptions (
  global_user_id VARCHAR(64) NOT NULL,
  product VARCHAR(24) NOT NULL,
  state VARCHAR(24) NOT NULL,
  renews_at DATETIME(3) NULL,
  source VARCHAR(64) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (global_user_id, product),
  KEY idx_product_subscription_state (product, state)
);

CREATE TABLE IF NOT EXISTS user_entitlements (
  global_user_id VARCHAR(64) NOT NULL,
  entitlement_key VARCHAR(96) NOT NULL,
  source_product VARCHAR(24) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (global_user_id, entitlement_key),
  KEY idx_user_entitlement_active (entitlement_key, active, expires_at)
);

-- Boundary contract:
-- * Google/Apple/CrewCheck/password account identities live in auth_provider_links.
-- * Gmail OAuth grants remain separate provider authorization records and are not
--   inferred from auth_provider_links.granted_scopes.
-- * subscriptions/entitlements never imply cross-product consent.
-- * itinerary proposals remain canonical in itinerary_proposals from migration 006.
