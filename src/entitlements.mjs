export const ENTITLEMENTS = Object.freeze(['VOYAGE_PREMIUM', 'CREWCHECK_PREMIUM', 'UNIFIED_CALENDAR']);
export const SUBSCRIPTION_STATES = Object.freeze(['ACTIVE', 'GRACE', 'EXPIRED', 'NONE']);
const UNIFIED_CALENDAR_SOURCES = Object.freeze(['VOYAGE_PREMIUM', 'CREWCHECK_PREMIUM']);

export function entitlementCapabilities() {
  return Object.freeze({
    version: '1.0', entitlements: ENTITLEMENTS, subscriptionStates: SUBSCRIPTION_STATES, unifiedCalendarSources: UNIFIED_CALENDAR_SOURCES,
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
  const state = SUBSCRIPTION_STATES.includes(String(input.state || '').toUpperCase()) ? String(input.state).toUpperCase() : 'NONE';
  return Object.freeze({ product: ['VOYAGE', 'CREWCHECK'].includes(product) ? product : null, state, entitling: state === 'ACTIVE' || state === 'GRACE', renewsAt: input.renewsAt || null });
}

export function resolveEntitlements({ subscriptions = [], memberships = {} } = {}) {
  const normalized = (Array.isArray(subscriptions) ? subscriptions : []).map(normalizeSubscription).filter((s) => s.product);
  const held = new Set();
  for (const subscription of normalized) {
    if (!subscription.entitling) continue;
    if (subscription.product === 'VOYAGE') held.add('VOYAGE_PREMIUM');
    if (subscription.product === 'CREWCHECK' && memberships?.CREWCHECK?.state === 'ACTIVE') held.add('CREWCHECK_PREMIUM');
  }
  const unifiedSources = UNIFIED_CALENDAR_SOURCES.filter((source) => held.has(source));
  if (unifiedSources.length > 0) held.add('UNIFIED_CALENDAR');
  return Object.freeze({
    entitlements: Object.freeze([...held].sort()),
    unifiedCalendar: Object.freeze({ entitled: held.has('UNIFIED_CALENDAR'), grantedBy: Object.freeze(unifiedSources), stillRequiresConnectionConsent: true }),
    subscriptions: Object.freeze(normalized)
  });
}

export function gateFeature(feature, { entitlements = [], consents = {} } = {}) {
  const held = new Set(entitlements);
  if (!held.has(feature)) return Object.freeze({ allowed: false, reason: 'ENTITLEMENT_REQUIRED', upgradeRequired: true, consentRequired: false });
  const crossProduct = feature === 'UNIFIED_CALENDAR';
  const connected = consents?.CREWCHECK_VOYAGE_CONNECTION === true;
  if (crossProduct && !connected) {
    return Object.freeze({ allowed: false, reason: 'CONNECTION_CONSENT_REQUIRED', upgradeRequired: false, consentRequired: true, note: 'A paid subscription does not imply consent to connect CrewCheck and Voyage.' });
  }
  return Object.freeze({ allowed: true, reason: null, upgradeRequired: false, consentRequired: false });
}
