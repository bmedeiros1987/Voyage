import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createMemoryPersistence } from '../src/persistence.mjs';
import { handleGoogleAuthHttp } from '../src/google-auth-http.mjs';
import { handleJourneyHttp } from '../src/journey-http.mjs';
import { authenticatePersistedSession } from '../src/auth-session.mjs';
import { reviewFields } from '../app/www/launch.js';

const key = 'test-only-voyage-session-key-32-bytes';
test('HTTP login → PDF → review → journey → new login; rejects other users and revoked sessions', async (t) => {
  const persistence = createMemoryPersistence();
  let subject = 'traveler-a';
  const config = { appUrl: 'https://voyage.example/', session: { signingKey: key }, google: { clientId: 'voyage-test', clientSecret: 'test', redirectUri: 'https://voyage.example/api/v1/auth/google/callback' } };
  // Only Google is stubbed. The HTTP handlers, signed state, browser binding,
  // canonical session validation, PDF parser and persistence adapter are real.
  const fetchImpl = async (url) => new Response(JSON.stringify(url.endsWith('/token') ? { access_token: 'test', scope: 'openid email profile', expires_in: 3600 } : { sub: subject, email: `${subject}@example.test`, email_verified: true }));
  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (await handleGoogleAuthHttp(req, res, path, { config, persistence, fetchImpl })) return;
      if (await handleJourneyHttp(req, res, path, { persistence, sessionSigningKey: key })) return;
      if (path === '/logout') {
        const auth = await authenticatePersistedSession(req, key, persistence);
        await persistence.revokeSession(auth.sessionId); res.end('{}'); return;
      }
      res.statusCode = 404; res.end('{}');
    } catch (error) { res.statusCode = error.statusCode || 500; res.end(JSON.stringify({ error: error.message })); }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login() {
    const start = await fetch(base + '/api/v1/auth/google/start', { redirect: 'manual' });
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const callback = await fetch(base + '/api/v1/auth/google/callback?code=test&state=' + encodeURIComponent(state), { redirect: 'manual', headers: { Cookie: start.headers.get('set-cookie').split(';')[0] } });
    assert.equal(callback.status, 302);
    return new URLSearchParams(new URL(callback.headers.get('location')).hash.slice(1)).get('voyage_session');
  }
  let token = await login();
  const call = (path, options = {}) => fetch(base + '/api/v1/journeys' + path, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
  assert.equal((await fetch(base + '/api/v1/journeys')).status, 401);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 100 >>\nstream\nBT (Boarding pass LATAM Flight LA1234 GRU to GIG 18/09/2026 10:20 Confirmation ABC123) Tj ET\nendstream\nendobj\n%%EOF');
  const uploaded = await call('/imports/pdf', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: pdf });
  assert.equal(uploaded.status, 201); const imported = await uploaded.json();
  assert.ok(imported.textPreview.includes('Boarding pass'));
  const reviewed = Object.fromEntries(reviewFields(imported.facts).map(({ key, value }) => [key, value]));
  assert.equal(reviewed.route_origin, 'GRU');
  assert.equal(reviewed.route_destination, 'GIG');
  assert.equal(reviewed.dateMentions_1, '18/09/2026');
  assert.equal(reviewed.timeMentions_1, '10:20');
  const body = { importId: imported.importId, title: 'Minha viagem', facts: { ...reviewed, flightNumber: 'LA1234', route_destination: 'BSB', timeMentions_1: '11:20', notes: 'Conferido no documento original' }, confirmed: true };
  const post = (value) => call('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await post({ ...body, confirmed: false })).status, 400);
  assert.equal((await post({ ...body, facts: { flightNumber: {} } })).status, 400);
  const saved = await post(body); assert.equal(saved.status, 201); const journey = await saved.json();
  const repeated = await post(body); assert.equal((await repeated.json()).id, journey.id);
  assert.equal((await (await call('')).json()).journeys.length, 1);
  const originalToken = token;
  subject = 'traveler-b'; token = await login();
  assert.equal((await call('/' + journey.id)).status, 404);
  assert.equal((await call('/imports/' + imported.importId)).status, 404);
  assert.equal((await post(body)).status, 404);
  assert.equal((await (await call('')).json()).journeys.length, 0);
  await fetch(base + '/logout', { method: 'POST', headers: { Authorization: `Bearer ${originalToken}` } });
  token = originalToken; assert.equal((await call('')).status, 401);
  subject = 'traveler-a'; token = await login();
  const reopened = await (await call('/' + journey.id)).json();
  assert.equal(reopened.facts.flightNumber, 'LA1234'); assert.equal(reopened.id, journey.id);
  assert.equal(reopened.facts.route_origin, 'GRU');
  assert.equal(reopened.facts.route_destination, 'BSB');
  assert.equal(reopened.facts.dateMentions_1, '18/09/2026');
  assert.equal(reopened.facts.timeMentions_1, '11:20');
  assert.deepEqual(reopened.extractedFacts, imported.facts);
  assert.equal(reopened.extractedFacts.route.destination, 'GIG');
});
