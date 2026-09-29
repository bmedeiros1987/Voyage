import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const launchPath = fileURLToPath(new URL('../www/launch.html', import.meta.url));
const indexPath = fileURLToPath(new URL('../www/index.html', import.meta.url));

export function buildOperationalIndex(launchHtml) {
  const source = String(launchHtml || '');
  if (!source.includes('src="./launch.js"')) throw new Error('voyage_operational_launch_script_missing');
  if (!source.includes('</head>') || !source.includes('</body>')) throw new Error('voyage_operational_launch_html_invalid');
  if (source.includes('name="voyage-api-origin"')) throw new Error('voyage_operational_api_origin_ambiguous');
  const withOrigin = source.replace('</head>', '<meta name="voyage-api-origin" content=""></head>');
  return withOrigin.replace('</body>', '<script type="module" src="./native-pdf-share.js"></script></body>');
}

export async function configureOperationalEntry({ source = launchPath, destination = indexPath } = {}) {
  const launchHtml = await readFile(source, 'utf8');
  const output = buildOperationalIndex(launchHtml);
  await writeFile(destination, output, 'utf8');
  return destination;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  configureOperationalEntry()
    .then((destination) => console.log(`Configured operational Voyage entry: ${destination}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
