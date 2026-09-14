const BAGGAGE_DECISIONS = new Set([
  'NO_CHECKED_BAG',
  'COLLECT_REQUIRED',
  'COLLECT_FOR_CUSTOMS_RECHECK',
  'THROUGH_CHECKED_DO_NOT_COLLECT',
  'VERIFY_WITH_AIRLINE',
  'VERIFY_INTERAIRPORT_TRANSFER'
]);

export function baggageIntelligenceCapabilities() {
  return {
    version: '1.0',
    purpose: 'Tell the traveller whether checked baggage must be collected during a connection, surface the baggage carousel when known, and route the traveller to the correct next step.',
    dataSources: {
      flightStatus: ['CIRIUM_FLIGHT_STATUS', 'AIRLINE', 'AIRPORT_FIDS'],
      throughCheckDecision: ['AIRLINE_ITINERARY', 'BAG_TAG_DESTINATION', 'AIRLINE_AGENT_CONFIRMATION', 'AIRPORT_OR_CUSTOMS_RULE'],
      carousel: ['CIRIUM_FLIGHT_STATUS', 'AIRPORT_FIDS', 'AIRLINE']
    },
    importantDistinction: 'A baggage carousel value identifies where arriving baggage is delivered. It does not by itself prove whether the traveller must collect the bag during a connection.',
    notifications: ['COLLECT_BAG', 'DO_NOT_COLLECT_BAG', 'CAROUSEL_ASSIGNED', 'CAROUSEL_CHANGED', 'BAGGAGE_DECISION_UNRESOLVED'],
    userFacingRule: 'Never guess a through-check decision. When evidence is insufficient, tell the user what is unknown and how to verify it.',
    itineraryMutationAllowedAutomatically: false
  };
}

export function buildBaggageConnectionDecision(input = {}) {
  const connection = normalizeConnection(input.connection || input);
  const baggage = normalizeBaggage(input.baggage || input);
  const carousel = normalizeCarousel(input.carousel || input.baggageClaim || input.cirium || {});
  const evidence = normalizeEvidence(input.evidence || input);

  const decision = decideBaggage(connection, baggage, evidence);
  const message = buildMessage(decision, connection, carousel, evidence);
  const nextStep = buildNextStep(decision, carousel, connection);
  const alerts = buildAlerts(decision, carousel, input.previousCarousel || null);

  return {
    version: '1.0',
    decision,
    baggage,
    connection,
    carousel,
    message,
    nextStep,
    alerts,
    confidence: decisionConfidence(decision, evidence, baggage),
    indoorNavigationTarget: buildIndoorTarget(decision, carousel, connection),
    providerNeeds: buildProviderNeeds(decision, carousel, evidence),
    rules: {
      carouselDoesNotDetermineThroughCheck: true,
      interAirportTransferRequiresExplicitBaggageVerification: true,
      itineraryMutationAllowedAutomatically: false,
      userApprovalRequiredForItineraryChanges: true
    }
  };
}

function decideBaggage(connection, baggage, evidence) {
  if (!baggage.hasCheckedBag) return 'NO_CHECKED_BAG';

  if (evidence.mustCollect === true) {
    if (evidence.reason === 'CUSTOMS_RECHECK' || evidence.customsReclaimRequired === true) return 'COLLECT_FOR_CUSTOMS_RECHECK';
    return 'COLLECT_REQUIRED';
  }

  if (evidence.customsReclaimRequired === true) return 'COLLECT_FOR_CUSTOMS_RECHECK';

  if (evidence.throughChecked === true && evidence.mustCollect !== true) {
    return 'THROUGH_CHECKED_DO_NOT_COLLECT';
  }

  if (connection.interAirportTransfer) return 'VERIFY_INTERAIRPORT_TRANSFER';
  return 'VERIFY_WITH_AIRLINE';
}

function buildMessage(decision, connection, carousel, evidence) {
  if (decision === 'NO_CHECKED_BAG') return 'Você não informou bagagem despachada. Siga diretamente para a próxima etapa da conexão.';
  if (decision === 'COLLECT_FOR_CUSTOMS_RECHECK') {
    return carousel.name
      ? `Retire sua bagagem na esteira ${carousel.name}, passe pelo processo de entrada/alfândega aplicável e faça o novo despacho antes do próximo voo.`
      : 'Você precisa retirar a bagagem nesta conexão para o procedimento de entrada/alfândega e novo despacho. A esteira ainda não foi confirmada.';
  }
  if (decision === 'COLLECT_REQUIRED') {
    return carousel.name
      ? `Retire sua bagagem na esteira ${carousel.name} antes de seguir para a próxima etapa.`
      : 'Você precisa retirar sua bagagem nesta conexão. A esteira ainda não foi confirmada.';
  }
  if (decision === 'THROUGH_CHECKED_DO_NOT_COLLECT') {
    return `Sua bagagem está confirmada como despachada até ${evidence.bagTagDestination || connection.finalDestinationAirport || 'o destino seguinte'}. Não vá à esteira nesta conexão; siga para o próximo voo.`;
  }
  if (decision === 'VERIFY_INTERAIRPORT_TRANSFER') {
    return 'Sua conexão muda de aeroporto e ainda não há confirmação suficiente sobre a bagagem. O Voyage deve verificar o destino da etiqueta/companhia antes de orientar. Até haver confirmação de despacho direto, trate a retirada da bagagem como uma etapa operacional a validar.';
  }
  return 'Ainda não há evidência suficiente para afirmar se a bagagem deve ser retirada. Verifique o destino impresso na etiqueta da bagagem ou a confirmação da companhia aérea.';
}

function buildNextStep(decision, carousel, connection) {
  if (decision === 'NO_CHECKED_BAG' || decision === 'THROUGH_CHECKED_DO_NOT_COLLECT') {
    return {
      type: connection.interAirportTransfer ? 'GROUND_TRANSFER_TO_OTHER_AIRPORT' : 'PROCEED_TO_NEXT_FLIGHT',
      target: connection.departureAirport || connection.nextGate || null
    };
  }
  if (decision === 'COLLECT_REQUIRED' || decision === 'COLLECT_FOR_CUSTOMS_RECHECK') {
    return {
      type: 'GO_TO_BAGGAGE_CLAIM',
      target: carousel.name || 'BAGGAGE_CLAIM',
      then: decision === 'COLLECT_FOR_CUSTOMS_RECHECK' ? 'CUSTOMS_AND_RECHECK' : connection.interAirportTransfer ? 'GROUND_TRANSFER_TO_OTHER_AIRPORT' : 'RECHECK_OR_NEXT_STEP'
    };
  }
  return { type: 'VERIFY_BAGGAGE_HANDLING', target: 'AIRLINE_OR_BAG_TAG' };
}

function buildAlerts(decision, carousel, previousCarousel) {
  const alerts = [];
  if (decision === 'COLLECT_REQUIRED' || decision === 'COLLECT_FOR_CUSTOMS_RECHECK') {
    alerts.push({ type: 'COLLECT_BAG', priority: 'HIGH', carousel: carousel.name || null });
  } else if (decision === 'THROUGH_CHECKED_DO_NOT_COLLECT') {
    alerts.push({ type: 'DO_NOT_COLLECT_BAG', priority: 'HIGH' });
  } else if (decision === 'VERIFY_WITH_AIRLINE' || decision === 'VERIFY_INTERAIRPORT_TRANSFER') {
    alerts.push({ type: 'BAGGAGE_DECISION_UNRESOLVED', priority: 'HIGH' });
  }
  if (carousel.name) alerts.push({ type: 'CAROUSEL_ASSIGNED', priority: 'MEDIUM', carousel: carousel.name });
  const previous = safeString(previousCarousel, 80);
  if (previous && carousel.name && previous !== carousel.name) {
    alerts.push({ type: 'CAROUSEL_CHANGED', priority: 'HIGH', from: previous, to: carousel.name });
  }
  return alerts;
}

function buildIndoorTarget(decision, carousel, connection) {
  if (decision === 'COLLECT_REQUIRED' || decision === 'COLLECT_FOR_CUSTOMS_RECHECK') {
    return {
      poiType: 'BAGGAGE_CLAIM',
      poiId: carousel.poiId || null,
      label: carousel.name || 'Retirada de bagagem',
      airport: connection.arrivalAirport || null
    };
  }
  if (connection.interAirportTransfer) {
    return {
      poiType: 'GROUND_TRANSPORT_EXIT',
      poiId: null,
      label: 'Saída para transporte entre aeroportos',
      airport: connection.arrivalAirport || null
    };
  }
  return {
    poiType: 'NEXT_GATE_OR_SECURITY',
    poiId: null,
    label: 'Próxima etapa da conexão',
    airport: connection.arrivalAirport || null
  };
}

function buildProviderNeeds(decision, carousel, evidence) {
  const needs = new Set();
  if (!carousel.name) needs.add('BAGGAGE_CAROUSEL_STATUS');
  if (!carousel.updatedAt) needs.add('CAROUSEL_FRESHNESS');
  if (decision === 'VERIFY_WITH_AIRLINE' || decision === 'VERIFY_INTERAIRPORT_TRANSFER') needs.add('THROUGH_CHECK_CONFIRMATION');
  if (evidence.customsReclaimRequired === null) needs.add('CUSTOMS_BAGGAGE_RULE_WHEN_RELEVANT');
  return [...needs];
}

function decisionConfidence(decision, evidence, baggage) {
  if (decision === 'NO_CHECKED_BAG' && baggage.source === 'USER') return 'HIGH';
  if (['COLLECT_REQUIRED', 'COLLECT_FOR_CUSTOMS_RECHECK', 'THROUGH_CHECKED_DO_NOT_COLLECT'].includes(decision) && evidence.verified) return 'HIGH';
  if (['VERIFY_WITH_AIRLINE', 'VERIFY_INTERAIRPORT_TRANSFER'].includes(decision)) return 'LOW';
  return 'MEDIUM';
}

function normalizeConnection(input) {
  const arrivalAirport = safeToken(input.arrivalAirport || input.fromAirport || input.inboundAirport);
  const departureAirport = safeToken(input.departureAirport || input.toAirport || input.outboundAirport);
  return {
    arrivalAirport,
    departureAirport,
    interAirportTransfer: Boolean(arrivalAirport && departureAirport && arrivalAirport !== departureAirport),
    nextGate: safeString(input.nextGate, 80),
    finalDestinationAirport: safeToken(input.finalDestinationAirport),
    sameTicket: input.sameTicket === true ? true : input.sameTicket === false ? false : null,
    internationalArrival: input.internationalArrival === true
  };
}

function normalizeBaggage(input) {
  return {
    hasCheckedBag: input.hasCheckedBag === true || Number(input.checkedBagCount) > 0,
    checkedBagCount: Number.isFinite(Number(input.checkedBagCount)) ? Math.max(0, Math.min(20, Math.round(Number(input.checkedBagCount)))) : null,
    source: safeToken(input.baggageSource || input.source) || 'UNKNOWN'
  };
}

function normalizeCarousel(input) {
  return {
    name: safeString(input.carousel || input.baggageCarousel || input.baggageClaim || input.name, 80),
    poiId: safeString(input.poiId || input.carouselPoiId, 160),
    terminal: safeString(input.terminal, 80),
    updatedAt: safeDateTime(input.updatedAt || input.observedAt),
    provider: safeString(input.provider || (input.carousel || input.baggageCarousel ? 'CIRIUM_OR_FLIGHT_STATUS_PROVIDER' : null), 120)
  };
}

function normalizeEvidence(input) {
  return {
    throughChecked: input.throughChecked === true ? true : input.throughChecked === false ? false : null,
    mustCollect: input.mustCollect === true ? true : input.mustCollect === false ? false : null,
    customsReclaimRequired: input.customsReclaimRequired === true ? true : input.customsReclaimRequired === false ? false : null,
    reason: safeToken(input.reason),
    bagTagDestination: safeToken(input.bagTagDestination),
    verified: input.verified === true,
    source: safeToken(input.evidenceSource || input.source)
  };
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function safeToken(value) {
  const text = safeString(value, 100);
  return text ? text.toUpperCase().replace(/[^A-Z0-9_-]+/g, '_') : null;
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
