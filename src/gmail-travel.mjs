import { classifyTravelDocument } from './import-taxonomy.mjs';
import { extractGenericTravelFacts } from './pdf-ingest.mjs';
import { detectTravelProvider, extractProviderTravelFacts } from './travel-provider-parsers.mjs';

const TRAVEL_TERMS = [
  'booking', 'reservation', 'reserva', 'itinerary', 'itinerario', 'itinerário', 'boarding pass', 'cartão de embarque',
  'flight', 'voo', 'hotel', 'check-in', 'check in', 'car rental', 'aluguel de carro', 'train', 'trem', 'bus', 'onibus', 'ônibus',
  'ferry', 'transfer', 'ticket', 'ingresso', 'museum', 'museu', 'tour', 'passeio', 'cruise', 'cruzeiro', 'insurance', 'seguro viagem',
  'voucher', 'localizador', 'confirmation', 'cancelamento', 'cancellation', 'alteração', 'updated'
];

export function gmailRealtimeContract() {
  return Object.freeze({
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    mode: 'GMAIL_WATCH_HISTORY',
    steps: [
      'User grants Gmail readonly separately from Google Sign-In',
      'Initial bounded discovery scan finds likely travel messages',
      'Store lastHistoryId after a successful sync',
      'Create Gmail users.watch subscription backed by Google Pub/Sub',
      'For each Pub/Sub notification fetch Gmail history since lastHistoryId',
      'Fetch only changed candidate messages and attachments needed for travel extraction',
      'Normalize email body, PDF, ICS and sniffed travel attachments through the Universal Travel Importer',
      'Detect confirmation, modification and cancellation and update the matched reservation instead of duplicating it',
      'Deduplicate by provider message id, attachment digest and reservation fingerprint',
      'Renew watch before expiration and fail closed when history continuity is lost'
    ],
    retention: 'Prefer structured travel facts and attachment digests. Do not retain unrelated mailbox content or raw personal data beyond what is necessary to process the reservation.'
  });
}

export function classifyGmailCandidate(input = {}) {
  const subject = clean(input.subject);
  const from = clean(input.from);
  const snippet = clean(input.snippet);
  const bodyPreview = clean(input.bodyPreview);
  const attachmentNames = Array.isArray(input.attachmentNames) ? input.attachmentNames.map(clean) : [];
  const rawText = [input.subject, input.from, input.snippet, input.bodyPreview, ...attachmentNames].filter(Boolean).join('\n');
  const haystack = clean(rawText);
  const taxonomy = classifyTravelDocument(haystack, input.categoryHint || null);
  const matchedTerms = TRAVEL_TERMS.filter((term) => haystack.includes(clean(term))).slice(0, 12);
  const hasPdf = attachmentNames.some((name) => name.endsWith('.pdf'));
  const hasIcs = attachmentNames.some((name) => name.endsWith('.ics'));
  const provider = detectTravelProvider(rawText);
  const providerParsing = extractProviderTravelFacts([input.subject, input.snippet, input.bodyPreview].filter(Boolean).join('\n'), {
    provider,
    fileName: attachmentNames.find((name) => name.endsWith('.ics')) || null,
    category: taxonomy.category
  });
  const providerSignal = Boolean(provider);
  const confidence = Math.min(1, Math.max(taxonomy.confidence, providerParsing.confidence || 0) + (matchedTerms.length ? 0.1 : 0) + (hasPdf ? 0.07 : 0) + (hasIcs ? 0.07 : 0) + (providerSignal ? 0.07 : 0));
  const genericFacts = extractGenericTravelFacts([input.subject, input.snippet, input.bodyPreview].filter(Boolean).join(' '), providerParsing.category || taxonomy.category);
  const eventState = detectReservationEventState(haystack, providerParsing.status);
  const facts = Object.freeze({ ...genericFacts, ...(providerParsing.facts || {}), ...(provider ? { provider } : {}), reservationEventState: eventState });

  return Object.freeze({
    candidate: confidence >= 0.5 || matchedTerms.length >= 2 || providerSignal,
    confidence,
    category: providerParsing.category || taxonomy.category,
    provider,
    eventState,
    mutationIntent: eventState === 'CANCELLED' ? 'CANCEL_MATCHED_RESERVATION' : eventState === 'MODIFIED' ? 'UPDATE_MATCHED_RESERVATION' : 'UPSERT_RESERVATION',
    facts,
    providerParsing,
    evidence: [...new Set([...taxonomy.evidence, ...matchedTerms, ...(hasPdf ? ['pdf_attachment'] : []), ...(hasIcs ? ['ics_attachment'] : []), ...(providerSignal ? ['known_travel_provider'] : [])])].slice(0, 14),
    attachmentPdfCount: attachmentNames.filter((name) => name.endsWith('.pdf')).length,
    attachmentIcsCount: attachmentNames.filter((name) => name.endsWith('.ics')).length,
    attachmentStrategy: 'Sniff file signatures/content as well as MIME because travel providers may label PDFs or ICS incorrectly.'
  });
}

export function detectReservationEventState(value = '', providerStatus = null) {
  const text = clean(value);
  if (providerStatus === 'CANCELLED' || /cancel(?:led|lation|amento|ada|ado)|reserva cancelada|booking cancelled/.test(text)) return 'CANCELLED';
  if (providerStatus === 'MODIFIED' || /alterad|modificad|updated|changed|mudan[cç]a na reserva|booking update/.test(text)) return 'MODIFIED';
  if (/standby|listado|listed|zed\s*-\s*r\d/.test(text)) return 'STANDBY_OR_LISTED';
  if (/confirmad|confirmed|emitid|issued|voucher/.test(text)) return 'CONFIRMED';
  return 'UNKNOWN';
}

export function parseGmailPubSubEnvelope(payload = {}) {
  const message = payload?.message;
  if (!message || typeof message.data !== 'string') throw new Error('gmail_pubsub_message_data_required');
  let decoded;
  try { decoded = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8')); } catch { throw new Error('gmail_pubsub_data_invalid'); }
  if (!decoded.emailAddress || !decoded.historyId) throw new Error('gmail_pubsub_payload_incomplete');
  return Object.freeze({
    emailAddress: String(decoded.emailAddress).toLowerCase(),
    historyId: String(decoded.historyId),
    messageId: message.messageId ? String(message.messageId) : null,
    publishTime: message.publishTime ? new Date(message.publishTime).toISOString() : null
  });
}

export function buildGmailDiscoveryQuery() {
  return [
    'newer_than:2y',
    '-in:spam',
    '-in:trash',
    '(has:attachment OR subject:(booking reservation reserva itinerary itinerário voo flight hotel ticket ingresso boarding check-in voucher confirmação cancelamento))'
  ].join(' ');
}

function clean(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
