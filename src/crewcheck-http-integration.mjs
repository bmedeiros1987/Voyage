import { timingSafeEqual } from 'node:crypto';
import { buildCrewCheckBridgePreview, crewCheckIntegrationCapabilities } from './crewcheck-integration.mjs';

const MAX_BODY_BYTES = 256 * 1024;
const FORBIDDEN_KEY = /(password|passcode|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|cpf|card[_-]?(number|cvv|cvc)|pnr|private[_-]?address)/i;

export async function handleCrewCheckIntegrationHttp(req, res, path) {
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
