import { access } from 'node:fs/promises';

const required = [
  'src/server.mjs',
  'src/config.mjs',
  'src/availability.mjs',
  'src/travel-source.mjs',
  'src/import-taxonomy.mjs',
  'src/pdf-ingest.mjs',
  'src/gmail-travel.mjs',
  'src/google-gmail-client.mjs',
  'src/google-oauth.mjs',
  'src/token-crypto.mjs',
  'src/reservation-matcher.mjs',
  'src/intelligence-http.mjs',
  'src/travel-data-broker.mjs',
  'src/travel-data-http.mjs',
  'src/travel-health-intelligence.mjs',
  'src/civp-guidance.mjs',
  'src/arrival-intelligence.mjs',
  'src/baggage-passport-intelligence.mjs',
  'src/journey-command-center.mjs',
  'src/journey-readiness.mjs',
  'src/crewcheck-http-integration.mjs',
  'db/001_initial.sql',
  'db/002_universal_importer.sql',
  'app/www/index.html',
  'app/www/styles.css',
  'app/www/themes.css',
  'app/www/premium-layout.css',
  'app/www/premium-overrides.css',
  'app/www/signature-experience.css',
  'app/www/adaptive-home.css',
  'app/www/responsive-hardening.css',
  'app/www/signature-experience.js',
  'app/www/adaptive-home.js',
  'app/www/imports.css',
  'app/www/api-origin.js',
  'app/www/retention-policy.js',
  'app/www/app.js',
  'app/www/import-enhancements.js',
  'app/www/native-pdf-share.js',
  'app/www/service-worker.js',
  'app/www/manifest.webmanifest'
];

for (const file of required) {
  await access(new URL(`../${file}`, import.meta.url));
}

console.log('Voyage build validation passed.');
