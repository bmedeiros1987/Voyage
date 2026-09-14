const MY_MAPS_SCOPE = 'https://www.googleapis.com/auth/dataportability.mymaps.maps';
const SAVED_COLLECTIONS_SCOPE = 'https://www.googleapis.com/auth/dataportability.saved.collections';

export function googleMapsImportCapabilities() {
  return {
    directChatConnectorAvailable: false,
    voyageIntegrationPlanned: true,
    preferredIntegration: 'GOOGLE_DATA_PORTABILITY_API',
    supportedSources: [
      'GOOGLE_DATA_PORTABILITY_MY_MAPS',
      'GOOGLE_DATA_PORTABILITY_SAVED_COLLECTIONS',
      'GOOGLE_MAPS_SHARED_ROUTE_URL',
      'GOOGLE_MY_MAPS_KML',
      'GOOGLE_MY_MAPS_KMZ',
      'GOOGLE_MAPS_PINNED_TRIPS_EXPORT',
      'MANUAL'
    ],
    oauthScopes: {
      myMaps: MY_MAPS_SCOPE,
      savedCollections: SAVED_COLLECTIONS_SCOPE
    },
    principles: [
      'Use explicit user authorization and Google Data Portability for private Maps/My Maps data.',
      'Do not scrape private Google Maps pages or saved lists.',
      'Import data as a copy with provenance; do not mutate the source in Google Maps.',
      'Normalize imported places and routes into Voyage external itinerary imports before optimization.',
      'Shared Google Maps links are accepted as user-provided sources and may require provider-backed resolution.'
    ]
  };
}

export function buildMapsPortabilityScopes(options = {}) {
  const scopes = [];
  if (options.includeMyMaps !== false) scopes.push(MY_MAPS_SCOPE);
  if (options.includeSavedCollections !== false) scopes.push(SAVED_COLLECTIONS_SCOPE);
  return [...new Set(scopes)];
}

export function normalizeGoogleMapsSharedUrl(input = {}) {
  const raw = typeof input === 'string' ? input : input.url;
  const url = safeUrl(raw);
  if (!url) return { status: 'INVALID_SOURCE', sourceType: 'GOOGLE_MAPS_SHARED_ROUTE_URL', sourceUrl: null, items: [] };

  const host = new URL(url).hostname.toLowerCase();
  const googleHost = host === 'maps.app.goo.gl' || host.endsWith('google.com') || host.endsWith('google.com.br') || host.endsWith('googleusercontent.com');
  return {
    status: googleHost ? 'NEEDS_PROVIDER_RESOLUTION' : 'INVALID_SOURCE',
    sourceType: 'GOOGLE_MAPS_SHARED_ROUTE_URL',
    sourceUrl: googleHost ? url : null,
    items: [],
    resolverPolicy: googleHost
      ? 'Resolve through an approved Google Maps/Places/Routes integration or explicit shared-link handling; never scrape a private page.'
      : 'Only supported Google Maps links are accepted.'
  };
}

export function normalizeMyMapsKml(kmlText = '') {
  const text = String(kmlText || '');
  const placemarks = [...text.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi)].slice(0, 1000);
  const items = placemarks.map((match, index) => {
    const block = match[1];
    const title = decodeXml(extractTag(block, 'name')) || `Parada ${index + 1}`;
    const description = decodeXml(extractTag(block, 'description')) || null;
    const coordinates = extractCoordinates(block);
    return {
      externalId: `mymaps-${index + 1}`,
      title: title.slice(0, 220),
      notes: description ? description.slice(0, 1500) : null,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      sourceType: 'GOOGLE_MY_MAPS_KML'
    };
  });

  return {
    status: items.length ? 'READY_FOR_MATCHING' : 'NEEDS_REVIEW',
    sourceType: 'GOOGLE_MY_MAPS_KML',
    itemCount: items.length,
    items,
    warnings: items.length ? [] : ['NO_PLACEMARKS_FOUND']
  };
}

export function normalizeSavedCollectionsCsv(csvText = '') {
  const rows = parseCsv(String(csvText || '')).slice(0, 5000);
  if (!rows.length) return { status: 'NEEDS_REVIEW', sourceType: 'GOOGLE_DATA_PORTABILITY_SAVED_COLLECTIONS', itemCount: 0, items: [], warnings: ['EMPTY_CSV'] };

  const headerIndex = rows.findIndex((row) => row.some((cell) => /title|url|collection|note|comment/i.test(cell)));
  if (headerIndex < 0) return { status: 'NEEDS_REVIEW', sourceType: 'GOOGLE_DATA_PORTABILITY_SAVED_COLLECTIONS', itemCount: 0, items: [], warnings: ['HEADER_NOT_RECOGNIZED'] };

  const headers = rows[headerIndex].map((value) => normalizeHeader(value));
  const items = rows.slice(headerIndex + 1).filter((row) => row.some(Boolean)).map((row, index) => {
    const record = Object.fromEntries(headers.map((header, i) => [header || `column_${i + 1}`, row[i] ?? '']));
    const title = record.title || record.name || record.item_title || record.saved_item || `Lugar salvo ${index + 1}`;
    const url = safeUrl(record.url || record.link || record.item_url);
    return {
      externalId: `saved-${index + 1}`,
      title: String(title).slice(0, 220),
      sourceUrl: url,
      collection: nullable(record.collection_title || record.collection || record.list),
      notes: nullable(record.note || record.notes || record.comment || record.comments),
      sourceType: 'GOOGLE_DATA_PORTABILITY_SAVED_COLLECTIONS'
    };
  });

  return {
    status: items.length ? 'READY_FOR_MATCHING' : 'NEEDS_REVIEW',
    sourceType: 'GOOGLE_DATA_PORTABILITY_SAVED_COLLECTIONS',
    itemCount: items.length,
    items,
    warnings: []
  };
}

export function normalizePinnedTripsExport(payload = {}) {
  const trips = Array.isArray(payload.trips) ? payload.trips : Array.isArray(payload.trip) ? payload.trip : [];
  const normalized = trips.slice(0, 500).map((trip, tripIndex) => {
    const visits = Array.isArray(trip.place_visit) ? trip.place_visit : Array.isArray(trip.placeVisit) ? trip.placeVisit : [];
    return {
      externalId: String(trip.id || `pinned-trip-${tripIndex + 1}`).slice(0, 160),
      title: String(trip.name || trip.label || `Viagem fixada ${tripIndex + 1}`).slice(0, 220),
      recurrence: trip.recurrence || null,
      transportMode: nullable(trip.transport_mode || trip.transportMode || trip.mode),
      places: visits.slice(0, 200).map((visit, visitIndex) => ({
        externalId: String(visit.id || `visit-${visitIndex + 1}`).slice(0, 160),
        title: nullable(visit.name || visit.place_name || visit.placeName),
        arrivalTiming: visit.arrival_timing || visit.arrivalTiming || null,
        departureTiming: visit.departure_timing || visit.departureTiming || null,
        raw: visit
      }))
    };
  });

  return {
    status: normalized.length ? 'READY_FOR_MATCHING' : 'NEEDS_REVIEW',
    sourceType: 'GOOGLE_MAPS_PINNED_TRIPS_EXPORT',
    itemCount: normalized.length,
    trips: normalized,
    warnings: normalized.length ? [] : ['NO_PINNED_TRIPS_FOUND']
  };
}

function extractTag(text, tag) {
  const match = String(text).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : null;
}

function extractCoordinates(text) {
  const raw = extractTag(text, 'coordinates');
  if (!raw) return null;
  const first = raw.trim().split(/\s+/)[0];
  const [longitude, latitude] = first.split(',').map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim()); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell.trim()); cell = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function decodeXml(value) {
  return value ? value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : value;
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function nullable(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 1500) : null;
}
