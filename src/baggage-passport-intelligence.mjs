const AIRPORT_CODE = /^[A-Z]{3}$/;
const FLIGHT_TOKEN = /^[A-Z0-9]{2,3}\s?\d{1,4}[A-Z]?$/;

export function baggagePassportCapabilities() {
  return {
    version: '1.0',
    purpose: 'Turn a baggage-tag/claim-receipt scan into structured evidence for connection guidance and a useful proof pack for mishandled-baggage support.',
    capture: ['BAG_PHOTO', 'BAGGAGE_CLAIM_RECEIPT', 'BAG_TAG'],
    recognition: ['ON_DEVICE_OCR', 'BARCODE_WHEN_AVAILABLE', 'IATA_AIRPORT_CODES', 'BAG_TAG_LICENSE_PLATE', 'FLIGHT_TOKENS'],
    evidencePriority: [
      'CUSTOMS_OR_ENTRY_RECLAIM_RULE',
      'BAG_TAG_FINAL_DESTINATION_OR_AIRLINE_CONFIRMATION',
      'INTERLINE_THROUGH_CHECK_CONFIRMATION',
      'SAME_RESERVATION_AND_SAME_CARRIER_INFERENCE',
      'SEPARATE_TICKET_OR_SELF_TRANSFER_INFERENCE'
    ],
    privacy: {
      rawImageRetentionDefault: false,
      derivedFactsOnlyDefault: true,
      userMayOptInToEncryptedProofPack: true,
      passengerNameNotRequiredForRoutingDecision: true
    },
    importantRules: [
      'A same reservation locator is a strong routing signal, not a customs override.',
      'A carrier change does not prove the bag will stop; interline through-check may exist.',
      'A separate ticket/self-transfer should default to collection unless the bag tag or airline explicitly confirms through-check.',
      'A bag tag showing the final destination is strong evidence of through-tagging, but a mandatory customs reclaim can still require physical collection and recheck.',
      'Do not infer through-check from a baggage carousel assignment.'
    ]
  };
}

export function analyzeBaggagePassport(input = {}) {
  const itinerary = normalizeItinerary(input.itinerary || input);
  const reservation = normalizeReservation(input.reservation || input);
  const scan = normalizeScan(input.scan || input.ocr || {});
  const parsed = parseBaggageTagScan(scan, itinerary);
  const customsReclaimRequired = triState(input.customsReclaimRequired ?? input.customs?.reclaimRequired);
  const inference = inferHandling({ itinerary, reservation, parsed, customsReclaimRequired });

  return {
    version: '1.0',
    parsed,
    reservation,
    inference,
    baggageEvidence: buildBaggageEvidence({ inference, parsed, customsReclaimRequired }),
    proofPack: buildProofPack(input, parsed),
    nextAction: buildNextAction(inference),
    privacy: baggagePassportCapabilities().privacy
  };
}

export function parseBaggageTagScan(scanInput = {}, itineraryInput = {}) {
  const itinerary = normalizeItinerary(itineraryInput);
  const scan = normalizeScan(scanInput);
  const text = scan.text;
  const candidateAirports = collectAirportCandidates(scan, itinerary);
  const routeAirports = rankAirportCandidates(candidateAirports, itinerary);
  const finalDestination = chooseFinalDestination(routeAirports, itinerary, scan);
  const licensePlate = extractLicensePlate(text);
  const flights = extractFlights(scan, itinerary);

  const confidenceSignals = [
    Boolean(finalDestination?.code),
    Boolean(licensePlate),
    flights.length > 0,
    scan.lines.some((line) => Number.isFinite(line.top))
  ].filter(Boolean).length;

  return {
    rawTextProvided: Boolean(text),
    finalDestinationAirport: finalDestination?.code || null,
    finalDestinationConfidence: finalDestination?.confidence || 'LOW',
    routeAirports: routeAirports.map((item) => item.code),
    baggageLicensePlate: licensePlate,
    flights,
    confidence: confidenceSignals >= 3 ? 'HIGH' : confidenceSignals >= 2 ? 'MEDIUM' : 'LOW',
    passengerNameRetained: false,
    source: scan.source || 'OCR_OR_MANUAL_SCAN'
  };
}

function inferHandling({ itinerary, reservation, parsed, customsReclaimRequired }) {
  const currentArrival = itinerary.connectionAirport;
  const finalDestination = itinerary.finalDestinationAirport;
  const tagDestination = parsed.finalDestinationAirport;

  if (customsReclaimRequired === true) {
    return result('COLLECT_FOR_CUSTOMS_RECHECK', 'HIGH', 'CUSTOMS_RECLAIM_OVERRIDE', 'A regra de entrada/alfândega exige retirar a bagagem e fazer novo despacho, mesmo que a etiqueta mostre o destino final.');
  }

  if (tagDestination && finalDestination && tagDestination === finalDestination && parsed.finalDestinationConfidence !== 'LOW') {
    return result('THROUGH_TAG_CONFIRMED', parsed.finalDestinationConfidence, 'BAG_TAG_FINAL_DESTINATION', `A etiqueta indica ${finalDestination} como destino final da bagagem.`);
  }

  if (tagDestination && currentArrival && tagDestination === currentArrival && finalDestination && currentArrival !== finalDestination) {
    return result('COLLECT_REQUIRED', 'HIGH', 'BAG_TAG_STOPS_AT_CONNECTION', `A etiqueta termina em ${currentArrival}; existe trecho posterior até ${finalDestination}.`);
  }

  if (reservation.interlineThroughCheckConfirmed === true) {
    return result('THROUGH_TAG_CONFIRMED', 'HIGH', 'INTERLINE_CONFIRMED', 'O despacho até o destino final foi confirmado para a conexão entre companhias.');
  }

  if (reservation.separateTickets === true || reservation.selfTransfer === true) {
    return result('COLLECT_REQUIRED_UNLESS_TAG_CONFIRMS_THROUGH', 'HIGH', 'SEPARATE_TICKETS_OR_SELF_TRANSFER', 'Trechos separados/self-transfer devem assumir retirada da bagagem até que a etiqueta ou a companhia confirme despacho direto.');
  }

  if (reservation.carrierChange === true) {
    return result('VERIFY_INTERLINE', 'MEDIUM', 'CARRIER_CHANGE', 'Há troca de companhia. A bagagem pode seguir por acordo interline, mas isso precisa ser confirmado na etiqueta ou pela companhia.');
  }

  if (reservation.sameReservationCode === true && reservation.sameCarrier === true && itinerary.interAirportTransfer !== true) {
    return result('LIKELY_THROUGH_CHECKED_VERIFY_TAG', 'MEDIUM', 'SAME_RESERVATION_SAME_CARRIER', 'Mesma reserva e mesma companhia são forte sinal de despacho até o destino final. Confirme pela etiqueta antes de orientar o usuário a não retirar.');
  }

  if (itinerary.interAirportTransfer === true) {
    return result('VERIFY_INTERAIRPORT_TRANSFER', 'LOW', 'AIRPORT_CHANGE', 'A conexão muda de aeroporto; a bagagem precisa ser validada explicitamente antes de qualquer orientação.');
  }

  return result('VERIFY_TAG_OR_AIRLINE', 'LOW', 'INSUFFICIENT_EVIDENCE', 'Ainda falta evidência suficiente sobre o destino da bagagem.');
}

function buildBaggageEvidence({ inference, parsed, customsReclaimRequired }) {
  const tagFinal = parsed.finalDestinationAirport;
  if (inference.state === 'COLLECT_FOR_CUSTOMS_RECHECK') {
    return { customsReclaimRequired: true, mustCollect: true, reason: 'CUSTOMS_RECHECK', verified: true, evidenceSource: inference.source, bagTagDestination: tagFinal };
  }
  if (inference.state === 'COLLECT_REQUIRED') {
    return { customsReclaimRequired: customsReclaimRequired ?? null, mustCollect: true, verified: true, evidenceSource: inference.source, bagTagDestination: tagFinal };
  }
  if (inference.state === 'THROUGH_TAG_CONFIRMED') {
    return { customsReclaimRequired: customsReclaimRequired ?? null, throughChecked: true, mustCollect: false, verified: true, evidenceSource: inference.source, bagTagDestination: tagFinal };
  }
  return {
    customsReclaimRequired: customsReclaimRequired ?? null,
    throughChecked: null,
    mustCollect: null,
    verified: false,
    evidenceSource: inference.source,
    bagTagDestination: tagFinal
  };
}

function buildProofPack(input, parsed) {
  const consent = input.proofPack?.retainEvidence === true;
  return {
    enabled: consent,
    defaultStorage: consent ? 'ENCRYPTED_USER_SCOPED' : 'DERIVED_FACTS_ONLY',
    bagPhotoProvided: Boolean(input.proofPack?.bagPhotoProvided || input.bagPhotoProvided),
    claimReceiptProvided: Boolean(input.proofPack?.claimReceiptProvided || input.claimReceiptProvided || parsed.baggageLicensePlate),
    baggageLicensePlate: parsed.baggageLicensePlate,
    finalDestinationAirport: parsed.finalDestinationAirport,
    usefulFor: ['DELAYED_BAG_REPORT', 'MISSING_BAG_REPORT', 'DAMAGE_REPORT', 'BAG_IDENTIFICATION'],
    legalClaim: 'SUPPORTING_EVIDENCE_NOT_LEGAL_CONCLUSION'
  };
}

function buildNextAction(inference) {
  if (inference.state === 'THROUGH_TAG_CONFIRMED') return { type: 'GUIDE_WITHOUT_COLLECTION', askUserToScanTag: false };
  if (['COLLECT_REQUIRED', 'COLLECT_FOR_CUSTOMS_RECHECK'].includes(inference.state)) return { type: 'GUIDE_TO_BAGGAGE_CLAIM', askUserToScanTag: false };
  if (inference.state === 'LIKELY_THROUGH_CHECKED_VERIFY_TAG') return { type: 'ASK_FOR_TAG_PHOTO', askUserToScanTag: true, prompt: 'Fotografe o comprovante/etiqueta da bagagem. O Voyage confirma em segundos até qual aeroporto a mala foi etiquetada.' };
  if (inference.state === 'VERIFY_INTERLINE') return { type: 'ASK_FOR_TAG_PHOTO_OR_AIRLINE_CONFIRMATION', askUserToScanTag: true };
  return { type: 'VERIFY_BEFORE_GUIDANCE', askUserToScanTag: true };
}

function collectAirportCandidates(scan, itinerary) {
  const expected = new Set([
    itinerary.originAirport,
    itinerary.connectionAirport,
    itinerary.nextDepartureAirport,
    itinerary.finalDestinationAirport,
    ...(itinerary.knownAirports || [])
  ].filter(Boolean));
  const candidates = [];

  for (const line of scan.lines) {
    const tokens = String(line.text || '').toUpperCase().match(/\b[A-Z]{3}\b/g) || [];
    for (const token of tokens) {
      if (expected.size && !expected.has(token)) continue;
      candidates.push({ code: token, top: line.top, source: 'LINE' });
    }
  }

  if (!candidates.length) {
    const tokens = scan.text.toUpperCase().match(/\b[A-Z]{3}\b/g) || [];
    for (const token of tokens) {
      if (expected.size && !expected.has(token)) continue;
      candidates.push({ code: token, top: null, source: 'TEXT' });
    }
  }
  return candidates;
}

function rankAirportCandidates(candidates, itinerary) {
  const unique = new Map();
  for (const item of candidates) {
    const current = unique.get(item.code);
    if (!current || (Number.isFinite(item.top) && (!Number.isFinite(current.top) || item.top < current.top))) unique.set(item.code, item);
  }
  const order = [...unique.values()];
  order.sort((a, b) => {
    if (Number.isFinite(a.top) && Number.isFinite(b.top)) return a.top - b.top;
    if (a.code === itinerary.finalDestinationAirport) return -1;
    if (b.code === itinerary.finalDestinationAirport) return 1;
    return 0;
  });
  return order;
}

function chooseFinalDestination(routeAirports, itinerary, scan) {
  if (!routeAirports.length) return null;
  const expectedFinal = itinerary.finalDestinationAirport;
  const positioned = routeAirports.filter((item) => Number.isFinite(item.top));
  if (positioned.length) {
    const top = positioned[0];
    return { code: top.code, confidence: expectedFinal && top.code === expectedFinal ? 'HIGH' : 'MEDIUM' };
  }
  if (expectedFinal && routeAirports.some((item) => item.code === expectedFinal)) {
    return { code: expectedFinal, confidence: scan.text ? 'MEDIUM' : 'LOW' };
  }
  return { code: routeAirports[0].code, confidence: 'LOW' };
}

function extractLicensePlate(text) {
  const normalized = String(text || '').replace(/[\u00a0]/g, ' ');
  const direct = normalized.match(/(?<!\d)(\d{10})(?!\d)/)?.[1];
  if (direct) return direct;
  const grouped = normalized.match(/(?<!\d)(\d)\s+(\d{3})\s+(\d{6})(?!\d)/);
  return grouped ? `${grouped[1]}${grouped[2]}${grouped[3]}` : null;
}

function extractFlights(scan, itinerary) {
  const expected = new Set((itinerary.flightNumbers || []).map(normalizeFlight).filter(Boolean));
  const source = [scan.text, ...scan.lines.map((line) => line.text)].join('\n').toUpperCase();
  const tokens = source.match(/\b[A-Z0-9]{2,3}\s?\d{1,4}[A-Z]?\b/g) || [];
  const flights = [];
  for (const token of tokens) {
    const normalized = normalizeFlight(token);
    if (!normalized || !FLIGHT_TOKEN.test(token.trim().toUpperCase())) continue;
    if (expected.size && !expected.has(normalized)) continue;
    if (!flights.includes(normalized)) flights.push(normalized);
  }
  return flights.slice(0, 8);
}

function normalizeItinerary(input = {}) {
  return {
    originAirport: code(input.originAirport || input.origin),
    connectionAirport: code(input.connectionAirport || input.arrivalAirport),
    nextDepartureAirport: code(input.nextDepartureAirport || input.departureAirport),
    finalDestinationAirport: code(input.finalDestinationAirport || input.finalDestination),
    knownAirports: Array.isArray(input.knownAirports) ? input.knownAirports.map(code).filter(Boolean) : [],
    flightNumbers: Array.isArray(input.flightNumbers) ? input.flightNumbers : [],
    interAirportTransfer: input.interAirportTransfer === true
  };
}

function normalizeReservation(input = {}) {
  return {
    sameReservationCode: triState(input.sameReservationCode ?? input.samePnr),
    sameCarrier: triState(input.sameCarrier),
    carrierChange: triState(input.carrierChange ?? input.differentCarrier),
    separateTickets: triState(input.separateTickets ?? input.separateReservations),
    selfTransfer: triState(input.selfTransfer),
    interlineThroughCheckConfirmed: triState(input.interlineThroughCheckConfirmed)
  };
}

function normalizeScan(input = {}) {
  const lines = Array.isArray(input.lines) ? input.lines.map((line) => ({
    text: String(line?.text || '').trim(),
    top: finite(line?.top ?? line?.boundingBox?.top ?? line?.frame?.top)
  })).filter((line) => line.text) : [];
  const text = String(input.text || lines.map((line) => line.text).join('\n') || '').trim();
  return { text, lines, source: String(input.source || '').trim() || null };
}

function normalizeFlight(value) {
  const token = String(value || '').toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(token) ? token : null;
}

function result(state, confidence, source, explanation) {
  return { state, confidence, source, explanation };
}

function code(value) {
  const clean = String(value || '').trim().toUpperCase();
  return AIRPORT_CODE.test(clean) ? clean : null;
}

function triState(value) {
  return value === true ? true : value === false ? false : null;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
