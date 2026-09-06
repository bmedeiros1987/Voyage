import { createHash, randomUUID } from 'node:crypto';

export function reservationFingerprint(input = {}) {
  const canonical = {
    category: clean(input.category || input.reservationType || 'OTHER'),
    provider: clean(input.provider),
    confirmationCode: upper(input.confirmationCode),
    flight: input.marketingCarrier && input.flightNumber ? `${upper(input.marketingCarrier)}${digits(input.flightNumber)}` : '',
    route: normalizeRoute(input.route),
    date: normalizeDateOnly(input.startsAt || input.departureAt || firstDate(input.dateMentions)),
    title: clean(input.title || input.propertyName || input.venue)
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function matchReservation(existing = [], incoming = {}) {
  const candidates = existing.map((candidate) => ({ candidate, ...scoreReservation(candidate, incoming) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = candidates[0] || null;
  return Object.freeze({
    matched: Boolean(best && best.score >= 0.72),
    ambiguous: Boolean(best && best.score >= 0.55 && best.score < 0.72),
    score: best?.score || 0,
    reservationId: best?.candidate?.id || null,
    evidence: best?.evidence || [],
    alternatives: candidates.slice(1, 4).map((item) => ({ reservationId: item.candidate.id, score: item.score, evidence: item.evidence }))
  });
}

export function buildTripGraph(reservations = []) {
  const nodes = reservations.map((reservation) => ({
    id: reservation.id || randomUUID(),
    kind: reservation.category || reservation.reservationType || 'OTHER',
    startsAt: normalizeDateTime(reservation.startsAt || reservation.departureAt || reservation.checkIn),
    endsAt: normalizeDateTime(reservation.endsAt || reservation.arrivalAt || reservation.checkOut),
    locationStart: locationStart(reservation),
    locationEnd: locationEnd(reservation),
    fingerprint: reservationFingerprint(reservation)
  })).sort(compareNodes);

  const edges = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const left = nodes[i];
    const right = nodes[i + 1];
    edges.push({
      id: `edge-${left.id}-${right.id}`,
      from: left.id,
      to: right.id,
      relation: inferRelation(left, right),
      confidence: edgeConfidence(left, right)
    });
  }

  return Object.freeze({ nodes, edges, span: graphSpan(nodes) });
}

export function suggestTripForReservation(trips = [], incoming = {}) {
  const incomingStart = dateMs(incoming.startsAt || incoming.departureAt || incoming.checkIn || firstDate(incoming.dateMentions));
  const incomingEnd = dateMs(incoming.endsAt || incoming.arrivalAt || incoming.checkOut || incomingStart);
  if (!incomingStart) return { tripId: null, score: 0, evidence: ['NO_DATE_SIGNAL'] };

  const scored = trips.map((trip) => {
    const tripStart = dateMs(trip.startDate);
    const tripEnd = dateMs(trip.endDate || trip.startDate);
    let score = 0;
    const evidence = [];
    if (tripStart && tripEnd && rangesNear(tripStart, tripEnd, incomingStart, incomingEnd, 36 * 60 * 60 * 1000)) {
      score += 0.72;
      evidence.push('DATE_WINDOW_OVERLAP');
    }
    const destination = clean(trip.destinationSummary || trip.subtitle || trip.title);
    const location = clean([locationStart(incoming), locationEnd(incoming), incoming.venue, incoming.propertyName].filter(Boolean).join(' '));
    if (destination && location && tokenOverlap(destination, location) >= 0.25) {
      score += 0.2;
      evidence.push('LOCATION_OVERLAP');
    }
    return { tripId: trip.id, score: Math.min(1, score), evidence };
  }).sort((a, b) => b.score - a.score);

  return scored[0] || { tripId: null, score: 0, evidence: [] };
}

function scoreReservation(a = {}, b = {}) {
  let score = 0;
  const evidence = [];
  if (a.confirmationCode && b.confirmationCode && upper(a.confirmationCode) === upper(b.confirmationCode)) {
    score += 0.72; evidence.push('CONFIRMATION_CODE');
  }
  if (a.provider && b.provider && clean(a.provider) === clean(b.provider)) {
    score += 0.08; evidence.push('PROVIDER');
  }
  const aFlight = a.marketingCarrier && a.flightNumber ? `${upper(a.marketingCarrier)}${digits(a.flightNumber)}` : '';
  const bFlight = b.marketingCarrier && b.flightNumber ? `${upper(b.marketingCarrier)}${digits(b.flightNumber)}` : '';
  if (aFlight && bFlight && aFlight === bFlight) { score += 0.35; evidence.push('FLIGHT_NUMBER'); }
  const aRoute = normalizeRoute(a.route);
  const bRoute = normalizeRoute(b.route);
  if (aRoute && bRoute && aRoute === bRoute) { score += 0.18; evidence.push('ROUTE'); }
  const aDate = normalizeDateOnly(a.startsAt || a.departureAt || a.checkIn || firstDate(a.dateMentions));
  const bDate = normalizeDateOnly(b.startsAt || b.departureAt || b.checkIn || firstDate(b.dateMentions));
  if (aDate && bDate && aDate === bDate) { score += 0.18; evidence.push('DATE'); }
  const aTitle = clean(a.title || a.propertyName || a.venue);
  const bTitle = clean(b.title || b.propertyName || b.venue);
  const overlap = tokenOverlap(aTitle, bTitle);
  if (overlap >= 0.6) { score += 0.2; evidence.push('TITLE'); }
  const aFp = reservationFingerprint(a);
  const bFp = reservationFingerprint(b);
  if (aFp === bFp) { score = Math.max(score, 0.94); evidence.push('FINGERPRINT'); }
  return { score: Math.min(1, score), evidence: [...new Set(evidence)] };
}

function inferRelation(left, right) {
  if (left.locationEnd && right.locationStart && clean(left.locationEnd) === clean(right.locationStart)) return 'CONTINUES_AT_LOCATION';
  if (left.kind === 'AIR_TRAVEL' && right.kind === 'AIR_TRAVEL') return 'FLIGHT_CONNECTION';
  if (left.kind === 'BOARDING_PASS' && right.kind === 'AIR_TRAVEL') return 'DOCUMENTS_SEGMENT';
  if (right.kind === 'LODGING') return 'ARRIVES_TO_STAY';
  if (['EVENT_TICKET', 'ATTRACTION_TICKET', 'TOUR', 'RESTAURANT'].includes(right.kind)) return 'PRECEDES_ACTIVITY';
  return 'NEXT_IN_TIME';
}

function edgeConfidence(left, right) {
  let score = 0.55;
  if (left.endsAt && right.startsAt) {
    const gap = Math.abs(dateMs(right.startsAt) - dateMs(left.endsAt));
    if (gap <= 12 * 60 * 60 * 1000) score += 0.22;
    else if (gap <= 48 * 60 * 60 * 1000) score += 0.12;
  }
  if (left.locationEnd && right.locationStart && clean(left.locationEnd) === clean(right.locationStart)) score += 0.18;
  return Math.min(0.98, score);
}

function graphSpan(nodes) {
  const starts = nodes.map((n) => dateMs(n.startsAt)).filter(Boolean);
  const ends = nodes.map((n) => dateMs(n.endsAt || n.startsAt)).filter(Boolean);
  if (!starts.length && !ends.length) return { start: null, end: null };
  return {
    start: new Date(Math.min(...starts, ...ends)).toISOString(),
    end: new Date(Math.max(...starts, ...ends)).toISOString()
  };
}

function compareNodes(a, b) {
  const ax = dateMs(a.startsAt) || Number.MAX_SAFE_INTEGER;
  const bx = dateMs(b.startsAt) || Number.MAX_SAFE_INTEGER;
  return ax - bx || a.id.localeCompare(b.id);
}

function locationStart(value = {}) {
  return value.route?.origin || value.origin || value.originText || value.pickupLocation || value.location || value.venue || value.propertyName || null;
}
function locationEnd(value = {}) {
  return value.route?.destination || value.destination || value.destinationText || value.dropoffLocation || value.location || value.venue || value.propertyName || null;
}
function normalizeRoute(route) {
  if (!route) return '';
  if (typeof route === 'string') return clean(route).replace(/\s+/g, '');
  if (route.origin && route.destination) return `${upper(route.origin)}>${upper(route.destination)}`;
  return '';
}
function normalizeDateOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const match = String(value).match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  if (!match) return '';
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}
function normalizeDateTime(value) {
  if (!value) return null;
  const ms = dateMs(value);
  return ms ? new Date(ms).toISOString() : null;
}
function dateMs(value) { const ms = value ? new Date(value).getTime() : NaN; return Number.isFinite(ms) ? ms : 0; }
function firstDate(values) { return Array.isArray(values) ? values[0] : null; }
function rangesNear(aStart, aEnd, bStart, bEnd, tolerance) { return bStart <= aEnd + tolerance && bEnd >= aStart - tolerance; }
function clean(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function upper(value) { return String(value || '').toUpperCase().replace(/\s+/g, ''); }
function digits(value) { return String(value || '').replace(/\D/g, ''); }
function tokenOverlap(a, b) {
  if (!a || !b) return 0;
  const aa = new Set(a.split(/\s+/).filter((x) => x.length > 2));
  const bb = new Set(b.split(/\s+/).filter((x) => x.length > 2));
  if (!aa.size || !bb.size) return 0;
  const common = [...aa].filter((x) => bb.has(x)).length;
  return common / Math.max(aa.size, bb.size);
}
