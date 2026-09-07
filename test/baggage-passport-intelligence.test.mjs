import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBaggagePassport, baggagePassportCapabilities, parseBaggageTagScan } from '../src/baggage-passport-intelligence.mjs';

test('capabilities keep raw baggage images private by default', () => {
  const caps = baggagePassportCapabilities();
  assert.equal(caps.privacy.rawImageRetentionDefault, false);
  assert.equal(caps.privacy.derivedFactsOnlyDefault, true);
  assert.ok(caps.recognition.includes('ON_DEVICE_OCR'));
  assert.ok(caps.recognition.includes('BAG_TAG_LICENSE_PLATE'));
});

test('synthetic LATAM-style tag scan identifies final destination and grouped license plate', () => {
  const parsed = parseBaggageTagScan({
    text: 'EXAMPLE/PAX\nBSB\nLA1234 18APR\nGRU\nLA5678 18APR\n0 045 151884',
    lines: [
      { text: 'BSB', top: 12 },
      { text: 'LA1234 18APR', top: 25 },
      { text: 'GRU', top: 48 },
      { text: 'LA5678 18APR', top: 60 },
      { text: '0 045 151884', top: 90 }
    ]
  }, {
    originAirport: 'CGH',
    connectionAirport: 'GRU',
    finalDestinationAirport: 'BSB',
    knownAirports: ['CGH', 'GRU', 'BSB'],
    flightNumbers: ['LA1234', 'LA5678']
  });
  assert.equal(parsed.finalDestinationAirport, 'BSB');
  assert.equal(parsed.finalDestinationConfidence, 'HIGH');
  assert.equal(parsed.baggageLicensePlate, '0045151884');
  assert.deepEqual(parsed.flights, ['LA1234', 'LA5678']);
  assert.equal(parsed.passengerNameRetained, false);
});

test('same reservation and same carrier asks for tag confirmation before no-collect guidance', () => {
  const result = analyzeBaggagePassport({
    itinerary: { connectionAirport: 'GRU', finalDestinationAirport: 'BSB' },
    reservation: { sameReservationCode: true, sameCarrier: true },
    scan: {}
  });
  assert.equal(result.inference.state, 'LIKELY_THROUGH_CHECKED_VERIFY_TAG');
  assert.equal(result.nextAction.type, 'ASK_FOR_TAG_PHOTO');
  assert.equal(result.baggageEvidence.verified, false);
});

test('bag tag final destination confirms through-tagging when customs does not force reclaim', () => {
  const result = analyzeBaggagePassport({
    itinerary: { connectionAirport: 'GRU', finalDestinationAirport: 'BSB', knownAirports: ['GRU', 'BSB'] },
    reservation: { sameReservationCode: true, sameCarrier: true },
    scan: {
      text: 'BSB\nLA4321\nGRU\nLA1234\n0045151884',
      lines: [{ text: 'BSB', top: 10 }, { text: 'GRU', top: 40 }]
    },
    customsReclaimRequired: false
  });
  assert.equal(result.inference.state, 'THROUGH_TAG_CONFIRMED');
  assert.equal(result.baggageEvidence.throughChecked, true);
  assert.equal(result.baggageEvidence.mustCollect, false);
  assert.equal(result.nextAction.type, 'GUIDE_WITHOUT_COLLECTION');
});

test('customs reclaim overrides a tag that shows final destination', () => {
  const result = analyzeBaggagePassport({
    itinerary: { connectionAirport: 'MIA', finalDestinationAirport: 'JFK', knownAirports: ['MIA', 'JFK'] },
    scan: { text: 'JFK\nMIA', lines: [{ text: 'JFK', top: 5 }, { text: 'MIA', top: 30 }] },
    customsReclaimRequired: true
  });
  assert.equal(result.inference.state, 'COLLECT_FOR_CUSTOMS_RECHECK');
  assert.equal(result.baggageEvidence.mustCollect, true);
  assert.equal(result.nextAction.type, 'GUIDE_TO_BAGGAGE_CLAIM');
});

test('separate tickets default to collection unless direct through-tag evidence exists', () => {
  const result = analyzeBaggagePassport({
    itinerary: { connectionAirport: 'GRU', finalDestinationAirport: 'BSB' },
    reservation: { separateTickets: true },
    scan: {}
  });
  assert.equal(result.inference.state, 'COLLECT_REQUIRED_UNLESS_TAG_CONFIRMS_THROUGH');
  assert.equal(result.nextAction.askUserToScanTag, true);
});

test('carrier change remains an interline verification instead of assuming collection', () => {
  const result = analyzeBaggagePassport({
    itinerary: { connectionAirport: 'GRU', finalDestinationAirport: 'MAD' },
    reservation: { sameReservationCode: true, carrierChange: true },
    scan: {}
  });
  assert.equal(result.inference.state, 'VERIFY_INTERLINE');
  assert.equal(result.nextAction.type, 'ASK_FOR_TAG_PHOTO_OR_AIRLINE_CONFIRMATION');
});

test('encrypted baggage proof pack is opt-in and never claims legal certainty', () => {
  const result = analyzeBaggagePassport({
    itinerary: { finalDestinationAirport: 'BSB', knownAirports: ['BSB'] },
    scan: { text: 'BSB\n0045151884', lines: [{ text: 'BSB', top: 2 }] },
    proofPack: { retainEvidence: true, bagPhotoProvided: true, claimReceiptProvided: true }
  });
  assert.equal(result.proofPack.enabled, true);
  assert.equal(result.proofPack.defaultStorage, 'ENCRYPTED_USER_SCOPED');
  assert.equal(result.proofPack.legalClaim, 'SUPPORTING_EVIDENCE_NOT_LEGAL_CONCLUSION');
});
