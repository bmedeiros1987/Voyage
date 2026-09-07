import { createTravelDataBroker, travelDataBrokerCapabilities } from './travel-data-broker.mjs';

export async function handleTravelDataHttp(req, res, path) {
  if (!String(path || '').startsWith('/api/v1/data/')) return false;

  const broker = createTravelDataBroker();

  if (req.method === 'GET' && path === '/api/v1/data/capabilities') {
    const sharedFlight = await broker.sharedFlightStatusCapabilities().catch(() => null);
    return sendJson(res, 200, {
      ok: true,
      ...travelDataBrokerCapabilities(),
      sharedCrewCheckConfigured: broker.sharedConfigured,
      voyageNativeAwesomeApiConfigured: broker.nativeConfigured,
      sharedFlightStatus: sharedFlight ? sanitizeStatus(sharedFlight) : null,
      secretsExposed: false
    });
  }

  if (req.method === 'GET' && path === '/api/v1/data/fx/latest') {
    const pairs = query(req.url).searchParams.get('pairs') || 'USD-BRL,EUR-BRL';
    const result = await broker.latestFx(pairs);
    return sendJson(res, result?.ok ? 200 : 503, sanitizeStatus(result));
  }

  const cepMatch = path.match(/^\/api\/v1\/data\/cep\/(\d{5}-?\d{3}|\d{8})$/);
  if (req.method === 'GET' && cepMatch) {
    const result = await broker.lookupCep(cepMatch[1]);
    return sendJson(res, result?.ok ? 200 : 503, sanitizeStatus(result));
  }

  if (req.method === 'GET' && path === '/api/v1/data/flight-status') {
    const url = query(req.url);
    const result = await broker.latestFlightStatus({
      carrier: url.searchParams.get('carrier'),
      flight: url.searchParams.get('flight'),
      date: url.searchParams.get('date')
    });
    const status = result?.ok ? 200 : result?.code === 'INVALID_FLIGHT_QUERY' ? 400 : 503;
    return sendJson(res, status, sanitizeStatus(result));
  }

  if (['GET', 'HEAD'].includes(req.method) && path.startsWith('/api/v1/data/')) {
    return sendJson(res, 404, { ok: false, error: 'travel_data_route_not_found' });
  }

  return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
}

function sanitizeStatus(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const clone = JSON.parse(JSON.stringify(payload));
  scrubSecrets(clone);
  clone.secretsExposed = false;
  return clone;
}

function scrubSecrets(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(scrubSecrets);
    return;
  }
  for (const key of Object.keys(value)) {
    if (/(secret|token|api[_-]?key|authorization|password|credential)/i.test(key)) {
      delete value[key];
      continue;
    }
    scrubSecrets(value[key]);
  }
}

function query(rawUrl) {
  try { return new URL(rawUrl || '/', 'http://voyage.local'); } catch { return new URL('http://voyage.local/'); }
}

function sendJson(res, statusCode, payload) {
  if (res.writableEnded) return true;
  const data = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
  return true;
}
