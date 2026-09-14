import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestPdfBuffer, extractGenericTravelFacts } from '../src/pdf-ingest.mjs';

test('operational gate and terminal extraction rejects prose and accepts designators', () => {
  assert.equal(extractGenericTravelFacts('Terminal Rodoviario Tiete plataforma 12', 'AIR_TRAVEL').terminal, undefined);
  assert.equal(extractGenericTravelFacts('Terminal INTERNACIONAL', 'AIR_TRAVEL').terminal, undefined);
  assert.equal(extractGenericTravelFacts('Gate CONSULTE painel', 'AIR_TRAVEL').gate, undefined);
  assert.equal(extractGenericTravelFacts('Portao: consulte o painel', 'AIR_TRAVEL').gate, undefined);
  assert.equal(extractGenericTravelFacts('Gate A12', 'AIR_TRAVEL').gate, 'A12');
  assert.equal(extractGenericTravelFacts('Terminal 3', 'AIR_TRAVEL').terminal, '3');
  assert.equal(extractGenericTravelFacts('Portão 24', 'AIR_TRAVEL').gate, '24');
});

test('large PDF scan truncation fails closed for review', () => {
  const size = 9 * 1024 * 1024;
  const pdf = Buffer.alloc(size, 0x20);
  Buffer.from('%PDF-1.4\n').copy(pdf, 0);
  const result = ingestPdfBuffer(pdf, {
    fileName: 'synthetic-large.pdf',
    textHint: 'Voo LA 3000 GRU para BSB total R$ 500,00',
    categoryHint: 'AIR_TRAVEL'
  });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.ok(result.document.warnings.includes('PDF_SCAN_TRUNCATED_FOR_SAFETY'));
  assert.ok(result.review.reasons.includes('PDF_SCAN_TRUNCATED_FOR_SAFETY'));
});

test('unknown operational context never becomes a provider fact', () => {
  assert.equal(extractGenericTravelFacts('Gate to be announced', 'AIR_TRAVEL').gate, undefined);
  assert.equal(extractGenericTravelFacts('Portão será informado no aeroporto', 'AIR_TRAVEL').gate, undefined);
  assert.equal(extractGenericTravelFacts('Terminal a confirmar', 'AIR_TRAVEL').terminal, undefined);
});
