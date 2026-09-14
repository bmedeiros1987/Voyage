const WHO_GHO_BASE = 'https://ghoapi.azureedge.net/api';
const CDC_CONTENT_BASE = 'https://tools.cdc.gov/api/v2/resources';
const DEFAULT_TIMEOUT_MS = 8000;

export function publicHealthSourceCapabilities() {
  return {
    version: '1.0',
    providers: {
      WHO_GHO: {
        baseUrl: WHO_GHO_BASE,
        credentialRequired: false,
        role: 'PUBLIC_HEALTH_DATA_AND_INDICATORS',
        suitableForEntryClearance: false,
        provenanceRequired: true
      },
      CDC_CONTENT_SERVICES: {
        baseUrl: CDC_CONTENT_BASE,
        credentialRequired: false,
        role: 'TRAVEL_HEALTH_AND_PUBLIC_HEALTH_CONTENT',
        suitableForEntryClearance: false,
        provenanceRequired: true
      }
    },
    policies: [
      'WHO and CDC public data may enrich travel-health guidance but must not be treated as an airline boarding or immigration clearance engine.',
      'Every normalized fact must retain provider, source URL when available, observed timestamp and upstream publication/update metadata when present.',
      'Unknown or stale legal-entry requirements remain unresolved until an authoritative border/health rule source is loaded.',
      'Do not send traveller identity, medical records or itinerary PII to public-data endpoints.'
    ]
  };
}

export async function searchWhoIndicators(input = {}, deps = {}) {
  const query = clean(input.query || input.q, 120);
  if (!query) return { ok: true, provider: 'WHO_GHO', results: [], provenance: provenance('WHO_GHO', `${WHO_GHO_BASE}/Indicator`) };
  const url = new URL(`${WHO_GHO_BASE}/Indicator`);
  url.searchParams.set('$filter', `contains(IndicatorName,'${odataLiteral(query)}')`);
  return normalizeWho(await getJson(url, deps), url);
}

export async function fetchWhoIndicatorData(input = {}, deps = {}) {
  const code = String(input.code || input.indicatorCode || '').trim();
  if (!/^[A-Za-z0-9_]+$/.test(code)) throw typedError('WHO_INDICATOR_CODE_INVALID', 400);
  const url = new URL(`${WHO_GHO_BASE}/${code}`);
  const filters = [];
  const countryCode = String(input.countryCode || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(countryCode)) filters.push(`SpatialDim eq '${countryCode}'`);
  if (Number.isInteger(input.year) && input.year >= 1900 && input.year <= 2200) {
    filters.push(`date(TimeDimensionBegin) ge ${input.year}-01-01`);
    filters.push(`date(TimeDimensionBegin) lt ${input.year + 1}-01-01`);
  }
  if (filters.length) url.searchParams.set('$filter', filters.join(' and '));
  return normalizeWho(await getJson(url, deps), url, code);
}

export async function searchCdcTravelHealthContent(input = {}, deps = {}) {
  const query = clean(input.query || input.q, 160);
  if (!query) return { ok: true, provider: 'CDC_CONTENT_SERVICES', results: [], provenance: provenance('CDC_CONTENT_SERVICES', `${CDC_CONTENT_BASE}/media`) };
  const url = new URL(`${CDC_CONTENT_BASE}/media`);
  url.searchParams.set('q', query);
  url.searchParams.set('languageIsoCode', clean(input.languageIsoCode || 'eng', 8));
  url.searchParams.set('max', String(clampInt(input.max, 1, 50, 20)));
  url.searchParams.set('fields', 'id,name,description,source,sourceUrl,targetUrl,datePublished,dateModified,dateContentUpdated,dateContentReviewed,language,status,attribution');
  return normalizeCdc(await getJson(url, deps), url);
}

export async function fetchCdcContent(input = {}, deps = {}) {
  const id = Number(input.id || input.mediaId);
  if (!Number.isInteger(id) || id <= 0) throw typedError('CDC_MEDIA_ID_INVALID', 400);
  const url = new URL(`${CDC_CONTENT_BASE}/media/${id}/content`);
  const raw = await getJson(url, deps);
  return {
    ok: true,
    provider: 'CDC_CONTENT_SERVICES',
    mediaId: id,
    content: raw?.results ?? raw,
    provenance: provenance('CDC_CONTENT_SERVICES', url.toString())
  };
}

function normalizeWho(raw, url, indicatorCode = null) {
  const values = Array.isArray(raw?.value) ? raw.value : [];
  return {
    ok: true,
    provider: 'WHO_GHO',
    indicatorCode,
    results: values.slice(0, 500).map((item) => ({
      code: item.IndicatorCode || item.Code || indicatorCode || null,
      name: item.IndicatorName || item.Title || null,
      spatialDim: item.SpatialDim || null,
      timeDim: item.TimeDim ?? null,
      value: item.NumericValue ?? item.Value ?? null,
      low: item.Low ?? null,
      high: item.High ?? null,
      date: item.Date || item.TimeDimensionBegin || null
    })),
    provenance: provenance('WHO_GHO', url.toString())
  };
}

function normalizeCdc(raw, url) {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  return {
    ok: true,
    provider: 'CDC_CONTENT_SERVICES',
    results: results.slice(0, 50).map((item) => ({
      id: item.id ?? null,
      name: item.name || null,
      description: item.description || null,
      sourceName: item.source?.name || null,
      sourceAcronym: item.source?.acronym || null,
      sourceUrl: item.sourceUrl || item.targetUrl || null,
      attribution: item.attribution || null,
      language: item.language?.isoCode || item.language?.name || null,
      status: item.status || null,
      datePublished: item.datePublished || null,
      dateModified: item.dateModified || item.dateContentUpdated || item.dateContentReviewed || null
    })),
    pagination: raw?.meta?.pagination || null,
    provenance: provenance('CDC_CONTENT_SERVICES', url.toString())
  };
}

async function getJson(url, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw typedError('PUBLIC_HEALTH_FETCH_UNAVAILABLE', 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'Voyage-Travel-Health/1.0' },
      signal: controller.signal
    });
    if (!response?.ok) throw typedError(`PUBLIC_HEALTH_UPSTREAM_${response?.status || 'ERROR'}`, 502);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw typedError('PUBLIC_HEALTH_UPSTREAM_TIMEOUT', 504);
    if (error?.code) throw error;
    throw typedError('PUBLIC_HEALTH_UPSTREAM_ERROR', 502);
  } finally {
    clearTimeout(timer);
  }
}

function provenance(provider, sourceUrl) {
  return { provider, sourceUrl, observedAt: new Date().toISOString(), authoritativeForEntryClearance: false };
}

function clean(value, max) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function odataLiteral(value) {
  return clean(value, 120).replace(/'/g, "''");
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  return Number.isInteger(num) && num >= min && num <= max ? num : fallback;
}

function typedError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = status;
  return error;
}
