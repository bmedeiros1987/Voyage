const USER_TYPES = new Set(['PASSENGER', 'CREW_MEMBER']);
const PRIORITIES = new Set(['BALANCED', 'MAX_TIME', 'LOWEST_PRICE', 'COMFORT']);

export function normalizeAvailabilityInput(input = {}) {
  const userType = USER_TYPES.has(input.userType) ? input.userType : 'PASSENGER';
  const desiredDays = clampInteger(input.desiredDays, 1, 60, 3);
  const maxDays = clampInteger(input.maxDays, desiredDays, 90, desiredDays);
  const optimizationPriority = PRIORITIES.has(input.optimizationPriority)
    ? input.optimizationPriority
    : 'BALANCED';
  const minimumReturnMarginHours = clampInteger(input.minimumReturnMarginHours, 0, 72, userType === 'CREW_MEMBER' ? 12 : 0);

  return {
    userType,
    desiredDays,
    maxDays,
    optimizationPriority,
    minimumReturnMarginHours,
    crewcheckLinked: userType === 'CREW_MEMBER' && Boolean(input.crewcheckLinked),
    useOfficialDaysOffOnly: userType === 'CREW_MEMBER' ? input.useOfficialDaysOffOnly !== false : false
  };
}

export function buildAvailabilitySummary(input = {}) {
  const profile = normalizeAvailabilityInput(input);

  if (profile.userType === 'CREW_MEMBER') {
    return {
      ...profile,
      requiresDesiredDaysConfirmation: true,
      scheduleSource: profile.crewcheckLinked ? 'CREWCHECK_API' : 'MANUAL',
      message: profile.crewcheckLinked
        ? `Vamos cruzar sua escala com a preferência de ${profile.desiredDays} dia(s), sem presumir que toda folga será usada.`
        : `Informe sua disponibilidade e quantos dos ${profile.desiredDays} dia(s) desejados você quer realmente usar.`
    };
  }

  return {
    ...profile,
    requiresDesiredDaysConfirmation: true,
    scheduleSource: 'USER_INPUT',
    message: `Vamos buscar janelas de ${profile.desiredDays} dia(s), respeitando seu máximo de ${profile.maxDays}.`
  };
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
