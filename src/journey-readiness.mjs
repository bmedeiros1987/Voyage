const LEVELS = new Set(['OK', 'INFO', 'WARNING', 'BLOCKER', 'UNKNOWN']);

export function journeyReadinessCapabilities() {
  return {
    version: '1.0',
    dimensions: [
      'TRAVEL_DOCUMENTS',
      'TRANSPORT_CONTINUITY',
      'LODGING_COVERAGE',
      'BUDGET',
      'LOCAL_CASH',
      'BAGGAGE',
      'AIRPORT_CONNECTIONS',
      'WEATHER',
      'OFFLINE_ACCESS',
      'EMERGENCY_READINESS'
    ],
    principles: [
      'Check whether the trip is operationally complete before departure rather than waiting for the user to discover missing pieces during the journey.',
      'Distinguish blockers from warnings so the user knows what truly prevents a safe or feasible journey.',
      'Never assume a missing fact is fine; mark it unknown and request verification when it can affect feasibility.',
      'Do not automatically purchase, book, cancel or mutate the itinerary while resolving readiness issues.',
      'Keep the checklist dynamic: a trip can move from READY to ATTENTION when weather, baggage or connection facts change.'
    ]
  };
}

export function buildJourneyReadiness(input = {}) {
  const checks = [
    checkDocuments(input.documents || {}),
    checkTransport(input.transport || {}),
    checkLodging(input.lodging || {}),
    checkBudget(input.budget || {}),
    checkLocalCash(input.localCash || input.budget?.localCash || {}),
    checkBaggage(input.baggage || {}),
    checkConnections(input.airportConnections || input.connections || {}),
    checkWeather(input.weather || {}),
    checkOffline(input.offline || {}),
    checkEmergency(input.emergency || {})
  ];

  const blockers = checks.filter((check) => check.level === 'BLOCKER');
  const warnings = checks.filter((check) => check.level === 'WARNING' || check.level === 'UNKNOWN');
  const score = calculateScore(checks);
  const actions = checks
    .filter((check) => check.action)
    .sort((a, b) => priorityRank(a.level) - priorityRank(b.level))
    .map((check) => ({ dimension: check.dimension, level: check.level, action: check.action, reason: check.summary }));

  return {
    version: '1.0',
    status: blockers.length ? 'BLOCKED' : warnings.length ? 'ATTENTION' : 'READY',
    score,
    checks,
    blockers: blockers.map((check) => check.dimension),
    warnings: warnings.map((check) => check.dimension),
    nextActions: actions,
    automaticChangesAllowed: false,
    userApprovalRequiredForItineraryMutation: true
  };
}

function checkDocuments(input) {
  if (input.required === false) return result('TRAVEL_DOCUMENTS', 'OK', 'Nenhum documento adicional foi informado como necessário.');
  if (input.valid === false || input.missingRequired === true) return result('TRAVEL_DOCUMENTS', 'BLOCKER', 'Há documento obrigatório ausente ou inválido.', 'VERIFY_OR_OBTAIN_REQUIRED_TRAVEL_DOCUMENT');
  if (input.valid === true) return result('TRAVEL_DOCUMENTS', 'OK', 'Documentação necessária informada como válida.');
  return result('TRAVEL_DOCUMENTS', 'UNKNOWN', 'Validade da documentação ainda não foi confirmada.', 'VERIFY_TRAVEL_DOCUMENTS');
}

function checkTransport(input) {
  if (input.continuityComplete === false || input.unresolvedRequiredSegments > 0) return result('TRANSPORT_CONTINUITY', 'BLOCKER', 'Há deslocamento obrigatório sem solução entre etapas da viagem.', 'RESOLVE_MISSING_TRANSPORT_SEGMENT');
  if (input.continuityComplete === true) return result('TRANSPORT_CONTINUITY', 'OK', 'Deslocamentos obrigatórios estão conectados do início ao fim.');
  return result('TRANSPORT_CONTINUITY', 'UNKNOWN', 'A continuidade completa dos deslocamentos ainda não foi verificada.', 'VERIFY_END_TO_END_TRANSPORT');
}

function checkLodging(input) {
  if (input.required === false) return result('LODGING_COVERAGE', 'OK', 'A viagem não exige pernoite.');
  if (input.uncoveredNights > 0) return result('LODGING_COVERAGE', 'BLOCKER', 'Há pelo menos uma noite sem hospedagem confirmada ou alternativa validada.', 'RESOLVE_UNCOVERED_NIGHTS');
  if (input.allNightsCovered === true) return result('LODGING_COVERAGE', 'OK', 'Todas as noites possuem base de hospedagem definida.');
  return result('LODGING_COVERAGE', 'UNKNOWN', 'Cobertura de hospedagem ainda não foi confirmada para todas as noites.', 'VERIFY_LODGING_COVERAGE');
}

function checkBudget(input) {
  if (input.overBudget === true || input.remainingAmount < 0) return result('BUDGET', 'WARNING', 'O planejamento está acima do orçamento informado.', 'REVIEW_BUDGET_WITH_USER');
  if (input.configured === true && Number.isFinite(Number(input.remainingAmount))) return result('BUDGET', 'OK', 'Orçamento configurado e com saldo não negativo.');
  if (input.configured === true) return result('BUDGET', 'INFO', 'Orçamento configurado; saldo depende de custos ainda não conhecidos.');
  return result('BUDGET', 'WARNING', 'O usuário ainda não definiu o orçamento da viagem.', 'ASK_USER_FOR_TRIP_BUDGET');
}

function checkLocalCash(input) {
  if (input.required === false) return result('LOCAL_CASH', 'OK', 'Não há necessidade conhecida de reserva em moeda local.');
  if (input.cashOnlyShortfall > 0) return result('LOCAL_CASH', 'WARNING', 'O dinheiro disponível não cobre despesas conhecidas que exigem espécie e a reserva desejada.', 'PLAN_LOCAL_CASH_TOP_UP');
  if (input.localCurrencyAvailable === true && input.emergencyReserveCovered !== false) return result('LOCAL_CASH', 'OK', 'Há moeda local informada para contingências.');
  if (input.internationalTrip === true) return result('LOCAL_CASH', 'WARNING', 'Nenhuma reserva em moeda local foi confirmada para a viagem internacional.', 'ASK_USER_TO_DEFINE_LOCAL_CASH_RESERVE');
  return result('LOCAL_CASH', 'INFO', 'Reserva em espécie não foi informada.');
}

function checkBaggage(input) {
  if (input.checkedBag === false) return result('BAGGAGE', 'OK', 'Não há bagagem despachada informada.');
  if (input.checkedBag === true && input.connectionRequiresDecision === true && input.pickupRuleKnown !== true) return result('BAGGAGE', 'WARNING', 'A regra de retirada da bagagem em uma conexão ainda não foi confirmada.', 'VERIFY_BAGGAGE_PICKUP_RULE');
  if (input.checkedBag === true && input.pickupRuleKnown === true) return result('BAGGAGE', 'OK', 'Regra de bagagem para a conexão está definida.');
  return result('BAGGAGE', 'INFO', 'Nenhum risco de bagagem pendente foi identificado com os dados atuais.');
}

function checkConnections(input) {
  if (input.interAirportRequired === true && input.transferResolved !== true) return result('AIRPORT_CONNECTIONS', 'BLOCKER', 'Existe conexão entre aeroportos sem deslocamento resolvido.', 'RESOLVE_INTER_AIRPORT_CONNECTION');
  if (input.connectionRisk === 'HIGH' || input.feasible === false) return result('AIRPORT_CONNECTIONS', 'WARNING', 'Há conexão com margem de tempo crítica ou inviável.', 'REVIEW_CONNECTION_AND_ALTERNATIVES');
  if (input.interAirportRequired === true && input.transferResolved === true) return result('AIRPORT_CONNECTIONS', 'OK', 'Transferência entre aeroportos está resolvida.');
  return result('AIRPORT_CONNECTIONS', 'INFO', 'Nenhuma pendência crítica de conexão entre aeroportos foi informada.');
}

function checkWeather(input) {
  if (input.severeAlert === true) return result('WEATHER', 'WARNING', 'Há alerta meteorológico relevante para a viagem.', 'SHOW_WEATHER_IMPACT_AND_PROPOSE_OPTIONS');
  if (input.forecastFresh === false) return result('WEATHER', 'UNKNOWN', 'A previsão meteorológica disponível está desatualizada.', 'REFRESH_WEATHER');
  if (input.forecastFresh === true) return result('WEATHER', 'OK', 'Meteorologia atualizada para o planejamento.');
  return result('WEATHER', 'INFO', 'Meteorologia ainda não é necessária ou não foi consultada.');
}

function checkOffline(input) {
  if (input.tripPackCached === true && input.criticalMapsCached !== false) return result('OFFLINE_ACCESS', 'OK', 'Informações críticas da viagem estão disponíveis offline.');
  if (input.departureWithinHours !== undefined && Number(input.departureWithinHours) <= 24) return result('OFFLINE_ACCESS', 'WARNING', 'A viagem está próxima e o pacote offline ainda não foi confirmado.', 'CACHE_CRITICAL_TRIP_DATA');
  return result('OFFLINE_ACCESS', 'INFO', 'Pacote offline ainda pode ser preparado antes da viagem.');
}

function checkEmergency(input) {
  if (input.emergencyContactsConfigured === true && input.insuranceRequired === true && input.insuranceKnown !== true) return result('EMERGENCY_READINESS', 'WARNING', 'Contatos estão configurados, mas a cobertura de seguro necessária ainda não foi confirmada.', 'VERIFY_INSURANCE_COVERAGE');
  if (input.emergencyContactsConfigured === true) return result('EMERGENCY_READINESS', 'OK', 'Contatos de emergência estão configurados.');
  return result('EMERGENCY_READINESS', 'INFO', 'Contatos de emergência ainda não foram configurados.', 'OFFER_EMERGENCY_CONTACT_SETUP');
}

function result(dimension, level, summary, action = null) {
  return { dimension, level: LEVELS.has(level) ? level : 'UNKNOWN', summary, action };
}

function calculateScore(checks) {
  const weights = { OK: 10, INFO: 8, WARNING: 5, UNKNOWN: 4, BLOCKER: 0 };
  if (!checks.length) return 0;
  const total = checks.reduce((sum, check) => sum + weights[check.level], 0);
  return Math.round((total / (checks.length * 10)) * 100);
}

function priorityRank(level) {
  return level === 'BLOCKER' ? 0 : level === 'WARNING' ? 1 : level === 'UNKNOWN' ? 2 : level === 'INFO' ? 3 : 4;
}
