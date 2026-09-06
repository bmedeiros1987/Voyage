const CAPABILITIES = new Set([
  'FLIGHT_STATUS',
  'AIRPORT_OPERATIONS',
  'GATE',
  'TERMINAL',
  'BAGGAGE_CAROUSEL',
  'WEATHER',
  'ROUTES',
  'LIVE_TRAFFIC',
  'PLACES',
  'TRANSIT',
  'INDOOR_MAPS',
  'NOTIFICATIONS',
  'CURRENCY',
  'GMAIL_TRAVEL',
  'CALENDAR',
  'BOOKING_SEARCH',
  'PAYMENTS'
]);

const USER_CONTEXT_CAPABILITIES = new Set(['GMAIL_TRAVEL', 'CALENDAR', 'PAYMENTS']);
const SERVICE_STATUSES = new Set(['ACTIVE', 'DEGRADED', 'DOWN', 'UNKNOWN']);
const ISOLATION_LEVELS = new Set(['REQUEST_SCOPED', 'PRODUCT_SCOPED', 'TENANT_SCOPED', 'NONE']);

export function ecosystemServiceRouterCapabilities() {
  return {
    version: '1.0',
    strategy: 'CREWCHECK_FIRST',
    supportedCapabilities: [...CAPABILITIES],
    principles: [
      'Before adding a new Voyage provider, check whether CrewCheck already exposes the capability through an eligible shared service.',
      'Reuse shared infrastructure where technically and contractually appropriate instead of duplicating provider accounts or API keys.',
      'Never share personal trip, mailbox, calendar, payment or other user-context data across CrewCheck and Voyage merely because infrastructure is shared.',
      'User-context integrations may reuse code, provider contracts and backend infrastructure, but each product must keep separate consent and authorization context.',
      'Provider secrets remain server-side and are never returned in capability discovery responses.',
      'A degraded, down, stale or policy-ineligible shared service must not silently become the only source of truth.',
      'New provider procurement is a last resort after existing shared and Voyage-native services are evaluated.'
    ],
    precedence: ['SHARED_CREWCHECK_SERVICE', 'VOYAGE_NATIVE_SERVICE', 'NEEDS_PROVIDER'],
    userContextCapabilities: [...USER_CONTEXT_CAPABILITIES]
  };
}

export function buildEcosystemServiceCatalog(input = {}) {
  const services = normalizeServices(input.services || []);
  return {
    version: '1.0',
    services: services.map(sanitizeService),
    activeCount: services.filter((service) => service.status === 'ACTIVE').length,
    sharedCrewCheckCount: services.filter((service) => service.origin === 'CREWCHECK' && service.sharedWithVoyage).length,
    voyageNativeCount: services.filter((service) => service.origin === 'VOYAGE').length,
    secretsExposed: false,
    policy: 'Catalog returns capability metadata only; credentials and provider secrets are never exposed.'
  };
}

export function resolveEcosystemCapabilities(input = {}) {
  const requested = normalizeCapabilities(input.requestedCapabilities || input.capabilities || []);
  const services = normalizeServices(input.services || []);
  const nowMs = safeNow(input.now);
  const maxAgeMinutes = clampInteger(input.maxAgeMinutes, 1, 10080, 1440);
  const results = requested.map((capability) => resolveOne(capability, services, nowMs, maxAgeMinutes));

  return {
    version: '1.0',
    strategy: 'CREWCHECK_FIRST',
    requested,
    resolved: results.filter((result) => result.status === 'RESOLVED'),
    unresolved: results.filter((result) => result.status !== 'RESOLVED'),
    allResolved: results.every((result) => result.status === 'RESOLVED'),
    newProviderNeededFor: results.filter((result) => result.route === 'NEEDS_PROVIDER').map((result) => result.capability),
    policy: {
      duplicateProviderAvoidance: true,
      crossProductPersonalDataSharingAllowed: false,
      userContextRequiresProductSpecificConsent: true,
      providerSecretsReturned: false
    }
  };
}

function resolveOne(capability, services, nowMs, maxAgeMinutes) {
  const candidates = services
    .filter((service) => service.capabilities.includes(capability))
    .map((service) => evaluateEligibility(service, capability, nowMs, maxAgeMinutes));

  const shared = candidates
    .filter((item) => item.eligible && item.service.origin === 'CREWCHECK' && item.service.sharedWithVoyage)
    .sort(compareCandidates)[0];
  if (shared) return buildResolution(capability, shared, 'SHARED_CREWCHECK_SERVICE');

  const voyage = candidates
    .filter((item) => item.eligible && item.service.origin === 'VOYAGE')
    .sort(compareCandidates)[0];
  if (voyage) return buildResolution(capability, voyage, 'VOYAGE_NATIVE_SERVICE');

  const reasons = unique(candidates.flatMap((item) => item.reasons));
  return {
    capability,
    status: 'UNRESOLVED',
    route: 'NEEDS_PROVIDER',
    service: null,
    reuseMode: null,
    reasons: reasons.length ? reasons : ['NO_EXISTING_SERVICE_WITH_CAPABILITY'],
    action: 'EVALUATE_NEW_PROVIDER_ONLY_AFTER_EXISTING_SERVICE_RECHECK'
  };
}

function evaluateEligibility(service, capability, nowMs, maxAgeMinutes) {
  const reasons = [];
  if (service.status === 'DOWN') reasons.push('SERVICE_DOWN');
  if (service.status === 'UNKNOWN') reasons.push('SERVICE_STATUS_UNKNOWN');
  if (service.origin === 'CREWCHECK' && !service.sharedWithVoyage) reasons.push('NOT_SHARED_WITH_VOYAGE');
  if (!service.allowsVoyageUse) reasons.push('VOYAGE_USE_NOT_ALLOWED');

  if (service.observedAt) {
    const ageMinutes = Math.max(0, (nowMs - Date.parse(service.observedAt)) / 60_000);
    if (ageMinutes > maxAgeMinutes) reasons.push('SERVICE_METADATA_STALE');
  }

  let reuseMode = 'SHARED_SERVICE';
  if (USER_CONTEXT_CAPABILITIES.has(capability)) {
    reuseMode = 'SHARED_INFRASTRUCTURE_ONLY';
    if (!['REQUEST_SCOPED', 'PRODUCT_SCOPED'].includes(service.dataIsolation)) reasons.push('INSUFFICIENT_PRODUCT_DATA_ISOLATION');
    if (!service.productSpecificConsentRequired) reasons.push('PRODUCT_SPECIFIC_CONSENT_NOT_ENFORCED');
  } else if (service.dataIsolation === 'NONE') {
    reasons.push('NO_DATA_ISOLATION');
  }

  return {
    service,
    capability,
    eligible: reasons.length === 0,
    reasons,
    reuseMode,
    healthRank: service.status === 'ACTIVE' ? 2 : service.status === 'DEGRADED' ? 1 : 0
  };
}

function buildResolution(capability, candidate, route) {
  return {
    capability,
    status: 'RESOLVED',
    route,
    service: sanitizeService(candidate.service),
    reuseMode: candidate.reuseMode,
    reasons: route === 'SHARED_CREWCHECK_SERVICE' ? ['REUSE_EXISTING_CREWCHECK_CAPABILITY'] : ['USE_EXISTING_VOYAGE_CAPABILITY'],
    action: route === 'SHARED_CREWCHECK_SERVICE' ? 'ROUTE_THROUGH_VERSIONED_SHARED_SERVICE' : 'USE_VOYAGE_NATIVE_SERVICE'
  };
}

function normalizeServices(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 500).map((service, index) => ({
    id: safeString(service.id, 160) || `service-${index + 1}`,
    name: safeString(service.name, 220) || `Service ${index + 1}`,
    provider: safeString(service.provider, 160),
    origin: String(service.origin || '').toUpperCase() === 'CREWCHECK' ? 'CREWCHECK' : 'VOYAGE',
    status: SERVICE_STATUSES.has(String(service.status || '').toUpperCase()) ? String(service.status).toUpperCase() : 'UNKNOWN',
    sharedWithVoyage: service.sharedWithVoyage === true,
    allowsVoyageUse: service.allowsVoyageUse !== false,
    capabilities: normalizeCapabilities(service.capabilities || []),
    endpointVersion: safeString(service.endpointVersion || service.version, 80),
    dataIsolation: ISOLATION_LEVELS.has(String(service.dataIsolation || '').toUpperCase()) ? String(service.dataIsolation).toUpperCase() : 'PRODUCT_SCOPED',
    productSpecificConsentRequired: service.productSpecificConsentRequired !== false,
    observedAt: safeDateTime(service.observedAt || service.checkedAt),
    contractScope: safeString(service.contractScope, 120),
    authModel: safeString(service.authModel, 120),
    secretPresent: Boolean(service.apiKey || service.secret || service.token || service.password || service.credentials)
  }));
}

function sanitizeService(service) {
  return {
    id: service.id,
    name: service.name,
    provider: service.provider,
    origin: service.origin,
    status: service.status,
    sharedWithVoyage: service.sharedWithVoyage,
    capabilities: [...service.capabilities],
    endpointVersion: service.endpointVersion,
    dataIsolation: service.dataIsolation,
    productSpecificConsentRequired: service.productSpecificConsentRequired,
    observedAt: service.observedAt,
    contractScope: service.contractScope,
    authModel: service.authModel,
    secretsExposed: false
  };
}

function normalizeCapabilities(input) {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  return unique(values.map((value) => safeToken(value)).filter((value) => CAPABILITIES.has(value)));
}

function compareCandidates(a, b) {
  if (b.healthRank !== a.healthRank) return b.healthRank - a.healthRank;
  const aObserved = a.service.observedAt ? Date.parse(a.service.observedAt) : 0;
  const bObserved = b.service.observedAt ? Date.parse(b.service.observedAt) : 0;
  return bObserved - aObserved || a.service.name.localeCompare(b.service.name);
}

function safeNow(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function safeToken(value) {
  const token = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return token || null;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(max, Math.max(min, parsed)));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
