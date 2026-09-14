import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrustedApiOrigin } from '../app/www/api-origin.js';

test('web browser sessions stay same-origin even when a meta API origin exists', () => {
  assert.equal(resolveTrustedApiOrigin({
    configured: 'https://api.example.com',
    pageOrigin: 'https://crewcheck.online'
  }), '');
});

test('Capacitor shell may use a build-time HTTPS API origin', () => {
  assert.equal(resolveTrustedApiOrigin({
    configured: 'https://api.example.com/voyage',
    pageOrigin: 'https://localhost'
  }), 'https://api.example.com');

  assert.equal(resolveTrustedApiOrigin({
    configured: 'https://api.example.com',
    pageOrigin: 'capacitor://localhost'
  }), 'https://api.example.com');
});

test('Capacitor shell rejects insecure or credential-bearing API origins', () => {
  assert.equal(resolveTrustedApiOrigin({ configured: 'http://api.example.com', pageOrigin: 'https://localhost' }), '');
  assert.equal(resolveTrustedApiOrigin({ configured: 'https://user:pass@api.example.com', pageOrigin: 'https://localhost' }), '');
  assert.equal(resolveTrustedApiOrigin({ configured: 'https://api.example.com?next=evil', pageOrigin: 'https://localhost' }), '');
  assert.equal(resolveTrustedApiOrigin({ configured: 'not-a-url', pageOrigin: 'https://localhost' }), '');
});
