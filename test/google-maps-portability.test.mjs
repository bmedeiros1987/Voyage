import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMapsPortabilityScopes,
  googleMapsImportCapabilities,
  normalizeGoogleMapsSharedUrl,
  normalizeMyMapsKml,
  normalizePinnedTripsExport,
  normalizeSavedCollectionsCsv
} from '../src/google-maps-portability.mjs';

test('Maps portability advertises My Maps and Saved collections scopes', () => {
  const capabilities = googleMapsImportCapabilities();
  const scopes = buildMapsPortabilityScopes();
  assert.equal(capabilities.preferredIntegration, 'GOOGLE_DATA_PORTABILITY_API');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/dataportability.mymaps.maps'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/dataportability.saved.collections'));
});

test('shared Google Maps link is accepted for provider resolution without scraping', () => {
  const result = normalizeGoogleMapsSharedUrl('https://maps.app.goo.gl/abc123');
  assert.equal(result.status, 'NEEDS_PROVIDER_RESOLUTION');
  assert.match(result.resolverPolicy, /never scrape/i);
});

test('My Maps KML placemarks normalize into itinerary items', () => {
  const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>Museu</name><description>Visita</description><Point><coordinates>-46.6333,-23.5505,0</coordinates></Point></Placemark></Document></kml>`;
  const result = normalizeMyMapsKml(kml);
  assert.equal(result.status, 'READY_FOR_MATCHING');
  assert.equal(result.items[0].title, 'Museu');
  assert.equal(result.items[0].latitude, -23.5505);
  assert.equal(result.items[0].longitude, -46.6333);
});

test('Saved collections CSV normalizes titles, URLs and collection names', () => {
  const csv = 'collection,title,url,note\nRoma,Coliseu,https://maps.google.com/?cid=1,manhã\nRoma,Panteão,https://maps.google.com/?cid=2,tarde';
  const result = normalizeSavedCollectionsCsv(csv);
  assert.equal(result.status, 'READY_FOR_MATCHING');
  assert.equal(result.itemCount, 2);
  assert.equal(result.items[0].collection, 'Roma');
  assert.equal(result.items[0].title, 'Coliseu');
});

test('Pinned trips export preserves ordered place visits', () => {
  const result = normalizePinnedTripsExport({
    trips: [{ id: 'trip-1', mode: 'TRANSIT', place_visit: [{ id: 'a', name: 'Hotel' }, { id: 'b', name: 'Museu' }] }]
  });
  assert.equal(result.status, 'READY_FOR_MATCHING');
  assert.equal(result.trips[0].places.length, 2);
  assert.equal(result.trips[0].transportMode, 'TRANSIT');
});
