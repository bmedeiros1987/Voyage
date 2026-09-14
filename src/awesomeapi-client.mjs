const FX_BASE_URL = 'https://economia.awesomeapi.com.br';
const CEP_BASE_URL = 'https://cep.awesomeapi.com.br';
const DEFAULT_TIMEOUT_MS = 7000;
const DEFAULT_FX_TTL_MS = 60_000;
const DEFAULT_CEP_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_FX_MS = 6 * 60 * 60 * 1000;
const DEFAULT_STALE_CEP_MS = 30 * 24 * 60 * 60 * 1000;

export function awesomeApiCapabilities() {
  return {
    version: '1.0',
    provider: 'AWESOMEAPI',
    capabilities: ['FX_LATEST', 'BRAZIL_CEP_LOOKUP'],
    auth: {
      supported: ['X_API_KEY_HEADER'],
      preferred: 'X_API_KEY_HEADER',
      queryStringTokenAllowedByProviderButDisabledHere: true
    },
    cache: {
      fxFreshSeconds: DEFAULT_FX_TTL_MS / 1000,
      cepFreshHours: DEFAULT_CEP_TTL_MS / 3_600_000,
      staleIfErrorSupported: true
    },
    privacy: {
      apiKeyReturned: false,
      apiKeyAllowedInUrl: false,
      cepStoredAsOperationalLocationFactOnly: true
    },
    policies: [
      'Keep the API key server-side and send it through x-api-key, never in browser code or query strings.',
      'FX conversions must preserve quote provenance, observed time and freshness.',
      'A stale cached quote may be surfaced only when live refresh fails and must be clearly marked stale.',
      'CEP lookup is an address convenience signal, not proof of a precise entrance or final geolocation.'
    ]
  };
}

export function createAwesomeApiClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation required');
  const apiKey = cleanSecret(options.apiKey ?? process.env.AWESOMEAPI_API_KEY ?? process.env.AWESOME_API_KEY);
  const timeoutMs = clampInteger(options.timeoutMs, 1000, 30_000, DEFAULT_TIMEOUT_MS);
  const fxTtlMs = clampInteger(options.fxTtlMs, 0, 60 * 60 * 1000, DEFAULT_FX_TTL_MS);
  const cepTtlMs = clampInteger(options.cepTtlMs, 0, 7 * 24 * 60 * 60 * 1000, DEFAULT_CEP_TTL_MS);
  const staleFxMs = clampInteger(options.staleFxMs, fxTtlMs, 7 * 24 * 60 * 60 * 1000, DEFAULT_STALE_FX_MS);
  const staleCepMs = clampInteger(options.staleCepMs, cepTtlMs, 90 * 24 * 60 * 60 * 1000, DEFAULT_STALE_CEP_MS);
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const fxCache = new Map();
  const cepCache = new Map();

  async function latestFx(pairs, requestOptions = {}) {
    const normalizedPairs = normalizePairs(pairs);
    if (!normalizedPairs.length) return { ok: false, status: 'INVALID_REQUEST', quotes: [], error: 'NO_VALID_FX_PAIR' };
    const key = normalizedPairs.join(',');
    const forceRefresh = requestOptions.forceRefresh === true;
    const cached = fxCache.get(key);
    const current = now();
    if (!forceRefresh && cached && current - cached.fetchedAtMs <= fxTtlMs) {
      return cloneResult({ ...cached.value, cache: { hit: true, stale: false, ageSeconds: Math.floor((current - cached.fetchedAtMs) / 1000) } });
    }

    try {
      const url = `${FX_BASE_URL}/json/last/${normalizedPairs.join(',')}`;
      const payload = await fetchJson(url, { fetchImpl, apiKey, timeoutMs });
      const quotes = normalizeFxPayload(payload, normalizedPairs, current);
      if (!quotes.length) throw providerError('FX_EMPTY_RESPONSE', 502);
      const value = {
        ok: true,
        status: 'LIVE',
        provider: 'AWESOMEAPI',
        authenticated: Boolean(apiKey),
        quotes,
        fetchedAt: new Date(current).toISOString(),
        cache: { hit: false, stale: false, ageSeconds: 0 }
      };
      fxCache.set(key, { fetchedAtMs: current, value });
      return cloneResult(value);
    } catch (error) {
      if (cached && current - cached.fetchedAtMs <= staleFxMs) {
        return cloneResult({
          ...cached.value,
          status: 'STALE_IF_ERROR',
          warning: safeErrorCode(error),
          cache: { hit: true, stale: true, ageSeconds: Math.floor((current - cached.fetchedAtMs) / 1000) }
        });
      }
      return {
        ok: false,
        status: 'UNAVAILABLE',
        provider: 'AWESOMEAPI',
        quotes: [],
        error: safeErrorCode(error),
        fetchedAt: new Date(current).toISOString(),
        cache: { hit: false, stale: false, ageSeconds: null }
      };
    }
  }

  async function lookupCep(cep, requestOptions = {}) {
    const normalizedCep = normalizeCep(cep);
    if (!normalizedCep) return { ok: false, status: 'INVALID_REQUEST', address: null, error: 'INVALID_CEP' };
    const forceRefresh = requestOptions.forceRefresh === true;
    const cached = cepCache.get(normalizedCep);
    const current = now();
    if (!forceRefresh && cached && current - cached.fetchedAtMs <= cepTtlMs) {
      return cloneResult({ ...cached.value, cache: { hit: true, stale: false, ageSeconds: Math.floor((current - cached.fetchedAtMs) / 1000) } });
    }

    try {
      const url = `${CEP_BASE_URL}/json/${normalizedCep}`;
      const payload = await fetchJson(url, { fetchImpl, apiKey, timeoutMs });
      const address = normalizeCepPayload(payload, normalizedCep);
      if (!address) throw providerError('CEP_INVALID_RESPONSE', 502);
      const value = {
        ok: true,
        status: 'LIVE',
        provider: 'AWESOMEAPI',
        authenticated: Boolean(apiKey),
        address,
        fetchedAt: new Date(current).toISOString(),
        cache: { hit: false, stale: false, ageSeconds: 0 },
        disclaimer: 'CEP helps resolve locality/address context but does not prove the exact entrance or indoor destination.'
      };
      cepCache.set(normalizedCep, { fetchedAtMs: current, value });
      return cloneResult(value);
    } catch (error) {
      if (cached && current - cached.fetchedAtMs <= staleCepMs) {
        return cloneResult({
          ...cached.value,
          status: 'STALE_IF_ERROR',
          warning: safeErrorCode(error),
          cache: { hit: true, stale: true, ageSeconds: Math.floor((current - cached.fetchedAtMs) / 1000) }
        });
      }
      return {
        ok: false,
        status: 'UNAVAILABLE',
        provider: 'AWESOMEAPI',
        address: null,
        error: safeErrorCode(error),
        fetchedAt: new Date(current).toISOString(),
        cache: { hit: false, stale: false, ageSeconds: null }
      };
    }
  }

  return Object.freeze({
    configured: Boolean(apiKey),
    latestFx,
    lookupCep,
    capabilities: awesomeApiCapabilities
  });
}

export function quoteForBudget(result, fromCurrency, toCurrency, mode = 'MID') {
  const from = safeCurrency(fromCurrency);
  const to = safeCurrency(toCurrency);
  if (!result?.ok || !from || !to) return null;
  if (from === to) {
    return { from, to, rate: 1, source: 'IDENTITY', observedAt: result.fetchedAt || null, stale: false };
  }
  const direct = result.quotes?.find((quote) => quote.from === from && quote.to === to);
  if (direct) return budgetFx(direct, mode, result);
  const inverse = result.quotes?.find((quote) => quote.from === to && quote.to === from);
  if (!inverse) return null;
  const raw = chooseRate(inverse, mode);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return {
    from,
    to,
    rate: roundRate(1 / raw),
    source: 'AWESOMEAPI',
    observedAt: inverse.observedAt,
    fetchedAt: result.fetchedAt || null,
    stale: result.cache?.stale === true,
    mode: normalizeRateMode(mode),
    invertedFrom: `${inverse.from}-${inverse.to}`
  };
}

async function fetchJson(url, { fetchImpl, apiKey, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    if (!response?.ok) throw providerError(`HTTP_${response?.status || 500}`, response?.status || 500);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw providerError('TIMEOUT', 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFxPayload(payload, requestedPairs, fetchedAtMs) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const requested = new Set(requestedPairs);
  const quotes = [];
  for (const value of Object.values(payload)) {
    if (!value || typeof value !== 'object') continue;
    const from = safeCurrency(value.code);
    const to = safeCurrency(value.codein);
    const pair = from && to ? `${from}-${to}` : null;
    if (!pair || !requested.has(pair)) continue;
    const bid = positiveNumber(value.bid);
    const ask = positiveNumber(value.ask);
    if (bid === null && ask === null) continue;
    const providerTimestamp = normalizeEpoch(value.timestamp);
    quotes.push({
      pair,
      from,
      to,
      name: safeString(value.name, 180),
      bid,
      ask,
      mid: bid !== null && ask !== null ? roundRate((bid + ask) / 2) : bid ?? ask,
      high: positiveNumber(value.high),
      low: positiveNumber(value.low),
      percentChange: finiteNumber(value.pctChange),
      observedAt: providerTimestamp || safeProviderDate(value.create_date) || new Date(fetchedAtMs).toISOString(),
      providerTimestampRaw: safeString(value.timestamp, 32),
      provenance: {
        provider: 'AWESOMEAPI',
        endpoint: '/json/last/:pairs',
        authenticated: null
      }
    });
  }
  return quotes.sort((a, b) => a.pair.localeCompare(b.pair));
}

function normalizeCepPayload(payload, requestedCep) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const cep = normalizeCep(payload.cep || requestedCep);
  if (!cep) return null;
  return {
    cep,
    formattedCep: `${cep.slice(0, 5)}-${cep.slice(5)}`,
    addressType: safeString(payload.address_type, 80),
    addressName: safeString(payload.address_name, 180),
    address: safeString(payload.address, 260),
    district: safeString(payload.district, 180),
    city: safeString(payload.city, 180),
    state: safeState(payload.state),
    cityIbge: safeDigits(payload.city_ibge, 16),
    ddd: safeDigits(payload.ddd, 3),
    latitude: coordinate(payload.lat, -90, 90),
    longitude: coordinate(payload.lng, -180, 180),
    precision: payload.lat != null && payload.lng != null ? 'PROVIDER_COORDINATE' : 'POSTAL_AREA_ONLY'
  };
}

function budgetFx(quote, mode, result) {
  const rate = chooseRate(quote, mode);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    from: quote.from,
    to: quote.to,
    rate: roundRate(rate),
    source: 'AWESOMEAPI',
    observedAt: quote.observedAt,
    fetchedAt: result.fetchedAt || null,
    stale: result.cache?.stale === true,
    mode: normalizeRateMode(mode)
  };
}

function chooseRate(quote, mode) {
  const normalized = normalizeRateMode(mode);
  if (normalized === 'BID') return quote.bid ?? quote.mid ?? quote.ask;
  if (normalized === 'ASK') return quote.ask ?? quote.mid ?? quote.bid;
  return quote.mid ?? quote.bid ?? quote.ask;
}

function normalizeRateMode(value) {
  const mode = String(value || 'MID').toUpperCase();
  return ['BID', 'ASK', 'MID'].includes(mode) ? mode : 'MID';
}

function normalizePairs(input) {
  const values = Array.isArray(input) ? input : String(input || '').split(',');
  const pairs = [];
  for (const value of values) {
    const normalized = String(value || '').trim().toUpperCase().replace(/[_/]/g, '-');
    if (!/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/.test(normalized)) continue;
    if (!pairs.includes(normalized)) pairs.push(normalized);
    if (pairs.length >= 20) break;
  }
  return pairs;
}

function normalizeCep(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

function safeCurrency(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{2,10}$/.test(code) ? code : null;
}

function safeState(value) {
  const state = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(state) ? state : null;
}

function safeDigits(value, max) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? digits.slice(0, max) : null;
}

function coordinate(value, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeEpoch(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const ms = parsed > 10_000_000_000 ? parsed : parsed * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeProviderDate(value) {
  if (!value) return null;
  const text = String(value).trim().replace(' ', 'T');
  const date = new Date(text.endsWith('Z') ? text : `${text}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanSecret(value) {
  const secret = String(value || '').trim();
  if (!secret || ['value', 'changeme', 'placeholder', 'your_value_here'].includes(secret.toLowerCase())) return null;
  return secret;
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function roundRate(value) {
  return Number(Number(value).toFixed(8));
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.min(max, Math.max(min, parsed))) : fallback;
}

function providerError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function safeErrorCode(error) {
  const code = String(error?.code || error?.name || 'PROVIDER_ERROR').toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
  return code.slice(0, 100) || 'PROVIDER_ERROR';
}

function cloneResult(value) {
  return JSON.parse(JSON.stringify(value));
}
