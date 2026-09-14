const PROVIDERS = [
  ['LATAM', /\blatam\b|latam airlines/i],
  ['CLICKBUS', /clickbus|bilhete de passagem eletr[oô]nico|\bbp-e\b/i],
  ['CIVITATIS', /civitatis|reserva de atividade|booking details/i],
  ['LOCALIZA', /localiza(?: rent a car| hertz)?|contrato de aluguel de carros/i],
  ['TICKETWORK', /ticketwork|c[oó]digo do ingresso|voucher individual/i],
  ['MYIDTRAVEL', /myidtravel|zed\s*-\s*r2|filekey:/i],
  ['BOOKING_COM', /booking\.com|n[uú]mero de confirma[cç][aã]o|confirmation number/i],
  ['GETYOURGUIDE', /getyourguide|booking\s+gyg/i]
];

export function extractProviderTravelFacts(text = '', context = {}) {
  const raw = String(text || '');
  const provider = normalizeProvider(context.provider) || detectTravelProvider([context.fileName, context.mimeType, raw].filter(Boolean).join('\n'));
  const category = context.category || null;
  let parsed = null;

  if (provider === 'LATAM') parsed = parseLatam(raw);
  else if (provider === 'CLICKBUS') parsed = parseClickBus(raw);
  else if (provider === 'CIVITATIS') parsed = parseCivitatis(raw);
  else if (provider === 'LOCALIZA') parsed = parseLocaliza(raw);
  else if (provider === 'TICKETWORK') parsed = parseTicketwork(raw);
  else if (provider === 'MYIDTRAVEL' || looksLikeIcalendar(raw, context.fileName)) parsed = parseMyIdTravelIcs(raw);
  else if (provider === 'BOOKING_COM') parsed = parseBookingCom(raw);
  else if (provider === 'GETYOURGUIDE') parsed = parseGetYourGuide(raw);

  if (!parsed) return Object.freeze({ provider, recognized: false, category, facts: {}, items: [], privacy: privacyContract() });
  return Object.freeze({
    provider: parsed.provider || provider,
    recognized: true,
    category: parsed.category || category,
    status: parsed.status || null,
    confidence: parsed.confidence ?? 0.86,
    facts: parsed.facts || {},
    items: parsed.items || [],
    warnings: parsed.warnings || [],
    privacy: privacyContract()
  });
}

export function detectTravelProvider(value = '') {
  const text = String(value || '');
  return PROVIDERS.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

export function looksLikeIcalendar(text = '', fileName = '') {
  return /\.ics$/i.test(String(fileName || '')) || /BEGIN:VCALENDAR[\s\S]*BEGIN:VEVENT/i.test(String(text || ''));
}

function parseLatam(text) {
  const compact = oneLine(text);
  const confirmationCode = capture(compact, /(?:c[oó]digo da reserva|reservation code|record locator)\s*[:\-]?\s*([A-Z0-9]{5,8})/i);
  const segments = [];
  const lines = meaningfulLines(text);
  for (let i = 0; i < lines.length; i += 1) {
    const flight = lines[i].match(/^(?:LATAM\s+)?(?:AIRLINES\s+GROUP\s+)?LA\s*([0-9]{2,4})$/i);
    if (!flight) continue;
    const nearby = lines.slice(i, Math.min(lines.length, i + 30));
    const iatas = nearby.filter((line) => /^[A-Z]{3}$/.test(line)).slice(0, 2);
    const departure = capture(nearby.join(' '), /partindo (?:[aà]s)?[^0-9]*(\d{1,2}:\d{2})/i);
    const arrival = capture(nearby.join(' '), /chegando (?:[aà]s)?[^0-9]*(\d{1,2}:\d{2})/i);
    segments.push(compactObject({ carrier: 'LA', flightNumber: flight[1], origin: iatas[0], destination: iatas[1], departureTimeLocal: departure, arrivalTimeLocal: arrival }));
  }
  if (!segments.length) {
    const flight = compact.match(/\bLA\s*([0-9]{2,4})\b/i);
    const iatas = [...text.matchAll(/^([A-Z]{3})\s*$/gm)].map((m) => m[1]).slice(0, 2);
    if (flight) segments.push(compactObject({ carrier: 'LA', flightNumber: flight[1], origin: iatas[0], destination: iatas[1] }));
  }
  return {
    provider: 'LATAM', category: 'AIR_TRAVEL', confidence: segments.length ? 0.97 : 0.9,
    status: /cancelad|cancelled/i.test(text) ? 'CANCELLED' : /alterad|modified|updated/i.test(text) ? 'MODIFIED' : 'CONFIRMED',
    facts: compactObject({ confirmationCode, segmentCount: segments.length, operatingCarrier: capture(compact, /operado por\s*[:\-]?\s*([^:]{3,60}?)(?=\s+dura[cç][aã]o|\s+duration|$)/i), cabin: capture(compact, /cabine\s*[:\-]?\s*([a-záéíóúç ]{3,30})/i), aircraft: capture(compact, /aeronave\s*[:\-]?\s*([a-z0-9 .-]{3,60})/i) }),
    items: segments
  };
}

function parseClickBus(text) {
  const compact = oneLine(text);
  const origin = capture(compact, /origem\s*:\s*([^\n]+?)(?=\s+destino\s*:)/i) || capture(text, /Origem:\s*([^\r\n]+)/i);
  const destination = capture(compact, /destino\s*:\s*([^\n]+?)(?=\s+embarque\s*:)/i) || capture(text, /Destino:\s*([^\r\n]+)/i);
  const localizer = capture(compact, /localizador\s*:\s*([A-Z0-9]{5,12})/i);
  const boarding = capture(compact, /embarque\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*,?\s*(?:[aà]s)?\s*(\d{1,2}:\d{2})/i, true);
  const departure = capture(compact, /partida\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*,?\s*(?:[aà]s)?\s*(\d{1,2}:\d{2})/i, true);
  return {
    provider: 'CLICKBUS', category: 'BUS', status: /cancelad/i.test(text) ? 'CANCELLED' : 'CONFIRMED', confidence: 0.98,
    facts: compactObject({ confirmationCode: localizer, operator: capture(compact, /via[cç][aã]o\s*:\s*([^:]{2,60}?)(?=\s+classe\s*:)/i), origin, destination, boardingAtText: boarding, departureAtText: departure, seat: capture(compact, /poltrona\s*:\s*([A-Z0-9-]{1,8})/i), platform: capture(compact, /plataforma\s*:\s*([A-Z0-9-]{1,12})/i), serviceClass: capture(compact, /classe\s*:\s*([^:]{2,30}?)(?=\s+origem\s*:)/i), totalPriceText: capture(compact, /(?:valor total|valor a pagar)\s*R?\$?\s*([0-9.,]+)/i), currency: 'BRL' }),
    items: []
  };
}

function parseCivitatis(text) {
  const compact = oneLine(text);
  const title = capture(compact, /reserva de atividade\s*\/\s*booking details\s+(.+?)(?=\s+dados do cliente|\s+guest details|$)/i) || capture(compact, /(visita guiada[^\n]{0,120})/i);
  return {
    provider: 'CIVITATIS', category: 'TOUR', status: /cancelad/i.test(text) ? 'CANCELLED' : 'CONFIRMED', confidence: 0.98,
    facts: compactObject({ confirmationCode: capture(compact, /reserva\s*\/\s*id\s*([A-Z0-9-]{4,24})/i), title, dateText: capture(compact, /data\s*\/\s*date\s*([^\n]{3,40}?)(?=\s+hora\s*\/)/i), timeText: capture(compact, /hora\s*\/\s*hour\s*(\d{1,2}:\d{2})/i), pax: integer(capture(compact, /pessoas\s*\/\s*pax\s*(\d{1,3})/i)), language: capture(compact, /idioma\s*\/\s*language\s*([a-záéíóúç ]{2,30})/i), pickupPoint: capture(compact, /ponto de recolha\s*:\s*(.+?)(?=\s+idioma\s*\/|\s+condi[cç][oõ]es|$)/i), totalPriceText: capture(compact, /valor\s*total\s*\/\s*price\s*:\s*([^\n]{2,50})/i), cancellationPolicy: capture(compact, /condi[cç][oõ]es de cancelamento\s*:\s*(.+?)(?=\s+ao reservar|$)/i) }),
    items: []
  };
}

function parseLocaliza(text) {
  const compact = oneLine(text);
  return {
    provider: 'LOCALIZA', category: 'CAR_RENTAL', status: /\bfechado\b/i.test(text) ? 'COMPLETED' : /cancelad/i.test(text) ? 'CANCELLED' : 'CONFIRMED', confidence: 0.99,
    facts: compactObject({ contractNumber: capture(compact, /contrato de aluguel de carros(?:\/proposta de seguro)?\s*n[°ºo]?\s*([A-Z0-9-]{6,30})/i), confirmationCode: capture(compact, /reserva\s*:\s*([A-Z0-9-]{5,30})/i), vehicle: capture(compact, /ve[ií]culo\s*:\s*([A-Z0-9-]+\s+[^\n]{2,60}?)(?=\s+danos|\s+grupo reservado)/i), reservedGroup: capture(compact, /grupo reservado\s*:\s*(.+?)(?=\s+grupo utilizado)/i), usedGroup: capture(compact, /grupo utilizado\s*:\s*(.+?)(?=\s+grupo cobrado)/i), chargedGroup: capture(compact, /grupo cobrado\s*:\s*(.+?)(?=\s+sa[ií]da)/i), pickup: capture(compact, /sa[ií]da\s*\/\s*vig[eê]ncia seguro\s*:\s*(.+?)(?=\s+retorno\s*\/)/i), return: capture(compact, /retorno\s*\/\s*vig[eê]ncia seguro\s*:\s*(.+?)(?=\s+utiliza[cç][aã]o)/i), usage: capture(compact, /utiliza[cç][aã]o\s*:\s*(.+?)(?=\s+indeniza[cç][aã]o|\s+km\s*:)/i), mileagePolicy: /km\s*:\s*livre/i.test(compact) ? 'UNLIMITED' : null, totalPriceText: capture(compact, /total geral\s*([0-9.,]+)/i), currency: 'BRL' }),
    items: [], warnings: ['SENSITIVE_BILLING_AND_IDENTITY_FIELDS_INTENTIONALLY_NOT_EXTRACTED']
  };
}

function parseTicketwork(text) {
  const compact = oneLine(text);
  const ticketCodes = [...text.matchAll(/c[oó]digo do ingresso\s*:\s*([A-Z0-9-]{5,40})/gi)].map((m) => m[1]);
  const pages = text.split(/(?=N[aã]o compre de terceiros)/i).filter((part) => /c[oó]digo do ingresso/i.test(part));
  const items = (pages.length ? pages : [text]).map((part, index) => compactObject({
    ticketCode: capture(part, /c[oó]digo do ingresso\s*:\s*([A-Z0-9-]{5,40})/i) || ticketCodes[index],
    timeWindow: capture(part, /setor\s*:\s*([^\r\n]+)/i),
    venue: capture(part, /local do evento\s*:\s*([^\r\n]+)/i),
    priceText: capture(part, /valor\s*:\s*([^\r\n]+)/i)
  }));
  return { provider: 'TICKETWORK', category: 'EVENT_TICKET', status: 'CONFIRMED', confidence: 0.97, facts: compactObject({ title: capture(text, /CCBB[^\r\n]*\r?\n([^\r\n]+)/i), ticketCount: items.length }), items };
}

function parseMyIdTravelIcs(text) {
  const compact = oneLine(text.replace(/\r?\n[ \t]/g, ''));
  const segments = [];
  const rowRegex = /\b([A-Z0-9]{2})\s*([0-9]{2,4})\b[\s\S]{0,120}?\b(\d{2}\.\d{2}\.\d{4})\b[\s\S]{0,120}?\b([A-Z]{3})\b[\s\S]{0,80}?\b(\d{1,2}:\d{2})\b[\s\S]{0,80}?\b([A-Z]{3})\b[\s\S]{0,80}?\b(\d{1,2}:\d{2})\b[\s\S]{0,160}?(ZED\s*-\s*R\d\s*Standby)?[\s\S]{0,80}?(LISTADO|FALHA|CONFIRMADO|CONFIRMED)?/gi;
  let match;
  while ((match = rowRegex.exec(compact)) && segments.length < 30) {
    segments.push(compactObject({ carrier: match[1], flightNumber: match[2], dateText: match[3], origin: match[4], departureTimeLocal: match[5], destination: match[6], arrivalTimeLocal: match[7], travelStatus: match[8], bookingStatus: match[9] }));
  }
  const summary = capture(text, /^SUMMARY[^:]*:(.+)$/mi);
  if (!segments.length && summary) {
    const fallback = summary.match(/([A-Z0-9]{2})(\d{2,4})\s*:\s*([A-Z]{3})\s*-\s*([A-Z]{3})/i);
    if (fallback) segments.push({ carrier: fallback[1], flightNumber: fallback[2], origin: fallback[3], destination: fallback[4] });
  }
  return {
    provider: 'MYIDTRAVEL', category: 'AIR_TRAVEL', status: segments.some((s) => /LISTADO|CONFIRMADO|CONFIRMED/i.test(s.bookingStatus || '')) ? 'LISTED_OR_CONFIRMED' : 'STANDBY_OR_UNKNOWN', confidence: 0.96,
    facts: compactObject({ confirmationCode: capture(compact, /(?:filekey|c[oó]digo de reserva)\s*[:\s]\s*([A-Z0-9]{5,12})/i), segmentCount: segments.length, calendarStart: capture(text, /^DTSTART[^:]*:(\d{8}T?\d{0,6})/mi), calendarEnd: capture(text, /^DTEND[^:]*:(\d{8}T?\d{0,6})/mi) }), items: segments
  };
}

function parseBookingCom(text) {
  const compact = oneLine(text);
  const status = /cancel(?:lation|amento|ada|ada com sucesso)/i.test(compact) ? 'CANCELLED' : /alterad|updated|modified/i.test(compact) ? 'MODIFIED' : 'CONFIRMED';
  return {
    provider: 'BOOKING_COM', category: 'LODGING', status, confidence: 0.94,
    facts: compactObject({ confirmationCode: capture(compact, /(?:confirmation number|confirma[cç][aã]o|n[uú]mero de confirma[cç][aã]o)\s*[:#]?\s*([0-9]{6,14})/i), property: capture(compact, /(?:booking at|reserva (?:em|no|na))\s+(.+?)(?=\s+est[aá] confirmada|\s+has been|\s+estara|\s+estar[aá]|$)/i), roomType: capture(compact, /([A-Za-zÀ-ÿ ]{3,50}\s+Room|Quarto\s+[A-Za-zÀ-ÿ ]{3,50})/i) }), items: []
  };
}

function parseGetYourGuide(text) {
  const compact = oneLine(text);
  return { provider: 'GETYOURGUIDE', category: /transfer/i.test(compact) ? 'TRANSFER' : 'TOUR', status: /cancel/i.test(compact) ? 'CANCELLED' : 'CONFIRMED', confidence: 0.9, facts: compactObject({ confirmationCode: capture(compact, /booking\s+(GYG[A-Z0-9]+)\s+confirmed/i), title: capture(compact, /confirmed\s*\|?\s*(.+?)(?=\s+ticket instructions|$)/i) }), items: [] };
}

function normalizeProvider(value) {
  const upper = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  if (!upper || ['MANUAL_PDF', 'GMAIL', 'UPLOAD'].includes(upper)) return null;
  if (upper === 'BOOKING_COM' || upper === 'BOOKING') return 'BOOKING_COM';
  if (upper.includes('LATAM')) return 'LATAM';
  if (upper.includes('CLICKBUS')) return 'CLICKBUS';
  if (upper.includes('CIVITATIS')) return 'CIVITATIS';
  if (upper.includes('LOCALIZA')) return 'LOCALIZA';
  if (upper.includes('MYID')) return 'MYIDTRAVEL';
  if (upper.includes('TICKETWORK') || upper.includes('CCBB')) return 'TICKETWORK';
  if (upper.includes('GETYOURGUIDE')) return 'GETYOURGUIDE';
  return null;
}

function privacyContract() {
  return { rawPersonalDataCommittedToCorpus: false, intentionallyExcluded: ['government_id', 'full_postal_address', 'payment_card', 'payment_authorization', 'email', 'phone'], corpusPolicy: 'Learn parser structure from user-authorized examples; commit only synthetic/redacted fixtures.' };
}

function meaningfulLines(text) { return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
function oneLine(text) { return meaningfulLines(text).join(' ').replace(/\s+/g, ' ').trim(); }
function capture(text, regex, joinGroups = false) { const m = String(text || '').match(regex); if (!m) return null; return joinGroups ? m.slice(1).filter(Boolean).join(' ') : (m[1] ? m[1].trim() : null); }
function integer(value) { const n = Number.parseInt(value, 10); return Number.isFinite(n) ? n : null; }
function compactObject(value) { return Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v !== null && v !== undefined && v !== '')); }
