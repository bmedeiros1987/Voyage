import { classifyTravelDocument } from './import-taxonomy.mjs';
import { extractGenericTravelFacts } from './pdf-ingest.mjs';

const TRAVEL_TERMS = [
  'booking', 'reservation', 'reserva', 'itinerary', 'itinerario', 'itinerário', 'boarding pass', 'cartão de embarque',
  'flight', 'voo', 'hotel', 'check-in', 'check in', 'car rental', 'aluguel de carro', 'train', 'trem', 'bus', 'onibus', 'ônibus',
  'ferry', 'transfer', 'ticket', 'ingresso', 'museum', 'museu', 'tour', 'passeio', 'cruise', 'cruzeiro', 'insurance', 'seguro viagem'
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
      'Normalize into the same Universal Travel Importer pipeline used by manual PDFs',
      'Deduplicate by provider message id, attachment digest and reservation fingerprint',
      'Renew watch before expiration and fail closed when history continuity is lost'
    ],
    retention: 'Prefer structured travel facts and attachment digests. Do not retain unrelated mailbox content.'
  });
}

export function classifyGmailCandidate(input = {}) {
  const subject = clean(input.subject);
  const from = clean(input.from);
  const snippet = clean(input.snippet);
  const bodyPreview = clean(input.bodyPreview);
  const attachmentNames = Array.isArray(input.attachmentNames) ? input.attachmentNames.map(clean) : [];
  const haystack = [subject, from, snippet, bodyPreview, ...attachmentNames].join(' ');
  const taxonomy = classifyTravelDocument(haystack, input.categoryHint || null);
  const matchedTerms = TRAVEL_TERMS.filter((term) => haystack.includes(clean(term))).slice(0, 10);
  const hasPdf = attachmentNames.some((name) => name.endsWith('.pdf'));
  const provider = detectProvider(haystack);
  const providerSignal = Boolean(provider);
  const confidence = Math.min(1, taxonomy.confidence + (matchedTerms.length ? 0.12 : 0) + (hasPdf ? 0.08 : 0) + (providerSignal ? 0.08 : 0));
  const facts = extractGenericTravelFacts([input.subject, input.snippet, input.bodyPreview].filter(Boolean).join(' '), taxonomy.category);

  return Object.freeze({
    candidate: confidence >= 0.5 || matchedTerms.length >= 2,
    confidence,
    category: taxonomy.category,
    provider,
    facts,
    evidence: [...new Set([...taxonomy.evidence, ...matchedTerms, ...(hasPdf ? ['pdf_attachment'] : []), ...(providerSignal ? ['known_travel_provider'] : [])])].slice(0, 12),
    attachmentPdfCount: attachmentNames.filter((name) => name.endsWith('.pdf')).length
  });
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
    '(has:attachment OR subject:(booking reservation reserva itinerary itinerário voo flight hotel ticket ingresso boarding check-in))'
  ].join(' ');
}

function detectProvider(value) {
  const providers = [
    ['Booking.com', /booking(?:\.com)?/i], ['Expedia', /expedia/i], ['Airbnb', /airbnb/i], ['LATAM', /latam/i],
    ['GOL', /\bgol\b/i], ['Azul', /\bazul\b/i], ['United', /united/i], ['Delta', /delta/i], ['American Airlines', /american airlines|aa\.com/i],
    ['Air France', /air france/i], ['KLM', /\bklm\b/i], ['Lufthansa', /lufthansa/i], ['Iberia', /iberia/i], ['TAP', /tap air|flytap|\btap\b/i],
    ['Ryanair', /ryanair/i], ['easyJet', /easyjet/i], ['FlixBus', /flixbus/i], ['Trenitalia', /trenitalia/i], ['Italo', /italotreno|\bitalo\b/i],
    ['Renfe', /renfe/i], ['Eurostar', /eurostar/i], ['Localiza', /localiza/i], ['Movida', /movida/i], ['Hertz', /hertz/i], ['Avis', /\bavis\b/i],
    ['Sixt', /\bsixt\b/i], ['Rentcars', /rentcars/i], ['Ticketmaster', /ticketmaster/i], ['GetYourGuide', /getyourguide/i], ['Viator', /viator/i], ['Civitatis', /civitatis/i]
  ];
  return providers.find(([, pattern]) => pattern.test(value))?.[0] || null;
}

function clean(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
