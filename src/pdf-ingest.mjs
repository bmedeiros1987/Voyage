import { createHash, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { classifyTravelDocument } from './import-taxonomy.mjs';
import { normalizeTravelSource } from './travel-source.mjs';
import { extractProviderTravelFacts } from './travel-provider-parsers.mjs';

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_INFLATED_STREAM_BYTES = 4 * 1024 * 1024;
const UNKNOWN_OPERATIONAL_CONTEXT = /(?:to\s+be\s+announced|to\s+be\s+confirmed|tba|tbd|a\s+confirmar|a\s+ser\s+informad[oa]|ser[aá]\s+informad[oa]|informado\s+no\s+aeroporto|ainda\s+n[aã]o\s+informad[oa]|consulte\s+(?:o\s+)?painel|check\s+(?:the\s+)?display)/i;
const OPERATIONAL_VALUE_FORMAT = /^(?:T?\d{1,2}[A-Z]?|[A-Z]\d{0,3}|[A-Z])$/;

export function ingestPdfBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('pdf_buffer_required');
  if (buffer.length === 0) throw new Error('empty_pdf');
  if (buffer.length > MAX_PDF_BYTES) throw new Error('pdf_too_large');
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('invalid_pdf_signature');

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const source = normalizeTravelSource({
    sourceType: options.sourceType || 'upload',
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
  const generic = extractGenericTravelFactsWithConfidence(mergedText, classification.category);
  const providerParsing = extractProviderTravelFacts(mergedText, {
    provider: options.provider,
    fileName: options.fileName,
    mimeType: options.mimeType || 'application/pdf',
    category: classification.category
  });
  const facts = Object.freeze({
    ...generic.facts,
    ...(providerParsing.facts || {}),
    ...(providerParsing.provider ? { provider: providerParsing.provider } : {}),
    ...(providerParsing.status ? { providerStatus: providerParsing.status } : {}),
    ...(providerParsing.items?.length ? { itemCount: providerParsing.items.length } : {})
  });
  const providerConfidence = providerParsing.recognized ? providerParsing.confidence || 0 : 0;
  const effectiveConfidence = Math.max(classification.confidence, providerConfidence);
  const resolvedCategory = classification.category === 'BOARDING_PASS'
    ? 'BOARDING_PASS'
    : providerParsing.category || classification.category;
  const scanTruncated = extracted.warnings?.includes('PDF_SCAN_TRUNCATED_FOR_SAFETY') === true;
  const factWarnings = Object.entries(generic.factConfidence)
    .filter(([, value]) => value < 0.55)
    .map(([key]) => `LOW_CONFIDENCE_FACT_${key.toUpperCase()}`);
  const needsReview = encrypted
    || mergedText.trim().length < 20
    || effectiveConfidence < 0.55
    || classification.hintContradictsContent === true
    || scanTruncated
    || factWarnings.length > 0;

  return Object.freeze({
    importId: randomUUID(),
    status: needsReview ? 'NEEDS_REVIEW' : 'PARSED',
    source,
    document: {
      fileName: sanitizeFileName(options.fileName || 'document.pdf'),
      mimeType: 'application/pdf',
      declaredMimeType: options.mimeType || 'application/pdf',
      sizeBytes: buffer.length,
      sha256,
      category: resolvedCategory,
      categoryConfidence: effectiveConfidence,
      classificationEvidence: classification.evidence,
      encrypted,
      textExtractionMethod: extracted.method,
      warnings: [...new Set([...(extracted.warnings || []), ...(providerParsing.warnings || []), ...factWarnings])],
      providerParser: providerParsing.recognized ? providerParsing.provider : null
    },
    facts,
    factConfidence: generic.factConfidence,
    items: providerParsing.items || [],
    providerParsing,
    textPreview: mergedText.replace(/\s+/g, ' ').trim().slice(0, 1000),
    review: {
      required: needsReview,
      reasons: [
        ...(encrypted ? ['PDF_ENCRYPTED'] : []),
        ...(mergedText.trim().length < 20 ? ['TEXT_EXTRACTION_INSUFFICIENT'] : []),
        ...(effectiveConfidence < 0.55 ? ['CLASSIFICATION_LOW_CONFIDENCE'] : []),
        ...(classification.hintContradictsContent ? ['HINT_CONTRADICTS_CONTENT'] : []),
        ...(scanTruncated ? ['PDF_SCAN_TRUNCATED_FOR_SAFETY'] : []),
        ...factWarnings
      ]
    }
  });
}

export function extractPdfTextBestEffort(buffer) {
  const binary = buffer.subarray(0, MAX_SCAN_BYTES).toString('latin1');
  const warnings = buffer.length > MAX_SCAN_BYTES ? ['PDF_SCAN_TRUNCATED_FOR_SAFETY'] : [];
  const chunks = [];
  const streamRegex = /(<<[\s\S]{0,2500}?>>)[\r\n\s]*stream\r?\n([\s\S]{0,4194304}?)\r?\nendstream/g;
  let match;
  let streams = 0;

  while ((match = streamRegex.exec(binary)) && streams < 200) {
    streams += 1;
    const dict = match[1];
    let data = Buffer.from(match[2], 'latin1');
    if (/\/FlateDecode\b/.test(dict)) {
      try { data = inflateSync(data, { maxOutputLength: MAX_INFLATED_STREAM_BYTES }); }
      catch { warnings.push('FLATE_STREAM_UNREADABLE_OR_TOO_LARGE'); continue; }
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
  return extractGenericTravelFactsWithConfidence(text, category).facts;
}

export function extractGenericTravelFactsWithConfidence(text = '', category = 'OTHER') {
  const compact = String(text).replace(/\s+/g, ' ').trim();
  const facts = { category };
  const factConfidence = { category: 1 };

  const confirmation = firstMatch(compact, [
    /(?:confirmation|booking|reservation|reserva|localizador|record locator|pnr|voucher)(?:\s+(?:code|number|no\.?|nº|#))?\s*[:\-]?\s*([A-Z0-9]{5,14})/i,
    /\bPNR\s*[:\-]?\s*([A-Z0-9]{5,8})\b/i
  ]);
  if (confirmation) { facts.confirmationCode = confirmation.toUpperCase(); factConfidence.confirmationCode = 0.9; }

  if (['AIR_TRAVEL', 'BOARDING_PASS'].includes(category)) {
    const flight = compact.match(/(?:^|\s)(?:voo|vôo|flight)\s*[:#-]?\s*([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*[- ]?(\d{2,4})\b/i);
    if (flight) {
      facts.marketingCarrier = flight[1].toUpperCase();
      facts.flightNumber = flight[2];
      factConfidence.marketingCarrier = 0.94;
      factConfidence.flightNumber = 0.94;
    }
  }

  const route = compact.match(/\b([A-Z]{3})\b\s*(?:→|->|>|-|to|para|a)\s*\b([A-Z]{3})\b/);
  if (route) { facts.route = { origin: route[1], destination: route[2] }; factConfidence.route = 0.86; }

  const price = extractLabeledPrice(compact);
  if (price) {
    facts.priceText = price;
    facts.currency = detectCurrency(price);
    factConfidence.priceText = 0.9;
    if (facts.currency) factConfidence.currency = 0.95;
  }

  const seat = firstMatch(compact, [/(?:seat|assento|poltrona)\s*[:\-]?\s*([0-9]{1,3}[A-Z]?)/i]);
  if (seat) { facts.seat = seat.toUpperCase(); factConfidence.seat = 0.9; }

  const gate = extractOperationalValue(compact, /(?:gate|port[aã]o)\s*[:\-]?\s*([A-Z0-9]{1,8})/i);
  if (gate) { facts.gate = gate; factConfidence.gate = 0.94; }
  const terminal = extractOperationalValue(compact, /(?:terminal)\s*[:\-]?\s*([A-Z0-9]{1,8})/i);
  if (terminal) { facts.terminal = terminal; factConfidence.terminal = 0.92; }

  const providerStatus = extractProviderStatus(compact);
  if (providerStatus) { facts.providerStatus = providerStatus; factConfidence.providerStatus = 0.96; }

  const dates = [...compact.matchAll(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{2}|\d{4}))\b/g)].slice(0, 6).map((m) => m[1]);
  if (dates.length) { facts.dateMentions = dates; factConfidence.dateMentions = 0.72; }
  const times = [...compact.matchAll(/\b([01]?\d|2[0-3]):[0-5]\d\b/g)].slice(0, 8).map((m) => m[0]);
  if (times.length) { facts.timeMentions = times; factConfidence.timeMentions = 0.72; }

  return Object.freeze({ facts: Object.freeze(facts), factConfidence: Object.freeze(factConfidence) });
}

function extractLabeledPrice(text) {
  const match = text.match(/(?:total|valor\s+pago|amount\s+charged|amount\s+paid|preço\s+total|preco\s+total)\s*[:\-]?\s*((?:R\$|US\$|USD|EUR|€|GBP|£)\s*[\d.,]+)/i);
  if (!match?.[1]) return null;
  const context = text.slice(Math.max(0, match.index - 24), match.index + match[0].length + 12);
  if (/(?:a\s+partir\s+de|from|desde)\s*$/i.test(context.slice(0, Math.max(0, context.indexOf(match[1]))))) return null;
  return match[1];
}

function extractOperationalValue(text, pattern) {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const value = match[1].toUpperCase();
  const start = Math.max(0, (match.index || 0) - 24);
  const end = Math.min(text.length, (match.index || 0) + match[0].length + 96);
  const context = text.slice(start, end);
  if (UNKNOWN_OPERATIONAL_CONTEXT.test(context)) return null;
  if (!OPERATIONAL_VALUE_FORMAT.test(value)) return null;
  return value;
}

function extractProviderStatus(text) {
  if (/\b(?:cancelado|cancelada|cancelled|canceled)\b/i.test(text)) return 'CANCELLED';
  if (/\b(?:alterado|alterada|changed|modified|rescheduled)\b/i.test(text)) return 'MODIFIED';
  return null;
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
