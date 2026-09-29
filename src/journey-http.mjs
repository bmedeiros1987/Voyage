import { randomUUID } from 'node:crypto';
import { authenticatePersistedSession } from './auth-session.mjs';
import { ingestPdfBuffer } from './pdf-ingest.mjs';

const PREFIX = '/api/v1/journeys';
export async function handleJourneyHttp(req, res, path, { persistence, sessionSigningKey } = {}) {
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  const { userId } = await authenticatePersistedSession(req, sessionSigningKey, persistence);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST' && path === `${PREFIX}/imports/pdf`) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/pdf') return json(res, 415, { error: 'pdf_required' });
    const parsed = ingestPdfBuffer(await readBody(req, 15 * 1024 * 1024), { fileName: 'document.pdf' });
    // Text preview supports review, but isn't stored. No document body is retained.
    const { textPreview, ...record } = parsed;
    await persistence.saveImport(userId, record);
    return json(res, 201, { ...record, textPreview });
  }
  const importMatch = /^\/api\/v1\/journeys\/imports\/([a-f0-9-]{36})$/.exec(path);
  if (req.method === 'GET' && importMatch) {
    const record = await persistence.readImport(userId, importMatch[1]);
    return json(res, record ? 200 : 404, record || { error: 'not_found' });
  }
  if (req.method === 'POST' && path === PREFIX) {
    let body;
    try { body = JSON.parse((await readBody(req, 32 * 1024)).toString('utf8')); }
    catch (error) { if (error.statusCode) throw error; return json(res, 400, { error: 'invalid_json' }); }
    if (!body || body.confirmed !== true || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 180 || !/^[a-f0-9-]{36}$/.test(body.importId)) return json(res, 400, { error: 'confirmation_required' });
    const imported = await persistence.readImport(userId, body.importId);
    if (!imported) return json(res, 404, { error: 'not_found' });
    if (!body.facts || Array.isArray(body.facts) || typeof body.facts !== 'object' || Object.keys(body.facts).length > 60) return json(res, 400, { error: 'facts_invalid' });
    const facts = {};
    for (const [key, value] of Object.entries(body.facts)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || typeof value !== 'string' || value.length > 2000) return json(res, 400, { error: 'facts_invalid' });
      if (value.trim()) facts[key] = value.trim();
    }
    if (!Object.keys(facts).length) return json(res, 400, { error: 'facts_required' });
    const journey = await persistence.saveJourney(userId, {
      id: randomUUID(), importId: body.importId, title: body.title.trim(),
      facts, extractedFacts: imported.facts, source: imported.source,
      document: imported.document, reviewReasons: imported.review.reasons,
      confirmedAt: new Date().toISOString(), status: 'USER_CONFIRMED'
    });
    return json(res, 201, journey);
  }
  if (req.method === 'GET' && path === PREFIX) return json(res, 200, { journeys: await persistence.listJourneys(userId) });
  const match = /^\/api\/v1\/journeys\/([a-f0-9-]{36})$/.exec(path);
  if (req.method === 'GET' && match) {
    const journey = await persistence.readJourney(userId, match[1]);
    return json(res, journey ? 200 : 404, journey || { error: 'not_found' });
  }
  return json(res, 404, { error: 'not_found' });
}
async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) { const error = new Error('request_body_too_large'); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
  return true;
}
