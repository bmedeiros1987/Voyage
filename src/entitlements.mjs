// Premium entitlements. Two ideas are kept strictly apart here: what a user has
// *paid for* (entitlement) and what a user has *agreed to* (consent). A paid plan
// never grants data access on its own.

export const ENTITLEMENTS = Object.freeze(['VOYAGE_PREMIUM', 'CREWCHECK_PREMIUM', 'UNIFIED_CALENDAR']);
export const SUBSCRIPTION_STATES = Object.freeze(['ACTIVE', 'GRACE', 'EXPIRED', 'NONE']);

// Unified Calendar unlocks when at least one applicable premium entitlement is
// held, so Voyage Premium + CrewCheck Free is a supported combination.
const UNIFIED_CALENDAR_SOURCES = Object.freeze(['VOYAGE_PREMIUM', 'CREWCHECK_PREMIUM']);

export function entitlementCapabilities() {
  return Object.freeze({
    version: '1.0',
    entitlements: ENTITLEMENTS,
    subscriptionStates: SUBSCRIPTION_STATES,
    unifiedCalendarSources: UNIFIED_CALENDAR_SOURCES,
    principles: [
      'A subscription grants capability, never consent. Data access still requires an explicit opt-in.',
      'Unified Calendar requires at least one applicable premium entitlement, from either product.',
      'Voyage Premium with CrewCheck Free is a supported combination.',
      'Revoking consent disables the connected surface even while the subscription stays active.'
    ]
  });
}

export function normalizeSubscription(input = {}) {
  const product = String(input.product || '').toUpperCase();
  const state = SUBSCRIPTION_STATES.includes(String(input.state || '').toUpperCase())
    ? String(input.state).toUpperCase()
    : 'NONE';
  return Object.freeze({
    product: ['VOYAGE', 'CREWCHECK'].includes(product) ? product : null,
    state,
    // GRACE still entitles: a failed renewal should not strand a traveller abroad.
    entitling: state === 'ACTIVE' || state === 'GRACE',
    renewsAt: input.renewsAt || null
  });
}

export function resolveEntitlements({ subscriptions = [], memberships = {} } = {}) {
  const normalized = (Array.isArray(subscriptions) ? subscriptions : []).map(normalizeSubscription).filter((s) => s.product);
  const held = new Set();

  for (const subscription of normalized) {
    if (!subscription.entitling) continue;
    if (subscription.product === 'VOYAGE') held.add('VOYAGE_PREMIUM');
    // CrewCheck Premium only counts when the CrewCheck membership is actually active.
    if (subscription.product === 'CREWCHECK' && memberships?.CREWCHECK?.state === 'ACTIVE') {
      held.add('CREWCHECK_PREMIUM');
    }
  }

  const unifiedSources = UNIFIED_CALENDAR_SOURCES.filter((source) => held.has(source));
  if (unifiedSources.length > 0) held.add('UNIFIED_CALENDAR');

  return Object.freeze({
    entitlements: Object.freeze([...held].sort()),
    unifiedCalendar: Object.freeze({
      entitled: held.has('UNIFIED_CALENDAR'),
      grantedBy: Object.freeze(unifiedSources),
      // Entitlement is necessary but not sufficient — see gateFeature below.
      stillRequiresConnectionConsent: true
    }),
    subscriptions: Object.freeze(normalized)
  });
}

// The single gate every premium + cross-product surface must pass through.
export function gateFeature(feature, { entitlements = [], consents = {} } = {}) {
  const held = new Set(entitlements);
  const entitled = held.has(feature);

  if (!entitled) {
    return Object.freeze({ allowed: false, reason: 'ENTITLEMENT_REQUIRED', upgradeRequired: true, consentRequired: false });
  }

  // Cross-product features additionally require the opt-in connection consent.
  const crossProduct = feature === 'UNIFIED_CALENDAR';
  const connected = consents?.CREWCHECK_VOYAGE_CONNECTION === true;

  if (crossProduct && !connected) {
    return Object.freeze({
      allowed: false,
      reason: 'CONNECTION_CONSENT_REQUIRED',
      upgradeRequired: false,
      consentRequired: true,
      note: 'A paid subscription does not imply consent to connect CrewCheck and Voyage.'
    });
  }

  return Object.freeze({ allowed: true, reason: null, upgradeRequired: false, consentRequired: false });
}
