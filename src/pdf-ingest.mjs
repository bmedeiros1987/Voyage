import { createHash, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { classifyTravelDocument } from './import-taxonomy.mjs';
import { normalizeTravelSource } from './travel-source.mjs';

const MAX_PDF_BYTES = 15 * 1024 * 1024;

export function ingestPdfBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('pdf_buffer_required');
  if (buffer.length === 0) throw new Error('empty_pdf');
  if (buffer.length > MAX_PDF_BYTES) throw new Error('pdf_too_large');
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('invalid_pdf_signature');

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const source = normalizeTravelSource({
    sourceType: 'upload',
    sourceId: options.sourceId || `pdf-${sha256.slice(0, 20)}`,
    provider: options.provider || 'manual_pdf',
    receivedAt: options.receivedAt,
    freshnessAt: options.receivedAt,
    confidence: 1,
    contentType: 'application/pdf'
  });

  const encrypted = buffer.includes(Buffer.from('/Encrypt'));
  const extracted = encrypted ? { text: '', pagesApprox: null, method: 'encrypted', warnings: ['PDF_ENCRYPTED'] } : extractPdfTextBestEffort(buffer);
  const mergedText = [options.textHint, extracted.text].filter(Boolean).join('\n');
  const classification = classifyTravelDocument(mergedText, options.categoryHint || null);
  const facts = extractGenericTravelFacts(mergedText, classification.category);
  const needsReview = encrypted || mergedText.trim().length < 20 || classification.confidence < 0.55;

  return Object.freeze({
    importId: randomUUID(),
    status: needsReview ? 'NEEDS_REVIEW' : 'PARSED',
    source,
    document: {
      fileName: sanitizeFileName(options.fileName || 'document.pdf'),
      mimeType: 'application/pdf',
      sizeBytes: buffer.length,
      sha256,
      category: classification.category,
      categoryConfidence: classification.confidence,
      classificationEvidence: classification.evidence,
      encrypted,
      textExtractionMethod: extracted.method,
      warnings: extracted.warnings
    },
    facts,
    textPreview: mergedText.replace(/\s+/g, ' ').trim().slice(0, 1000),
    review: {
      required: needsReview,
      reasons: [
        ...(encrypted ? ['PDF_ENCRYPTED'] : []),
        ...(mergedText.trim().length < 20 ? ['TEXT_EXTRACTION_INSUFFICIENT'] : []),
        ...(classification.confidence < 0.55 ? ['CLASSIFICATION_LOW_CONFIDENCE'] : [])
      ]
    }
  });
}

export function extractPdfTextBestEffort(buffer) {
  const binary = buffer.toString('latin1');
  const warnings = [];
  const chunks = [];
  const streamRegex = /(<<[\s\S]{0,2500}?>>)[\r\n\s]*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  let streams = 0;

  while ((match = streamRegex.exec(binary)) && streams < 200) {
    streams += 1;
    const dict = match[1];
    let data = Buffer.from(match[2], 'latin1');
    if (/\/FlateDecode\b/.test(dict)) {
      try { data = inflateSync(data); } catch { warnings.push('FLATE_STREAM_UNREADABLE'); continue; }
    } else if (/\/Filter\b/.test(dict)) {
      warnings.push('UNSUPPORTED_PDF_FILTER');
      continue;
    }
    const streamText = extractPdfTextOperators(data.toString('latin1'));
    if (streamText) chunks.push(streamText);
  }

  const direct = extractPdfTextOperators(binary);
  if (direct) chunks.unshift(direct);
  const text = dedupeLines(chunks.join('\n'));
  if (!text) warnings.push('NO_MACHINE_READABLE_TEXT');
  return { text, pagesApprox: countPages(binary), method: 'pdf_content_stream_best_effort', warnings: [...new Set(warnings)] };
}

export function extractGenericTravelFacts(text = '', category = 'OTHER') {
  const compact = String(text).replace(/\s+/g, ' ').trim();
  const facts = { category };

  const confirmation = firstMatch(compact, [
    /(?:confirmation|booking|reservation|reserva|localizador|record locator|pnr|voucher)(?:\s+(?:code|number|no\.?|nº|#))?\s*[:\-]?\s*([A-Z0-9]{5,14})/i,
    /\bPNR\s*[:\-]?\s*([A-Z0-9]{5,8})\b/i
  ]);
  if (confirmation) facts.confirmationCode = confirmation.toUpperCase();

  const flight = compact.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*[- ]?(\d{2,4})\b/);
  if (flight && ['AIR_TRAVEL', 'BOARDING_PASS'].includes(category)) {
    facts.marketingCarrier = flight[1].toUpperCase();
    facts.flightNumber = flight[2];
  }

  const route = compact.match(/\b([A-Z]{3})\b\s*(?:→|->|>|-|to|para|a)\s*\b([A-Z]{3})\b/);
  if (route) facts.route = { origin: route[1], destination: route[2] };

  const currency = compact.match(/(?:R\$|US\$|USD|EUR|€|GBP|£)\s*([\d.,]+)/i);
  if (currency) {
    facts.priceText = currency[0];
    facts.currency = detectCurrency(currency[0]);
  }

  const seat = firstMatch(compact, [/(?:seat|assento)\s*[:\-]?\s*([0-9]{1,3}[A-Z])/i]);
  if (seat) facts.seat = seat.toUpperCase();
  const gate = firstMatch(compact, [/(?:gate|port[aã]o)\s*[:\-]?\s*([A-Z0-9]{1,6})/i]);
  if (gate) facts.gate = gate.toUpperCase();
  const terminal = firstMatch(compact, [/(?:terminal)\s*[:\-]?\s*([A-Z0-9]{1,8})/i]);
  if (terminal) facts.terminal = terminal.toUpperCase();

  const dates = [...compact.matchAll(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{2}|\d{4}))\b/g)].slice(0, 6).map((m) => m[1]);
  if (dates.length) facts.dateMentions = dates;
  const times = [...compact.matchAll(/\b([01]?\d|2[0-3]):[0-5]\d\b/g)].slice(0, 8).map((m) => m[0]);
  if (times.length) facts.timeMentions = times;

  return Object.freeze(facts);
}

function extractPdfTextOperators(content) {
  const out = [];
  const literal = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  const array = /\[((?:.|\n|\r)*?)\]\s*TJ/g;
  const hex = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
  let match;
  while ((match = literal.exec(content))) out.push(decodePdfLiteral(match[0].replace(/\s*Tj$/, '')));
  while ((match = array.exec(content))) {
    const strings = [...match[1].matchAll(/\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>/g)];
    out.push(strings.map((entry) => entry[0][0] === '(' ? decodePdfLiteral(entry[0]) : decodeHex(entry[0])).join(''));
  }
  while ((match = hex.exec(content))) out.push(decodeHex(`<${match[1]}>`));
  return out.filter(Boolean).join('\n');
}

function decodePdfLiteral(value) {
  const body = value.replace(/^\(/, '').replace(/\)$/, '');
  return body.replace(/\\([nrtbf()\\])/g, (_, char) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[char] || char))
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function decodeHex(value) {
  const hex = value.replace(/[<>\s]/g, '');
  if (!hex || /[^0-9a-f]/i.test(hex)) return '';
  try { return Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex').toString('latin1'); } catch { return ''; }
}

function dedupeLines(text) {
  const seen = new Set();
  return text.split(/[\r\n]+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => {
    if (!line || line.length > 500 || seen.has(line)) return false;
    seen.add(line); return true;
  }).join('\n').trim();
}

function countPages(binary) {
  const matches = binary.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : null;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) { const match = text.match(pattern); if (match?.[1]) return match[1]; }
  return null;
}

function detectCurrency(value) {
  if (/EUR|€/.test(value)) return 'EUR';
  if (/GBP|£/.test(value)) return 'GBP';
  if (/USD|US\$/.test(value)) return 'USD';
  if (/R\$/.test(value)) return 'BRL';
  return null;
}

function sanitizeFileName(value) {
  return String(value || 'document.pdf').replace(/[\\/\0\r\n]/g, '_').slice(0, 180) || 'document.pdf';
}
