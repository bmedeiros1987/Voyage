// Each confirmation is one atomic insert: retrying never creates a second journey.
export function createJourneyStore(execute) {
  const imports = new Map();
  const journeys = new Map();
  const decode = (row) => row ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) : null;
  return {
    async checkReady() {
      if (execute) {
        // Read-only schema checks; a configured URL alone is not readiness.
        await execute('SELECT id,token_fingerprint FROM user_sessions LIMIT 0');
        await execute('SELECT id,deleted_at FROM users LIMIT 0');
        await execute('SELECT provider,provider_subject FROM identities LIMIT 0');
        await execute('SELECT id,user_id,payload FROM voyage_imports LIMIT 0');
        await execute('SELECT id,user_id,import_id,payload FROM voyage_journeys LIMIT 0');
      }
      return true;
    },
    async saveImport(userId, record) {
      if (execute) await execute('INSERT INTO voyage_imports (id,user_id,payload) VALUES (?,?,?)', [record.importId, userId, JSON.stringify(record)]);
      else imports.set(record.importId, { userId, record: structuredClone(record) });
      return record;
    },
    async readImport(userId, id) {
      if (execute) {
        const [rows] = await execute('SELECT payload FROM voyage_imports WHERE id=? AND user_id=?', [id, userId]);
        return decode(rows[0]);
      }
      const entry = imports.get(id);
      return entry?.userId === userId ? structuredClone(entry.record) : null;
    },
    async saveJourney(userId, record) {
      if (execute) {
        await execute('INSERT INTO voyage_journeys (id,user_id,import_id,payload) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=id', [record.id, userId, record.importId, JSON.stringify(record)]);
        const [rows] = await execute('SELECT payload FROM voyage_journeys WHERE user_id=? AND import_id=?', [userId, record.importId]);
        return decode(rows[0]);
      }
      const existing = [...journeys.values()].find((entry) => entry.userId === userId && entry.record.importId === record.importId);
      if (existing) return structuredClone(existing.record);
      journeys.set(record.id, { userId, record: structuredClone(record) });
      return structuredClone(record);
    },
    async readJourney(userId, id) {
      if (execute) {
        const [rows] = await execute('SELECT payload FROM voyage_journeys WHERE id=? AND user_id=?', [id, userId]);
        return decode(rows[0]);
      }
      const entry = journeys.get(id);
      return entry?.userId === userId ? structuredClone(entry.record) : null;
    },
    async listJourneys(userId) {
      if (execute) {
        const [rows] = await execute('SELECT payload FROM voyage_journeys WHERE user_id=? ORDER BY created_at DESC LIMIT 100', [userId]);
        return rows.map(decode);
      }
      return [...journeys.values()].filter((entry) => entry.userId === userId).reverse().slice(0, 100).map((entry) => structuredClone(entry.record));
    }
  };
}
