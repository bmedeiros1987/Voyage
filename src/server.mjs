import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getRuntimeConfig, publicConfig } from './config.mjs';
import { buildAvailabilitySummary } from './availability.mjs';
import { ingestPdfBuffer } from './pdf-ingest.mjs';
import { supportedImportCapabilities } from './import-taxonomy.mjs';
import { buildGmailDiscoveryQuery, classifyGmailCandidate, gmailRealtimeContract, parseGmailPubSubEnvelope } from './gmail-travel.mjs';
import { buildTripGraph, matchReservation, suggestTripForReservation } from './reservation-matcher.mjs';
import { buildAutomaticPlan, buildExportManifest, collaborationCapabilities, normalizeExternalItinerary, plannerCapabilities } from './trip-planner.mjs';
import { buildDietaryTravelCard, buildGroupDietarySummary, dietaryCapabilities, evaluateFoodCandidate } from './dietary-profile.mjs';

const config = getRuntimeConfig();
const MAX_JSON_BYTES = 256 * 1024;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const STATIC_FILES = buildStaticMap();

const server = http.createServer(async (req, res) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const path = safePath(req.url);

  try {
    setSecurityHeaders(res, requestId);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === 'GET' && path === '/health') {
      return json(res, 200, {
        status: 'ok',
        service: 'voyage-api',
        app: config.appName,
        environment: config.nodeEnv,
        database: config.databaseConfigured ? 'configured' : 'not_configured',
        googleLogin: config.google.loginConfigured ? 'configured' : 'not_configured',
        gmail: config.google.gmailConfigured ? 'configured' : 'not_configured',
        universalImporter: 'enabled',
        automaticTripPlanner: 'enabled',
        dietarySafety: 'enabled',
        webShell: 'enabled',
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'GET' && path === '/api/v1/config') {
      return json(res, 200, publicConfig(config));
    }

    if (req.method === 'GET' && path === '/api/v1/auth/google/status') {
      return json(res, 200, {
        enabled: config.google.loginConfigured,
        scopes: ['openid', 'email', 'profile'],
        principle: 'Google Login is isolated from Gmail authorization.'
      });
    }

    if (req.method === 'GET' && path === '/api/v1/imports/capabilities') {
      return json(res, 200, {
        ...supportedImportCapabilities(),
        pdfTextExtraction: 'best_effort_machine_readable_pdf',
        scannedPdfPolicy: 'Accept the file and mark NEEDS_REVIEW until OCR is available.',
        unknownDocumentPolicy: 'Import as OTHER rather than silently discarding.'
      });
    }

    if (req.method === 'POST' && path === '/api/v1/imports/pdf') {
      requireContentType(req, 'application/pdf');
      const body = await readRaw(req, MAX_PDF_BYTES);
      const result = ingestPdfBuffer(body, {
        fileName: header(req, 'x-voyage-filename') || 'document.pdf',
        categoryHint: header(req, 'x-voyage-category') || null,
        provider: header(req, 'x-voyage-provider') || 'manual_pdf'
      });
      return json(res, 200, result);
    }

    if (req.method === 'POST' && path === '/api/v1/imports/manual/preview') {
      const body = await readJson(req, MAX_JSON_BYTES);
      const classification = body.category || 'OTHER';
      const userConfirmed = body.confirmedByUser === true;
      return json(res, 200, {
        importId: randomUUID(),
        status: userConfirmed ? 'PARSED' : 'NEEDS_REVIEW',
        source: 'manual',
        document: {
          category: classification,
          title: String(body.title || 'Item da viagem').slice(0, 220),
          provider: body.provider ? String(body.provider).slice(0, 160) : null,
          confirmationCode: body.confirmationCode ? String(body.confirmationCode).slice(0, 120) : null,
          startsAt: body.startsAt || null,
          endsAt: body.endsAt || null,
          location: body.location ? String(body.location).slice(0, 300) : null,
          notes: body.notes ? String(body.notes).slice(0, 2000) : null,
          confirmedByUser: userConfirmed
        },
        review: userConfirmed ? { required: false, reasons: [] } : { required: true, reasons: ['MANUAL_CONFIRMATION_REQUIRED'] }
      });
    }

    if (req.method === 'GET' && path === '/api/v1/integrations/gmail/status') {
      return json(res, 200, {
        enabled: config.google.gmailConfigured,
        pushSyncEnabled: config.google.gmailConfigured && config.google.pubsubConfigured,
        requestedScope: 'https://www.googleapis.com/auth/gmail.readonly',
        discoveryQuery: buildGmailDiscoveryQuery(),
        contract: gmailRealtimeContract(),
        storagePolicy: 'Store structured travel facts; avoid long-term retention of irrelevant message bodies.'
      });
    }

    if (req.method === 'POST' && path === '/api/v1/integrations/gmail/message/preview') {
      const body = await readJson(req, MAX_JSON_BYTES);
      return json(res, 200, classifyGmailCandidate(body));
    }

    if (req.method === 'POST' && path === '/api/v1/integrations/gmail/pubsub') {
      const body = await readJson(req, MAX_JSON_BYTES);
      const notification = parseGmailPubSubEnvelope(body);
      return json(res, 202, {
        accepted: true,
        notification,
        action: config.google.gmailConfigured && config.google.pubsubConfigured ? 'PROCESS_GMAIL_HISTORY' : 'DEFER_UNTIL_GMAIL_CONFIGURED'
      });
    }

    if (req.method === 'POST' && path === '/api/v1/trips/graph/preview') {
      const body = await readJson(req, MAX_JSON_BYTES);
      const reservations = Array.isArray(body.reservations) ? body.reservations.slice(0, 200) : [];
      const incoming = body.incoming && typeof body.incoming === 'object' ? body.incoming : null;
      return json(res, 200, {
        graph: buildTripGraph(reservations),
        reservationMatch: incoming ? matchReservation(reservations, incoming) : null,
        tripSuggestion: incoming && Array.isArray(body.trips) ? suggestTripForReservation(body.trips.slice(0, 100), incoming) : null
      });
    }

    if (req.method === 'POST' && path === '/api/v1/availability/preview') {
      const body = await readJson(req, MAX_JSON_BYTES);
      return json(res, 200, buildAvailabilitySummary(body));
    }

    if (req.method === 'GET' && path === '/api/v1/planner/capabilities') {
      return json(res, 200, plannerCapabilities());
    }

    if (req.method === 'POST' && path === '/api/v1/planner/preview') {
      const body = await readJson(req, MAX_JSON_BYTES);
      return json(res, 200, buildAutomaticPlan(body));
    }

    if (req.method === 'POST' && path === '/api/v1/planner/external-itinerary/preview') {
      const body = await readJson(req, MAX_JSON_BYTES);
      return json(res, 200, normalizeExternalItinerary(body));
    }

    if (req.method === 'GET' && path === '/api/v1/planner/collaboration/capabilities') {
      return json(res, 200, collaborationCapabilities());
    }

    if (req.method === 'POST' && path === '/api/v1/planner/export/manifest') {
      const body = await readJson(req, MAX_JSON_BYTES);
      return json(res, 200, buildExportManifest(body));
    }

    if (req.method === 'GET' && path === '/api/v1/dietary/capabilities') {
      return json(res, 200, dietaryCapabilities());
    }

    if (req.method === 'POST' && path === '/api/v1/dietary/venue-check') {
      const body = await readJson(req, MAX_JSON_BYTES);
      return json(res, 200, evaluateFoodCandidate(body.candidate || {}, body.profile || {}));
    }

    if (req.method === 'POST' && path === '/api/v1/dietary/group-summary') {
      const body = await readJson(req, MAX_JSON_BYTES);
      return json(res, 200, buildGroupDietarySummary(body.travellers || []));
    }

    if (req.method === 'POST' && path === '/api/v1/dietary/travel-card') {
      const body = await readJson(req, MAX_JSON_BYTES);
      return json(res, 200, buildDietaryTravelCard(body.profile || {}, body.locale || 'pt-BR'));
    }

    if (req.method === 'GET' && path === '/api/v1/trips/demo') {
      return json(res, 200, demoTrips());
    }

    if (req.method === 'GET' && STATIC_FILES.has(path)) {
      return serveStatic(res, STATIC_FILES.get(path));
    }

    return json(res, 404, { error: 'not_found', requestId });
  } catch (error) {
    const statusCode = statusForError(error);
    const errorCode = publicErrorCode(error);
    console.error(JSON.stringify({
      level: statusCode >= 500 ? 'error' : 'warn',
      event: 'request_failed',
      requestId,
      errorCode,
      message: error instanceof Error ? error.message : 'unknown_error'
    }));
    return json(res, statusCode, { error: errorCode, requestId });
  } finally {
    console.log(JSON.stringify({
      level: 'info',
      event: 'request_complete',
      requestId,
      method: req.method,
      path,
      durationMs: Date.now() - startedAt,
      statusCode: res.statusCode
    }));
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', event: 'server_started', service: 'voyage-api', port: config.port, environment: config.nodeEnv }));
});

function buildStaticMap() {
  const definitions = [
    ['index.html', 'text/html; charset=utf-8'],
    ['styles.css', 'text/css; charset=utf-8'],
    ['themes.css', 'text/css; charset=utf-8'],
    ['imports.css', 'text/css; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['import-enhancements.js', 'text/javascript; charset=utf-8'],
    ['service-worker.js', 'text/javascript; charset=utf-8'],
    ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']
  ];
  const map = new Map();
  for (const [name, contentType] of definitions) {
    const entry = { url: new URL(`../app/www/${name}`, import.meta.url), contentType, name };
    map.set(`/${name}`, entry);
    map.set(`/voyage/${name}`, entry);
  }
  map.set('/', map.get('/index.html'));
  map.set('/voyage', map.get('/voyage/index.html'));
  map.set('/voyage/', map.get('/voyage/index.html'));
  return map;
}

async function serveStatic(res, entry) {
  const data = await readFile(entry.url);
  res.statusCode = 200;
  res.setHeader('Content-Type', entry.contentType);
  res.setHeader('Content-Length', data.length);
  res.setHeader('Cache-Control', entry.name === 'service-worker.js' ? 'no-cache' : 'public, max-age=300');
  res.end(data);
}

function setSecurityHeaders(res, requestId) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Access-Control-Allow-Origin', corsOrigin());
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Voyage-Filename, X-Voyage-Category, X-Voyage-Provider');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function corsOrigin() {
  try { return new URL(config.appUrl).origin; } catch { return config.appUrl; }
}

function json(res, statusCode, payload) {
  if (res.writableEnded) return;
  const data = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
}

async function readJson(req, maxBytes) {
  const raw = await readRaw(req, maxBytes);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch { throw namedError('invalid_json'); }
}

async function readRaw(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw namedError('request_body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function requireContentType(req, expected) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== expected) throw namedError('unsupported_content_type');
}

function header(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value ? String(value) : null;
}

function safePath(url = '/') {
  try { return new URL(url, 'http://localhost').pathname; } catch { return '/'; }
}

function namedError(message) {
  const error = new Error(message);
  error.code = message;
  return error;
}

function publicErrorCode(error) {
  const known = new Set([
    'request_body_too_large', 'invalid_json', 'unsupported_content_type', 'pdf_buffer_required', 'empty_pdf',
    'pdf_too_large', 'invalid_pdf_signature', 'gmail_pubsub_message_data_required', 'gmail_pubsub_data_invalid', 'gmail_pubsub_payload_incomplete'
  ]);
  return known.has(error?.message) ? error.message : 'internal_error';
}

function statusForError(error) {
  if (['request_body_too_large', 'pdf_too_large'].includes(error?.message)) return 413;
  if (['unsupported_content_type'].includes(error?.message)) return 415;
  if (publicErrorCode(error) !== 'internal_error') return 400;
  return 500;
}

function demoTrips() {
  return {
    trips: [
      { id: 'demo-italia-2027', title: 'Itália 2027', subtitle: 'Roma · Florença · Milão', startDate: '2027-05-12', endDate: '2027-05-24', participants: 6, status: 'PLANNING', cover: 'italy' },
      { id: 'demo-new-york-2025', title: 'Nova York', subtitle: 'Manhattan', startDate: '2025-10-15', endDate: '2025-10-22', participants: 2, status: 'CONFIRMED', cover: 'new-york' }
    ]
  };
}
