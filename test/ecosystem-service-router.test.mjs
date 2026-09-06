import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEcosystemServiceCatalog,
  ecosystemServiceRouterCapabilities,
  resolveEcosystemCapabilities
} from '../src/ecosystem-service-router.mjs';

const now = '2026-09-06T18:50:00Z';

function crewCheckCirium(overrides = {}) {
  return {
    id: 'crewcheck-cirium',
    name: 'CrewCheck Aviation Data',
    provider: 'Cirium',
    origin: 'CREWCHECK',
    status: 'ACTIVE',
    sharedWithVoyage: true,
    allowsVoyageUse: true,
    dataIsolation: 'PRODUCT_SCOPED',
    productSpecificConsentRequired: true,
    observedAt: '2026-09-06T18:45:00Z',
    capabilities: ['FLIGHT_STATUS', 'AIRPORT_OPERATIONS', 'GATE', 'TERMINAL', 'BAGGAGE_CAROUSEL'],
    apiKey: 'must-never-leak',
    ...overrides
  };
}

test('capabilities define CrewCheck-first reuse and strict personal data separation', () => {
  const capabilities = ecosystemServiceRouterCapabilities();
  assert.equal(capabilities.strategy, 'CREWCHECK_FIRST');
  assert.ok(capabilities.supportedCapabilities.includes('BAGGAGE_CAROUSEL'));
  assert.ok(capabilities.userContextCapabilities.includes('GMAIL_TRAVEL'));
  assert.ok(capabilities.principles.some((item) => item.includes('Never share personal trip')));
});

test('existing CrewCheck Cirium service wins before a duplicate Voyage provider', () => {
  const result = resolveEcosystemCapabilities({
    now,
    requestedCapabilities: ['FLIGHT_STATUS', 'GATE', 'BAGGAGE_CAROUSEL'],
    services: [
      crewCheckCirium(),
      {
        id: 'voyage-aviation-duplicate',
        name: 'Voyage Aviation Duplicate',
        provider: 'AnotherVendor',
        origin: 'VOYAGE',
        status: 'ACTIVE',
        dataIsolation: 'PRODUCT_SCOPED',
        capabilities: ['FLIGHT_STATUS', 'GATE', 'BAGGAGE_CAROUSEL']
      }
    ]
  });

  assert.equal(result.allResolved, true);
  assert.ok(result.resolved.every((item) => item.route === 'SHARED_CREWCHECK_SERVICE'));
  assert.ok(result.resolved.every((item) => item.service.id === 'crewcheck-cirium'));
  assert.deepEqual(result.newProviderNeededFor, []);
});

test('catalog never exposes provider credentials', () => {
  const catalog = buildEcosystemServiceCatalog({ services: [crewCheckCirium()] });
  const serialized = JSON.stringify(catalog);
  assert.equal(catalog.secretsExposed, false);
  assert.equal(serialized.includes('must-never-leak'), false);
  assert.equal(serialized.includes('apiKey'), false);
});

test('user-context capability reuses infrastructure only and requires product-scoped consent', () => {
  const result = resolveEcosystemCapabilities({
    now,
    requestedCapabilities: ['GMAIL_TRAVEL'],
    services: [{
      id: 'crewcheck-google-integration',
      name: 'CrewCheck Google Integration',
      provider: 'Google',
      origin: 'CREWCHECK',
      status: 'ACTIVE',
      sharedWithVoyage: true,
      allowsVoyageUse: true,
      dataIsolation: 'PRODUCT_SCOPED',
      productSpecificConsentRequired: true,
      observedAt: '2026-09-06T18:45:00Z',
      capabilities: ['GMAIL_TRAVEL']
    }]
  });

  assert.equal(result.resolved[0].route, 'SHARED_CREWCHECK_SERVICE');
  assert.equal(result.resolved[0].reuseMode, 'SHARED_INFRASTRUCTURE_ONLY');
  assert.equal(result.policy.crossProductPersonalDataSharingAllowed, false);
});

test('shared Gmail infrastructure is rejected if it lacks product-specific isolation', () => {
  const result = resolveEcosystemCapabilities({
    now,
    requestedCapabilities: ['GMAIL_TRAVEL'],
    services: [{
      id: 'unsafe-google',
      name: 'Unsafe Google Integration',
      provider: 'Google',
      origin: 'CREWCHECK',
      status: 'ACTIVE',
      sharedWithVoyage: true,
      allowsVoyageUse: true,
      dataIsolation: 'NONE',
      productSpecificConsentRequired: false,
      observedAt: '2026-09-06T18:45:00Z',
      capabilities: ['GMAIL_TRAVEL']
    }]
  });

  assert.equal(result.allResolved, false);
  assert.ok(result.unresolved[0].reasons.includes('INSUFFICIENT_PRODUCT_DATA_ISOLATION'));
  assert.ok(result.unresolved[0].reasons.includes('PRODUCT_SPECIFIC_CONSENT_NOT_ENFORCED'));
});

test('stale or down CrewCheck service falls back to Voyage-native service', () => {
  const result = resolveEcosystemCapabilities({
    now,
    maxAgeMinutes: 60,
    requestedCapabilities: ['WEATHER'],
    services: [
      {
        id: 'crewcheck-weather',
        name: 'CrewCheck Weather',
        provider: 'WeatherVendor',
        origin: 'CREWCHECK',
        status: 'DOWN',
        sharedWithVoyage: true,
        allowsVoyageUse: true,
        dataIsolation: 'PRODUCT_SCOPED',
        observedAt: '2026-09-06T18:45:00Z',
        capabilities: ['WEATHER']
      },
      {
        id: 'voyage-weather',
        name: 'Voyage Weather',
        provider: 'FallbackWeather',
        origin: 'VOYAGE',
        status: 'ACTIVE',
        dataIsolation: 'PRODUCT_SCOPED',
        observedAt: '2026-09-06T18:48:00Z',
        capabilities: ['WEATHER']
      }
    ]
  });

  assert.equal(result.resolved[0].route, 'VOYAGE_NATIVE_SERVICE');
  assert.equal(result.resolved[0].service.id, 'voyage-weather');
});

test('missing capability explicitly requests provider evaluation only after recheck', () => {
  const result = resolveEcosystemCapabilities({
    now,
    requestedCapabilities: ['INDOOR_MAPS'],
    services: [crewCheckCirium()]
  });

  assert.equal(result.allResolved, false);
  assert.deepEqual(result.newProviderNeededFor, ['INDOOR_MAPS']);
  assert.equal(result.unresolved[0].action, 'EVALUATE_NEW_PROVIDER_ONLY_AFTER_EXISTING_SERVICE_RECHECK');
});
