import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const indexPath = fileURLToPath(new URL('../www/index.html', import.meta.url));

export function buildOperationalIndex(indexHtml) {
  const source = String(indexHtml || '');
  const required = [
    'data-screen="welcome"',
    'data-screen="journeys"',
    'signature-experience.js',
    'adaptive-home.js',
    'app.js',
    'operational-shell.js',
    'import-enhancements.js',
    'native-pdf-share.js'
  ];
  if (!source.includes('</head>') || !source.includes('</body>')) throw new Error('voyage_operational_product_shell_invalid');
  for (const marker of required) {
    if (!source.includes(marker)) throw new Error(`voyage_operational_product_shell_missing:${marker}`);
  }
  const apiOriginHooks = source.match(/name="voyage-api-origin"/g) || [];
  if (apiOriginHooks.length !== 1) throw new Error('voyage_operational_api_origin_hook_invalid');
  if (source.includes('src="./launch.js"')) throw new Error('voyage_minimal_launch_must_not_replace_product_shell');
  return source;
}

export async function configureOperationalEntry({ source = indexPath, destination = indexPath } = {}) {
  const productShell = await readFile(source, 'utf8');
  const output = buildOperationalIndex(productShell);
  await writeFile(destination, output, 'utf8');
  return destination;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  configureOperationalEntry()
    .then((destination) => console.log(`Validated operational Voyage product shell: ${destination}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
