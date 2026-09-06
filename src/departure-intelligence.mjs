const DEPARTURE_STATUS = new Set(['NEEDS_DATA', 'WATCHING', 'LEAVE_SOON', 'LEAVE_NOW', 'AT_RISK', 'LATE', 'ARRIVED']);

export function departureIntelligenceCapabilities() {
  return {
    version: '1.0',
    statuses: [...DEPARTURE_STATUS],
    principles: [
      'Any commitment with a fixed start time and destination may have a calculated leave time.',
      'Use provider-backed current travel time when available; never invent traffic conditions.',
      'Recalculate the recommended leave time when traffic materially changes.',
      'Warn earlier when traffic consumes the user safety buffer.',
      'Account for arrival buffer, parking, walking, venue entry/security and user contingency separately.',
      'A leave-time alert does not modify the itinerary; itinerary changes still require explicit user approval.',
      'Prefer progressive alerts over a single alarm so the user has time to react.'
    ],
    defaultPolicy: {
      arrivalBufferMinutes: 10,
      contingencyMinutes: 10,
      leaveSoonWindowMinutes: 15,
      materialTrafficIncreaseMinutes: 5,
      materialTrafficIncreaseRatio: 0.2,
      routeFreshnessMinutes: 10
    },
    escalation: ['WATCHING', 'LEAVE_SOON', 'LEAVE_NOW', 'AT_RISK', 'LATE']
  };
}

export function buildDepartureDecision(input = {}) {
  const commitment = normalizeCommitment(input.commitment || input.event || {});
  const now = safeDateTime(input.now) || new Date().toISOString();
  const route = normalizeRoute(input.route || {});
  const buffers = normalizeBuffers(input.buffers || {});
  const userState = safeToken(input.userState || 'NOT_ARRIVED');

  if (userState === 'ARRIVED') {
    return {
      status: 'ARRIVED',
      commitment,
      route,
      buffers,
      recommendedLeaveAt: null,
      latestSafeLeaveAt: null,
      minutesUntilRecommendedLeave: null,
      notification: null,
      requiresRouteRefresh: false
    };
  }

  if (!commitment.startsAt || !commitment.destinationId || route.currentTravelMinutes === null) {
    return {
      status: 'NEEDS_DATA',
      commitment,
      route,
      buffers,
      missing: [
        !commitment.startsAt ? 'COMMITMENT_START_TIME' : null,
        !commitment.destinationId ? 'DESTINATION' : null,
        route.currentTravelMinutes === null ? 'CURRENT_TRAVEL_TIME' : null
      ].filter(Boolean),
      requiresRouteRefresh: route.currentTravelMinutes === null,
      notification: null
    };
  }

  const startsAtMs = Date.parse(commitment.startsAt);
  const nowMs = Date.parse(now);
  const nonContingencyMinutes = route.currentTravelMinutes + buffers.arrivalBufferMinutes + buffers.parkingMinutes + buffers.walkingMinutes + buffers.entryMinutes;
  const totalRequiredMinutes = nonContingencyMinutes + buffers.contingencyMinutes;
  const recommendedLeaveAt = new Date(startsAtMs - totalRequiredMinutes * 60_000).toISOString();
  const latestSafeLeaveAt = new Date(startsAtMs - nonContingencyMinutes * 60_000).toISOString();
  const minutesUntilRecommendedLeave = Math.floor((Date.parse(recommendedLeaveAt) - nowMs) / 60_000);
  const minutesUntilLatestSafeLeave = Math.floor((Date.parse(latestSafeLeaveAt) - nowMs) / 60_000);
  const minutesUntilCommitment = Math.floor((startsAtMs - nowMs) / 60_000);

  let status = 'WATCHING';
  if (minutesUntilCommitment <= 0) status = 'LATE';
  else if (minutesUntilLatestSafeLeave < 0) status = 'AT_RISK';
  else if (minutesUntilRecommendedLeave <= 0) status = 'LEAVE_NOW';
  else if (minutesUntilRecommendedLeave <= buffers.leaveSoonWindowMinutes) status = 'LEAVE_SOON';

  const traffic = assessTraffic(route, buffers);
  const requiresRouteRefresh = route.updatedAt ? ageMinutes(route.updatedAt, now) > buffers.routeFreshnessMinutes : true;

  return {
    status: DEPARTURE_STATUS.has(status) ? status : 'WATCHING',
    commitment,
    route,
    traffic,
    buffers,
    recommendedLeaveAt,
    latestSafeLeaveAt,
    minutesUntilRecommendedLeave,
    minutesUntilLatestSafeLeave,
    minutesUntilCommitment,
    requiresRouteRefresh,
    notification: buildNotification({ status, commitment, route, traffic, recommendedLeaveAt, minutesUntilRecommendedLeave, minutesUntilLatestSafeLeave })
  };
}

export function buildTrafficChangeAlert(input = {}) {
  const previous = optionalMinutes(input.previousTravelMinutes ?? input.previousRoute?.currentTravelMinutes);
  const current = optionalMinutes(input.currentTravelMinutes ?? input.currentRoute?.currentTravelMinutes);
  const thresholdMinutes = clampInteger(input.materialIncreaseMinutes, 1, 60, 5);
  const thresholdRatio = clampNumber(input.materialIncreaseRatio, 0.05, 2, 0.2);

  if (previous === null || current === null) {
    return { material: false, direction: 'UNKNOWN', deltaMinutes: null, deltaRatio: null, alert: null };
  }

  const deltaMinutes = current - previous;
  const deltaRatio = previous > 0 ? deltaMinutes / previous : 0;
  const materialIncrease = deltaMinutes >= thresholdMinutes || deltaRatio >= thresholdRatio;
  const materialDecrease = deltaMinutes <= -thresholdMinutes || deltaRatio <= -thresholdRatio;
  const direction = materialIncrease ? 'WORSE' : materialDecrease ? 'BETTER' : 'STABLE';

  return {
    material: materialIncrease || materialDecrease,
    direction,
    deltaMinutes,
    deltaRatio: Number(deltaRatio.toFixed(3)),
    alert: materialIncrease
      ? `TRAFFIC_TIGHTER_BY_${Math.max(1, Math.round(deltaMinutes))}_MIN`
      : materialDecrease
        ? `TRAFFIC_IMPROVED_BY_${Math.max(1, Math.round(Math.abs(deltaMinutes)))}_MIN`
        : null
  };
}

export function buildDepartureWatchContract(input = {}) {
  const commitment = normalizeCommitment(input.commitment || {});
  return {
    commitmentId: commitment.id,
    enabled: Boolean(commitment.startsAt && commitment.destinationId),
    checks: ['CURRENT_LOCATION', 'CURRENT_TRAVEL_TIME', 'TRAFFIC_DELTA', 'BUFFER_EROSION'],
    notifyOn: ['LEAVE_SOON', 'LEAVE_NOW', 'AT_RISK', 'MATERIAL_TRAFFIC_INCREASE'],
    itineraryMutationAllowed: false,
    userApprovalRequiredForItineraryChanges: true,
    routeProviderRequired: true,
    rule: 'Recalculate leave time as traffic changes; notify the user, but never alter itinerary items without explicit approval.'
  };
}

function assessTraffic(route, buffers) {
  const baseline = route.baselineTravelMinutes;
  const current = route.currentTravelMinutes;
  if (current === null) return { state: 'UNKNOWN', delayMinutes: null, ratio: null, material: false };
  if (baseline === null || baseline <= 0) return { state: 'CURRENT_ONLY', delayMinutes: null, ratio: null, material: false };
  const delayMinutes = current - baseline;
  const ratio = delayMinutes / baseline;
  const material = delayMinutes >= buffers.materialTrafficIncreaseMinutes || ratio >= buffers.materialTrafficIncreaseRatio;
  return {
    state: material ? 'TIGHTER' : delayMinutes > 0 ? 'SLOWER' : delayMinutes < 0 ? 'BETTER' : 'NORMAL',
    delayMinutes,
    ratio: Number(ratio.toFixed(3)),
    material
  };
}

function buildNotification({ status, commitment, route, traffic, recommendedLeaveAt, minutesUntilRecommendedLeave, minutesUntilLatestSafeLeave }) {
  const title = commitment.title || 'Compromisso';
  if (status === 'LATE') return { priority: 'CRITICAL', code: 'COMMITMENT_TIME_REACHED', message: `O horário de ${title} já chegou.` };
  if (status === 'AT_RISK') return { priority: 'CRITICAL', code: 'ARRIVAL_AT_RISK', message: `Saia agora. Com o deslocamento atual, a margem para ${title} já está comprometida.` };
  if (status === 'LEAVE_NOW') return { priority: 'HIGH', code: 'LEAVE_NOW', message: `Hora de sair para ${title}. Deslocamento estimado: ${route.currentTravelMinutes} min.` };
  if (status === 'LEAVE_SOON') {
    const trafficText = traffic.material ? ` O trânsito apertou${traffic.delayMinutes > 0 ? ` em cerca de ${Math.round(traffic.delayMinutes)} min` : ''}.` : '';
    return { priority: traffic.material ? 'HIGH' : 'NORMAL', code: traffic.material ? 'TRAFFIC_TIGHTER_LEAVE_SOON' : 'LEAVE_SOON', message: `Saída recomendada em ${Math.max(0, minutesUntilRecommendedLeave)} min para ${title}.${trafficText}` };
  }
  if (traffic.material) return { priority: 'NORMAL', code: 'TRAFFIC_TIGHTER', message: `O trânsito para ${title} piorou. Novo horário recomendado de saída: ${recommendedLeaveAt}.` };
  if (minutesUntilLatestSafeLeave <= 15) return { priority: 'NORMAL', code: 'BUFFER_SHRINKING', message: `A margem de chegada para ${title} está diminuindo.` };
  return null;
}

function normalizeCommitment(input) {
  return {
    id: safeString(input.id, 160),
    title: safeString(input.title, 220) || 'Compromisso',
    startsAt: safeDateTime(input.startsAt),
    destinationId: safeString(input.destinationId || input.locationId, 220),
    destinationLabel: safeString(input.destinationLabel || input.location, 300),
    source: safeToken(input.source || 'USER'),
    locked: input.locked !== false
  };
}

function normalizeRoute(input) {
  return {
    originId: safeString(input.originId, 220),
    destinationId: safeString(input.destinationId, 220),
    currentTravelMinutes: optionalMinutes(input.currentTravelMinutes ?? input.durationInTrafficMinutes ?? input.durationMinutes),
    baselineTravelMinutes: optionalMinutes(input.baselineTravelMinutes ?? input.normalTravelMinutes),
    mode: safeToken(input.mode || 'DRIVING'),
    provider: safeString(input.provider, 120),
    updatedAt: safeDateTime(input.updatedAt),
    distanceKm: optionalNumber(input.distanceKm, 0, 100000)
  };
}

function normalizeBuffers(input) {
  return {
    arrivalBufferMinutes: clampInteger(input.arrivalBufferMinutes, 0, 180, 10),
    contingencyMinutes: clampInteger(input.contingencyMinutes, 0, 180, 10),
    parkingMinutes: clampInteger(input.parkingMinutes, 0, 180, 0),
    walkingMinutes: clampInteger(input.walkingMinutes, 0, 180, 0),
    entryMinutes: clampInteger(input.entryMinutes ?? input.securityMinutes, 0, 240, 0),
    leaveSoonWindowMinutes: clampInteger(input.leaveSoonWindowMinutes, 1, 120, 15),
    materialTrafficIncreaseMinutes: clampInteger(input.materialTrafficIncreaseMinutes, 1, 60, 5),
    materialTrafficIncreaseRatio: clampNumber(input.materialTrafficIncreaseRatio, 0.05, 2, 0.2),
    routeFreshnessMinutes: clampInteger(input.routeFreshnessMinutes, 1, 120, 10)
  };
}

function ageMinutes(iso, nowIso) {
  const age = Date.parse(nowIso) - Date.parse(iso);
  return Number.isFinite(age) ? Math.max(0, Math.floor(age / 60_000)) : Number.POSITIVE_INFINITY;
}

function optionalMinutes(value) {
  return optionalNumber(value, 0, 1440);
}

function optionalNumber(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(max, Math.max(min, parsed)));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const string = String(value).trim();
  return string ? string.slice(0, max) : null;
}

function safeToken(value) {
  const token = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return token || null;
}
