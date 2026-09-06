import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { getRuntimeConfig, publicConfig } from './config.mjs';
import { buildAvailabilitySummary } from './availability.mjs';

const config = getRuntimeConfig();

const server = http.createServer(async (req, res) => {
  const requestId = randomUUID();
  const startedAt = Date.now();

  try {
    setSecurityHeaders(res, requestId);

    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, {
        status: 'ok',
        service: 'voyage-api',
        app: config.appName,
        environment: config.nodeEnv,
        database: config.databaseConfigured ? 'configured' : 'not_configured',
        googleLogin: config.google.loginConfigured ? 'configured' : 'not_configured',
        gmail: config.google.gmailConfigured ? 'configured' : 'not_configured',
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'GET' && req.url === '/api/v1/config') {
      return json(res, 200, publicConfig(config));
    }

    if (req.method === 'GET' && req.url === '/api/v1/auth/google/status') {
      return json(res, 200, {
        enabled: config.google.loginConfigured,
        scopes: ['openid', 'email', 'profile'],
        principle: 'Google Login is isolated from Gmail authorization.'
      });
    }

    if (req.method === 'GET' && req.url === '/api/v1/integrations/gmail/status') {
      return json(res, 200, {
        enabled: config.google.gmailConfigured,
        pushSyncEnabled: config.google.gmailConfigured && config.google.pubsubConfigured,
        requestedScope: 'https://www.googleapis.com/auth/gmail.readonly',
        storagePolicy: 'Store structured travel facts; avoid long-term retention of irrelevant message bodies.'
      });
    }

    if (req.method === 'POST' && req.url === '/api/v1/availability/preview') {
      const body = await readJson(req);
      return json(res, 200, buildAvailabilitySummary(body));
    }

    if (req.method === 'GET' && req.url === '/api/v1/trips/demo') {
      return json(res, 200, demoTrips());
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    return json(res, 404, { error: 'not_found', requestId });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'request_failed',
      requestId,
      message: error instanceof Error ? error.message : 'unknown_error'
    }));
    return json(res, 500, { error: 'internal_error', requestId });
  } finally {
    console.log(JSON.stringify({
      level: 'info',
      event: 'request_complete',
      requestId,
      method: req.method,
      path: safePath(req.url),
      durationMs: Date.now() - startedAt,
      statusCode: res.statusCode
    }));
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(JSON.stringify({
    level: 'info',
    event: 'server_started',
    service: 'voyage-api',
    port: config.port,
    environment: config.nodeEnv
  }));
});

function setSecurityHeaders(res, requestId) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Access-Control-Allow-Origin', config.appUrl);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function json(res, statusCode, payload) {
  if (res.writableEnded) return;
  const data = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('request_body_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function safePath(url = '/') {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function demoTrips() {
  return {
    trips: [
      {
        id: 'demo-italia-2027',
        title: 'Itália 2027',
        subtitle: 'Roma · Florença · Milão',
        startDate: '2027-05-12',
        endDate: '2027-05-24',
        participants: 6,
        status: 'PLANNING',
        cover: 'italy'
      },
      {
        id: 'demo-new-york-2025',
        title: 'Nova York',
        subtitle: 'Manhattan',
        startDate: '2025-10-15',
        endDate: '2025-10-22',
        participants: 2,
        status: 'CONFIRMED',
        cover: 'new-york'
      }
    ]
  };
}
