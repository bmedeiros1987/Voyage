import { readFile } from 'node:fs/promises';
import { createConnection } from 'mysql2/promise';
import { parseTidbDatabaseUrl } from '../src/persistence.mjs';
const config = parseTidbDatabaseUrl(process.env.DATABASE_URL);
if (!process.env.VOYAGE_DATABASE_NAME || config.database !== process.env.VOYAGE_DATABASE_NAME || /crewcheck/i.test(config.database)) throw new Error('dedicated_voyage_database_confirmation_required');
const connection = await createConnection({ ...config, ssl: { ...config.ssl } });
try {
  for (const name of ['001_initial.sql', '006_auth_sessions_itinerary_proposals.sql', '008_operational_journeys.sql']) {
    const sql = (await readFile(new URL('../db/' + name, import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
    for (const statement of sql.split(';').filter((part) => part.trim())) await connection.query(statement);
    console.log(JSON.stringify({ migration: name, status: 'applied' }));
  }
} finally { await connection.end(); }
