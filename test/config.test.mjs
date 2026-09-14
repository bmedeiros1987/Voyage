import test from 'node:test';
import assert from 'node:assert/strict';
import { getRuntimeConfig, isConfigured } from '../src/config.mjs';
import { normalizeAvailabilityInput } from '../src/availability.mjs';

test('placeholder values are never treated as configured secrets', () => {
  assert.equal(isConfigured('value'), false);
  assert.equal(isConfigured('CHANGEme'), false);
  assert.equal(isConfigured('real-client-id'), true);
});

test('gmail remains disabled while Render placeholders exist', () => {
  const config = getRuntimeConfig({
    GOOGLE_CLIENT_ID: 'value',
    GOOGLE_CLIENT_SECRET: 'value',
    GOOGLE_REDIRECT_URI: 'value',
    TOKEN_ENCRYPTION_KEY: 'value'
  });
  assert.equal(config.google.loginConfigured, false);
  assert.equal(config.google.gmailConfigured, false);
});

test('Pub/Sub remains fail-closed until audience, topic, and expected service account are all configured', () => {
  const incomplete = getRuntimeConfig({
    GOOGLE_PUBSUB_TOPIC: 'projects/example/topics/gmail',
    GOOGLE_PUBSUB_AUDIENCE: 'https://example.test/api/v1/integrations/gmail/pubsub'
  });
  assert.equal(incomplete.google.pubsubConfigured, false);
  assert.equal(incomplete.google.pubsubServiceAccountEmail, null);

  const configured = getRuntimeConfig({
    GOOGLE_PUBSUB_TOPIC: 'projects/example/topics/gmail',
    GOOGLE_PUBSUB_AUDIENCE: 'https://example.test/api/v1/integrations/gmail/pubsub',
    GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL: ' Voyage-Push@Example.IAM.GServiceAccount.com '
  });
  assert.equal(configured.google.pubsubConfigured, true);
  assert.equal(configured.google.pubsubServiceAccountEmail, 'voyage-push@example.iam.gserviceaccount.com');
});

test('crew member still carries explicit desired days', () => {
  const profile = normalizeAvailabilityInput({
    userType: 'CREW_MEMBER',
    desiredDays: 4,
    crewcheckLinked: true
  });
  assert.equal(profile.userType, 'CREW_MEMBER');
  assert.equal(profile.desiredDays, 4);
  assert.equal(profile.crewcheckLinked, true);
});
