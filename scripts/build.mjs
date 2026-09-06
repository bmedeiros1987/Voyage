import { access } from 'node:fs/promises';

const required = [
  'src/server.mjs',
  'src/config.mjs',
  'src/availability.mjs',
  'app/www/index.html',
  'app/www/styles.css',
  'app/www/app.js'
];

for (const file of required) {
  await access(new URL(`../${file}`, import.meta.url));
}

console.log('Voyage build validation passed.');
