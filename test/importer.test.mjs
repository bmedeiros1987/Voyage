import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTravelDocument, supportedImportCapabilities } from '../src/import-taxonomy.mjs';
import { ingestPdfBuffer } from '../src/pdf-ingest.mjs';
import { classifyGmailCandidate, parseGmailPubSubEnvelope } from '../src/gmail-travel.mjs';

test('taxonomy recognizes broad travel document categories', () => {
  assert.equal(classifyTravelDocument('Hotel reservation check-in 12/05/2027 check-out 15/05/2027').category, 'LODGING');
  assert.equal(classifyTravelDocument('Ingresso para museu e visita guiada').category, 'ATTRACTION_TICKET');
  assert.equal(classifyTravelDocument('Car rental pickup location airport drop-off location').category, 'CAR_RENTAL');
  assert.ok(supportedImportCapabilities().categories.includes('OTHER'));
});

test('manual PDF import extracts machine-readable travel facts without rejecting unknown provider', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 120 >>\nstream\nBT (BOARDING PASS LATAM flight LA 3149 GRU -> GIG seat 12A gate 101 PNR ABC123) Tj ET\nendstream\nendobj\n%%EOF', 'latin1');
  const result = ingestPdfBuffer(pdf, { fileName: 'meu-cartao.pdf' });
  assert.equal(result.document.mimeType, 'application/pdf');
  assert.equal(result.document.category, 'BOARDING_PASS');
  assert.equal(result.facts.marketingCarrier, 'LA');
  assert.equal(result.facts.flightNumber, '3149');
  assert.deepEqual(result.facts.route, { origin: 'GRU', destination: 'GIG' });
  assert.equal(result.facts.seat, '12A');
  assert.equal(result.facts.gate, '101');
  assert.equal(result.facts.confirmationCode, 'ABC123');
  assert.equal(result.document.sha256.length, 64);
});

test('encrypted PDF is accepted but fails closed into review', () => {
  const pdf = Buffer.from('%PDF-1.7\n/Encrypt 9 0 R\n%%EOF', 'latin1');
  const result = ingestPdfBuffer(pdf, { fileName: 'protegido.pdf', categoryHint: 'AIR_TRAVEL' });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.document.encrypted, true);
  assert.ok(result.review.reasons.includes('PDF_ENCRYPTED'));
});

test('Gmail candidate classifier detects provider, travel facts and PDF attachments', () => {
  const candidate = classifyGmailCandidate({
    from: 'Booking.com <noreply@booking.com>',
    subject: 'Sua reserva de hotel está confirmada',
    snippet: 'Check-in 12 maio. Confirmation ABC123',
    attachmentNames: ['booking-confirmation.pdf']
  });
  assert.equal(candidate.candidate, true);
  assert.equal(candidate.category, 'LODGING');
  assert.equal(candidate.provider, 'BOOKING_COM');
  assert.equal(candidate.facts.confirmationCode, 'ABC123');
  assert.equal(candidate.eventState, 'CONFIRMED');
  assert.equal(candidate.attachmentPdfCount, 1);
});

test('Gmail classifier treats cancellation as a mutation of an existing reservation', () => {
  const candidate = classifyGmailCandidate({
    from: 'Booking.com <noreply@booking.com>',
    subject: 'Sua reserva foi cancelada',
    snippet: 'Número de confirmação: 123456789. Cancelamento concluído.'
  });
  assert.equal(candidate.eventState, 'CANCELLED');
  assert.equal(candidate.mutationIntent, 'CANCEL_MATCHED_RESERVATION');
});

test('Gmail classifier detects ICS even when providers may send unusual MIME types', () => {
  const candidate = classifyGmailCandidate({
    from: 'myIDTravel <noreply@example.test>',
    subject: 'Travel confirmation',
    bodyPreview: 'ZED - R2 Standby',
    attachmentNames: ['MyIDTravelFlight1.ics']
  });
  assert.equal(candidate.candidate, true);
  assert.equal(candidate.provider, 'MYIDTRAVEL');
  assert.equal(candidate.attachmentIcsCount, 1);
});

test('Gmail Pub/Sub envelope requires email and history cursor', () => {
  const data = Buffer.from(JSON.stringify({ emailAddress: 'User@Example.com', historyId: '123456' })).toString('base64');
  const parsed = parseGmailPubSubEnvelope({ message: { data, messageId: 'm1', publishTime: '2026-09-06T09:00:00Z' } });
  assert.equal(parsed.emailAddress, 'user@example.com');
  assert.equal(parsed.historyId, '123456');
  assert.equal(parsed.messageId, 'm1');
});
