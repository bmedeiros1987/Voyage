import { createAwesomeApiClient } from './awesomeapi-client.mjs';

const DEFAULT_TIMEOUT_MS = 6000;

export function travelDataBrokerCapabilities() {
  return {
    version: '1.0',
    strategy: 'CREWCHECK_SHARED_FIRST_THEN_VOYAGE_NATIVE',
    capabilities: ['CURRENCY', 'BRAZIL_CEP'],
    principles: [
      'Prefer the existing versioned CrewCheck shared service when configured and healthy.',
      'Fall back to Voyage-native AwesomeAPI only when the shared service is unavailable or not configured.',
      'Never expose provider API keys or shared-service tokens to browser code.',
      'Preserve upstream provider provenance and add broker route provenance.',
      'Do not silently treat stale provider data as live.'
    ]
  };
}

export function createTravelDataBroker(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation required');
  const sharedBaseUrl = cleanBaseUrl(options.sharedBaseUrl ?? env.CREWCHECK_SHARED_API_BASE_URL);
  const sharedToken = cleanSecret(options.sharedToken ?? env.CREWCHECK_SHARED_SERVICES_TOKEN);
  const timeoutMs = clampInteger(options.timeoutMs, 1000, 30_000, DEFAULT_TIMEOUT_MS);
  const awesomeClient = options.awesomeClient || createAwesomeApiClient({
    apiKey: options.awesomeApiKey ?? env.AWESOMEAPI_API_KEY ?? env.AWESOME_API_KEY,
    fetchImpl,
    timeoutMs
  });

  async function latestFx(pairs, requestOptions = {}) {
    const shared = await tryShared('FX', { pairs }, requestOptions);
    if (shared) return shared;
    const native = await awesomeClient.latestFx(pairs, requestOptions);
    return attachBroker(native, 'VOYAGE_NATIVE_AWESOMEAPI');
  }

  async function lookupCep(cep, requestOptions = {}) {
    const shared = await tryShared('CEP', { cep }, requestOptions);
    if (shared) return shared;
    const native = await awesomeClient.lookupCep(cep, requestOptions);
    return attachBroker(native, 'VOYAGE_NATIVE_AWESOMEAPI');
  }

  async function tryShared(kind, args, requestOptions) {
    if (!sharedBaseUrl || !sharedToken || requestOptions?.skipShared === true) return null;
    const path = kind === 'FX'
      ? `/api/shared/v1/fx/latest?pairs=${encodeURIComponent(normalizePairQuery(args.pairs))}`
      : `/api/shared/v1/cep/${encodeURIComponent(normalizeCep(args.cep) || '')}`;
    if (kind === 'FX' && !normalizePairQuery(args.pairs)) return null;
    if (kind === 'CEP' && !normalizeCep(args.cep)) return null;

    try {
      const payload = await fetchJson(`${sharedBaseUrl}${path}`, {
        fetchImpl,
        timeoutMs,
        headers: { 'x-crewcheck-service-token': sharedToken }
      });
      if (!payload || payload.ok !== true) return null;
      return attachBroker(payload, 'SHARED_CREWCHECK_SERVICE');
    } catch {
      return null;
    }
  }

  return Object.freeze({
    latestFx,
    lookupCep,
    sharedConfigured: Boolean(sharedBaseUrl && sharedToken),
    nativeConfigured: awesomeClient.configured,
    capabilities: travelDataBrokerCapabilities
  });
}

function attachBroker(result, route) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    broker: {
      route,
      duplicateProviderAvoidance: true,
      secretsExposed: false
    }
  };
}

async function fetchJson(url, { fetchImpl, timeoutMs, headers }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers },
      signal: controller.signal
    });
    if (!response?.ok) throw new Error(`HTTP_${response?.status || 500}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizePairQuery(input) {
  const values = Array.isArray(input) ? input : String(input || '').split(',');
  const output = [];
  for (const value of values) {
    const pair = String(value || '').trim().toUpperCase().replace(/[_/]/g, '-');
    if (!/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/.test(pair)) continue;
    if (!output.includes(pair)) output.push(pair);
    if (output.length >= 20) break;
  }
  return output.join(',');
}

function normalizeCep(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

function cleanBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost' ? parsed.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

function cleanSecret(value) {
  const text = String(value || '').trim();
  return text && !['value', 'changeme', 'placeholder', 'your_value_here'].includes(text.toLowerCase()) ? text : null;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.min(max, Math.max(min, parsed))) : fallback;
}
