import { access } from 'node:fs/promises';

const required = [
  'src/server.mjs',
  'src/config.mjs',
  'src/availability.mjs',
  'src/travel-source.mjs',
  'src/import-taxonomy.mjs',
  'src/pdf-ingest.mjs',
  'src/gmail-travel.mjs',
  'src/reservation-matcher.mjs',
  'db/001_initial.sql',
  'db/002_universal_importer.sql',
  'app/www/index.html',
  'app/www/styles.css',
  'app/www/themes.css',
  'app/www/imports.css',
  'app/www/app.js',
  'app/www/service-worker.js',
  'app/www/manifest.webmanifest'
];

for (const file of required) {
  await access(new URL(`../${file}`, import.meta.url));
}

console.log('Voyage build validation passed.');
