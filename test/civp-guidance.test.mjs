import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrazilCivpGuide, civpGuidanceCapabilities } from '../src/civp-guidance.mjs';
import { intelligenceHttpCapabilities } from '../src/intelligence-http.mjs';

test('CIVP capabilities use official Brazilian flow and lifetime yellow-fever validity', () => {
  const capabilities = civpGuidanceCapabilities();
  assert.equal(capabilities.jurisdiction, 'BR');
  assert.ok(capabilities.supportedCertificates.includes('ICVP_YELLOW_FEVER'));
  assert.ok(capabilities.officialLinks.meuSusDigital.includes('meususdigital.saude.gov.br'));
  assert.ok(capabilities.principles.some((item) => item.includes('10 days')));
});

test('Voyage teaches Meu SUS Digital first when certificate availability is unknown', () => {
  const guide = buildBrazilCivpGuide({ vaccinated: true, vaccinationDate: '2020-05-01' });
  assert.equal(guide.status, 'CHECK_MEU_SUS_FIRST');
  assert.equal(guide.action, 'CHECK_MEU_SUS_DIGITAL_FOR_ICVP');
  assert.ok(guide.steps.some((step) => step.includes('Minha Saúde')));
  assert.equal(guide.validity, 'LIFETIME_AFTER_VALID_FROM');
});

test('missing certificate in Meu SUS produces Gov.br fallback document checklist', () => {
  const guide = buildBrazilCivpGuide({ vaccinated: true, vaccinationDate: '2017-08-10', certificateAvailableInMeuSus: false });
  assert.equal(guide.status, 'REQUEST_ON_GOV_BR');
  assert.equal(guide.action, 'OPEN_GOV_BR_CIVP_REQUEST');
  assert.ok(guide.requiredProofFields.includes('VACCINE_BATCH'));
  assert.ok(guide.requiredProofFields.includes('HEALTH_UNIT_IDENTIFICATION'));
});

test('yellow-fever timing blocks certificate readiness before day 10', () => {
  const guide = buildBrazilCivpGuide({ vaccinated: true, vaccinationDate: '2026-10-01', departureDate: '2026-10-08', certificateAvailableInMeuSus: true });
  assert.equal(guide.status, 'NOT_VALID_BY_TRAVEL_DATE');
  assert.equal(guide.validFrom, '2026-10-11');
});

test('fractionated yellow-fever dose is routed to health-service review', () => {
  const guide = buildBrazilCivpGuide({ vaccinated: true, vaccinationDate: '2026-09-01', doseFractionated: true });
  assert.equal(guide.status, 'DOSE_REVIEW_REQUIRED');
  assert.equal(guide.action, 'REVIEW_YELLOW_FEVER_DOSE_WITH_HEALTH_SERVICE');
});

test('CIVP routes are exposed by unified intelligence API', () => {
  const api = intelligenceHttpCapabilities();
  assert.ok(api.getRoutes.includes('/api/v1/travel-health/civp/br/capabilities'));
  assert.ok(api.postRoutes.includes('/api/v1/travel-health/civp/br/guide'));
});
