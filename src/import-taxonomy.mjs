const CATEGORY_RULES = [
  ['BOARDING_PASS', ['boarding pass', 'cartão de embarque', 'cartao de embarque', 'tarjeta de embarque', 'seat', 'assento', 'gate', 'portão', 'portao', 'boarding group']],
  ['AIR_TRAVEL', ['flight', 'voo', 'airline', 'companhia aérea', 'companhia aerea', 'e-ticket', 'eticket', 'bilhete aéreo', 'bilhete aereo', 'pnr', 'record locator']],
  ['LODGING', ['hotel', 'hostel', 'resort', 'pousada', 'check-in', 'check in', 'check-out', 'check out', 'acomodação', 'acomodacao', 'quarto', 'room']],
  ['CAR_RENTAL', ['car rental', 'rent a car', 'aluguel de carro', 'locação de veículo', 'locacao de veiculo', 'rental car', 'pickup location', 'drop-off location']],
  ['RAIL', ['train', 'trem', 'rail', 'ferrovia', 'estação', 'estacao', 'platform', 'plataforma', 'coach', 'vagão', 'vagao']],
  ['BUS', ['bus', 'ônibus', 'onibus', 'rodoviária', 'rodoviaria', 'terminal rodoviário', 'terminal rodoviario']],
  ['FERRY', ['ferry', 'balsa', 'ferryboat', 'embarcação', 'embarcacao', 'porto', 'pier']],
  ['TRANSFER', ['transfer', 'shuttle', 'traslado', 'motorista', 'pickup service', 'airport transfer']],
  ['EVENT_TICKET', ['concert', 'show', 'festival', 'ingresso', 'ticket', 'arena', 'estádio', 'estadio', 'admission', 'entrada']],
  ['ATTRACTION_TICKET', ['museum', 'museu', 'aquarium', 'aquário', 'aquario', 'theme park', 'parque', 'attraction', 'atração', 'atracao', 'monument', 'monumento']],
  ['TOUR', ['tour', 'excursion', 'excursão', 'excursao', 'guided visit', 'visita guiada', 'walking tour', 'passeio']],
  ['RESTAURANT', ['restaurant', 'restaurante', 'reservation', 'reserva de mesa', 'table for', 'mesa para']],
  ['TRAVEL_INSURANCE', ['travel insurance', 'seguro viagem', 'seguro de viagem', 'policy number', 'apólice', 'apolice', 'coverage', 'cobertura']],
  ['LOUNGE', ['lounge', 'sala vip', 'vip lounge']],
  ['PARKING', ['parking', 'estacionamento', 'vaga', 'park & fly']],
  ['VISA_OR_ENTRY', ['visa', 'visto', 'eta', 'esta', 'entry permit', 'autorização de viagem', 'autorizacao de viagem']],
  ['CRUISE', ['cruise', 'cruzeiro', 'cabin', 'cabine', 'ship', 'navio', 'port of call']],
  ['BAGGAGE', ['baggage', 'bagagem', 'luggage', 'maleta', 'baggage tag', 'etiqueta de bagagem']]
];

export const DOCUMENT_CATEGORIES = Object.freeze([
  'BOARDING_PASS', 'AIR_TRAVEL', 'LODGING', 'CAR_RENTAL', 'RAIL', 'BUS', 'FERRY', 'TRANSFER',
  'EVENT_TICKET', 'ATTRACTION_TICKET', 'TOUR', 'RESTAURANT', 'TRAVEL_INSURANCE', 'LOUNGE',
  'PARKING', 'VISA_OR_ENTRY', 'CRUISE', 'BAGGAGE', 'OTHER'
]);

export function classifyTravelDocument(text = '', hintedCategory = null) {
  const normalized = normalize(text);
  const hint = DOCUMENT_CATEGORIES.includes(hintedCategory) ? hintedCategory : null;
  const scored = CATEGORY_RULES.map(([category, terms]) => {
    const evidence = terms.filter((term) => normalized.includes(normalize(term)));
    const score = evidence.reduce((total, term) => total + Math.min(3, Math.max(1, term.split(/\s+/).length)), 0);
    return { category, score, evidence: evidence.slice(0, 6) };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  if (hint) {
    const match = scored.find((item) => item.category === hint);
    return Object.freeze({
      category: hint,
      confidence: clamp(0.72 + Math.min(0.24, (match?.score || 0) * 0.03)),
      evidence: match?.evidence || ['user_hint'],
      alternatives: scored.filter((item) => item.category !== hint).slice(0, 3)
    });
  }

  const winner = scored[0];
  if (!winner) return Object.freeze({ category: 'OTHER', confidence: 0.25, evidence: [], alternatives: [] });
  const runnerUp = scored[1]?.score || 0;
  const separation = Math.max(0, winner.score - runnerUp);
  return Object.freeze({
    category: winner.category,
    confidence: clamp(0.48 + Math.min(0.36, winner.score * 0.045) + Math.min(0.12, separation * 0.02)),
    evidence: winner.evidence,
    alternatives: scored.slice(1, 4)
  });
}

export function supportedImportCapabilities() {
  return Object.freeze({
    acceptedMimeTypes: ['application/pdf'],
    maxPdfBytes: 15 * 1024 * 1024,
    categories: DOCUMENT_CATEGORIES,
    sourceModes: ['MANUAL_PDF', 'MANUAL_ENTRY', 'GMAIL_REALTIME'],
    designPrinciple: 'Unknown documents remain importable as OTHER and are never discarded solely because the classifier is unsure.'
  });
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
