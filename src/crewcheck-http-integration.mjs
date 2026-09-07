import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildCrewCheckBridgePreview, crewCheckIntegrationCapabilities } from './crewcheck-integration.mjs';
import { handleIntelligenceHttp } from './intelligence-http.mjs';
import { handleTravelDataHttp } from './travel-data-http.mjs';

const MAX_BODY_BYTES = 256 * 1024;
const FORBIDDEN_KEY = /(password|passcode|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|cpf|card[_-]?(number|cvv|cvc)|pnr|private[_-]?address)/i;
const AUXILIARY_ASSETS = new Map([
  ['premium-layout.css', 'text/css; charset=utf-8'],
  ['premium-overrides.css', 'text/css; charset=utf-8'],
  ['signature-experience.css', 'text/css; charset=utf-8'],
  ['signature-experience.js', 'text/javascript; charset=utf-8']
]);

export async function handleCrewCheckIntegrationHttp(req, res, path) {
  // This handler is mounted by the main server before legacy routes. Shared data,
  // intelligence and lightweight premium assets are delegated here so Voyage can
  // evolve without repeatedly rewriting the monolithic server route table.
  if (req.method === 'GET' && await serveAuxiliaryAsset(res, path)) return true;
  if (await handleTravelDataHttp(req, res, path)) return true;
  if (await handleIntelligenceHttp(req, res, path)) return true;

  if (req.method === 'GET' && path === '/api/v1/integrations/crewcheck/capabilities') {
    return sendJson(res, 200, {
      ok: true,
      ...crewCheckIntegrationCapabilities(),
      configured: sharedSecretConfigured()
    });
  }

  if (req.method === 'POST' && path === '/api/v1/integrations/crewcheck/preview') {
    if (!sharedSecretConfigured()) {
      return sendJson(res, 503, { ok: false, error: 'crewcheck_bridge_not_configured' });
    }
    if (!authorized(req)) {
      return sendJson(res, 401, { ok: false, error: 'crewcheck_bridge_unauthorized' });
    }

    const body = await readJson(req, MAX_BODY_BYTES);
    const forbidden = findForbiddenPath(body);
    if (forbidden) {
      return sendJson(res, 400, {
        ok: false,
        error: 'crewcheck_bridge_forbidden_field',
        field: forbidden
      });
    }

    return sendJson(res, 200, {
      ok: true,
      bridge: buildCrewCheckBridgePreview(body)
    });
  }

  return false;
}

async function serveAuxiliaryAsset(res, path) {
  const normalized = String(path || '').replace(/^\/voyage\/?/, '/').replace(/^\//, '');
  const contentType = AUXILIARY_ASSETS.get(normalized);
  if (!contentType) return false;
  try {
    const data = await readFile(new URL(`../app/www/${normalized}`, import.meta.url));
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', data.length);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function sharedSecretConfigured() {
  return Boolean(sharedSecret());
}

function sharedSecret() {
  return String(process.env.CREWCHECK_SHARED_SERVICES_TOKEN || '').trim();
}

function presentedSecret(req) {
  const explicit = String(req.headers['x-crewcheck-service-token'] || '').trim();
  if (explicit) return explicit;
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  return String(bearer || '').trim();
}

function authorized(req) {
  const expected = sharedSecret();
  const presented = presentedSecret(req);
  if (!expected || !presented) return false;
  try {
    const left = Buffer.from(expected);
    const right = Buffer.from(presented);
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

async function readJson(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, 'crewcheck_bridge_body_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'crewcheck_bridge_invalid_json');
  }
}

function findForbiddenPath(value, prefix = '') {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findForbiddenPath(value[index], `${prefix}[${index}]`);
      if (match) return match;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    const current = prefix ? `${prefix}.${key}` : key;
    if (FORBIDDEN_KEY.test(key)) return current;
    const match = findForbiddenPath(child, current);
    if (match) return match;
  }
  return null;
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

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = message;
  return error;
}
