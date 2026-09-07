import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
let portOffset = 0;

const validEnvelope = {
  message: {
    data: Buffer.from(JSON.stringify({ emailAddress: 'user@example.com', historyId: '123' })).toString('base64'),
    messageId: 'message-1'
  }
};

test('planner proposal HTTP route is mounted and fails closed when authentication is not configured', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/planner/itinerary/proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tripId: 'trip-1', baseVersion: 0, changes: [{ op: 'replace', path: '/title', value: 'Test' }] })
    });
    assert.equal(response.status, 503);
  });
});

test('planner proposal HTTP route requires Bearer authentication when session signing is configured', async () => {
  await withServer({ SESSION_SIGNING_KEY: '0123456789abcdef0123456789abcdef' }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/planner/itinerary/proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tripId: 'trip-1', baseVersion: 0, changes: [{ op: 'replace', path: '/title', value: 'Test' }] })
    });
    assert.equal(response.status, 401);
  });
});

test('Gmail Pub/Sub fails closed when push verification is not configured', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/integrations/gmail/pubsub`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validEnvelope)
    });
    assert.equal(response.status, 503);
  });
});

test('configured Gmail Pub/Sub requires a Bearer OIDC token before accepting an envelope', async () => {
  await withServer({
    GOOGLE_PUBSUB_TOPIC: 'projects/example/topics/voyage',
    GOOGLE_PUBSUB_AUDIENCE: 'https://voyage.example/api/v1/integrations/gmail/pubsub'
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/integrations/gmail/pubsub`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validEnvelope)
    });
    assert.equal(response.status, 401);
  });
});

async function withServer(extraEnv, operation) {
  const port = 41000 + ((process.pid + portOffset++) % 15000);
  const server = spawn(process.execPath, ['src/server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      APP_URL: `http://127.0.0.1:${port}`,
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForReady(server);
    await operation(`http://127.0.0.1:${port}`);
  } finally {
    if (!server.killed) server.kill('SIGTERM');
  }
}

function waitForReady(server) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`server_start_timeout: ${stderr}`)), 5000);
    server.stderr.setEncoding('utf8');
    server.stdout.setEncoding('utf8');
    server.stderr.on('data', (chunk) => { stderr += chunk; });
    server.stdout.on('data', (chunk) => {
      if (chunk.includes('"event":"server_started"')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server_exited_before_ready:${code}: ${stderr}`));
    });
  });
}
