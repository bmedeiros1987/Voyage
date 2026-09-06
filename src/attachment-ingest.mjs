import { createHash, randomUUID } from 'node:crypto';
import { ingestPdfBuffer } from './pdf-ingest.mjs';
import { classifyTravelDocument } from './import-taxonomy.mjs';
import { extractProviderTravelFacts, looksLikeIcalendar } from './travel-provider-parsers.mjs';
import { normalizeTravelSource } from './travel-source.mjs';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function ingestTravelAttachmentBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('attachment_buffer_required');
  if (!buffer.length) throw new Error('empty_attachment');
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error('attachment_too_large');

  const fileName = sanitizeFileName(options.fileName || 'attachment');
  const declaredMimeType = String(options.mimeType || 'application/octet-stream').toLowerCase();
  const pdf = buffer.subarray(0, 5).equals(Buffer.from('%PDF-'));
  if (pdf) {
    return ingestPdfBuffer(buffer, { ...options, fileName, provider: options.provider || 'gmail_attachment' });
  }

  const text = buffer.toString('utf8');
  if (looksLikeIcalendar(text, fileName)) return ingestCalendarText(text, { ...options, fileName, declaredMimeType });

  return Object.freeze({
    importId: randomUUID(), status: 'NEEDS_REVIEW',
    document: { fileName, declaredMimeType, detectedFormat: 'UNKNOWN', sizeBytes: buffer.length, sha256: digest(buffer) },
    facts: {}, providerParsing: { recognized: false },
    review: { required: true, reasons: ['UNSUPPORTED_ATTACHMENT_FORMAT'] }
  });
}

export function ingestCalendarText(text, options = {}) {
  const raw = String(text || '');
  if (!looksLikeIcalendar(raw, options.fileName)) throw new Error('invalid_calendar_attachment');
  const sha256 = digest(Buffer.from(raw));
  const source = normalizeTravelSource({
    sourceType: options.sourceType || 'gmail',
    sourceId: options.sourceId || `ics-${sha256.slice(0, 20)}`,
    provider: options.provider || 'calendar_attachment',
    receivedAt: options.receivedAt,
    freshnessAt: options.receivedAt,
    confidence: 1,
    contentType: 'text/calendar'
  });
  const providerParsing = extractProviderTravelFacts(raw, { provider: options.provider, fileName: options.fileName, mimeType: options.declaredMimeType || options.mimeType, category: 'AIR_TRAVEL' });
  const classification = classifyTravelDocument(raw, providerParsing.category || null);
  return Object.freeze({
    importId: randomUUID(), status: providerParsing.recognized ? 'PARSED' : 'NEEDS_REVIEW', source,
    document: { fileName: sanitizeFileName(options.fileName || 'itinerary.ics'), declaredMimeType: options.declaredMimeType || options.mimeType || 'text/calendar', detectedFormat: 'ICALENDAR', sizeBytes: Buffer.byteLength(raw), sha256, category: providerParsing.category || classification.category, categoryConfidence: providerParsing.confidence || classification.confidence },
    facts: { ...(providerParsing.facts || {}), provider: providerParsing.provider || null, providerStatus: providerParsing.status || null },
    items: providerParsing.items || [], providerParsing,
    review: { required: !providerParsing.recognized, reasons: providerParsing.recognized ? [] : ['CALENDAR_PROVIDER_NOT_RECOGNIZED'] }
  });
}

function digest(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function sanitizeFileName(value) { return String(value || 'attachment').replace(/[\\/\0\r\n]/g, '_').slice(0, 180) || 'attachment'; }
