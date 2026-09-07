import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicHealthSourceCapabilities,
  searchWhoIndicators,
  fetchWhoIndicatorData,
  searchCdcTravelHealthContent,
  fetchCdcContent
} from '../src/public-health-sources.mjs';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test('public health capabilities never advertise WHO or CDC as entry-clearance engines', () => {
  const caps = publicHealthSourceCapabilities();
  assert.equal(caps.providers.WHO_GHO.credentialRequired, false);
  assert.equal(caps.providers.CDC_CONTENT_SERVICES.credentialRequired, false);
  assert.equal(caps.providers.WHO_GHO.suitableForEntryClearance, false);
  assert.equal(caps.providers.CDC_CONTENT_SERVICES.suitableForEntryClearance, false);
});

test('WHO indicator search uses official GHO OData endpoint and retains provenance', async () => {
  let called;
  const result = await searchWhoIndicators({ query: 'Yellow fever' }, {
    fetchImpl: async (url) => {
      called = String(url);
      return jsonResponse({ value: [{ IndicatorCode: 'TEST', IndicatorName: 'Yellow fever test indicator' }] });
    }
  });
  assert.match(called, /^https:\/\/ghoapi\.azureedge\.net\/api\/Indicator\?/);
  assert.match(called, /contains%28IndicatorName/);
  assert.equal(result.results[0].code, 'TEST');
  assert.equal(result.provenance.authoritativeForEntryClearance, false);
});

test('WHO indicator data accepts safe code and optional country/year filters', async () => {
  let called;
  const result = await fetchWhoIndicatorData({ code: 'WHOSIS_000001', countryCode: 'BRA', year: 2025 }, {
    fetchImpl: async (url) => {
      called = String(url);
      return jsonResponse({ value: [{ SpatialDim: 'BRA', TimeDim: 2025, NumericValue: 77.1 }] });
    }
  });
  assert.match(called, /WHOSIS_000001/);
  const filter = new URL(called).searchParams.get('$filter') || '';
  assert.match(filter, /SpatialDim eq 'BRA'/);
  assert.match(filter, /date\(TimeDimensionBegin\) ge 2025-01-01/);
  assert.match(filter, /date\(TimeDimensionBegin\) lt 2026-01-01/);
  assert.equal(result.results[0].value, 77.1);
  await assert.rejects(() => fetchWhoIndicatorData({ code: '../secret' }, { fetchImpl: async () => jsonResponse({}) }), /WHO_INDICATOR_CODE_INVALID/);
});

test('CDC search uses v2 Content Services media endpoint with reduced fields', async () => {
  let called;
  const result = await searchCdcTravelHealthContent({ query: 'travel yellow fever', max: 5 }, {
    fetchImpl: async (url) => {
      called = String(url);
      return jsonResponse({
        meta: { pagination: { total: 1 } },
        results: [{ id: 42, name: 'Travel health', source: { name: 'Centers for Disease Control and Prevention', acronym: 'CDC' }, sourceUrl: 'https://www.cdc.gov/example', status: 'Published' }]
      });
    }
  });
  assert.match(called, /^https:\/\/tools\.cdc\.gov\/api\/v2\/resources\/media\?/);
  assert.match(called, /fields=/);
  assert.equal(result.results[0].sourceAcronym, 'CDC');
  assert.equal(result.pagination.total, 1);
});

test('CDC content retrieval requires positive numeric media id and preserves provider', async () => {
  const result = await fetchCdcContent({ id: 42 }, { fetchImpl: async () => jsonResponse({ results: ['<p>content</p>'] }) });
  assert.equal(result.provider, 'CDC_CONTENT_SERVICES');
  assert.equal(result.mediaId, 42);
  await assert.rejects(() => fetchCdcContent({ id: 0 }, { fetchImpl: async () => jsonResponse({}) }), /CDC_MEDIA_ID_INVALID/);
});
