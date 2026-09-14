const CLASSIFICATIONS = new Set([
  'ENTRY_REQUIRED',
  'ENTRY_CONDITIONAL',
  'RECOMMENDED',
  'ROUTINE',
  'OUTBREAK_ADVISORY'
]);

const STATUS_RANK = {
  ENTRY_BLOCKER: 0,
  CLINICIAN_REVIEW: 1,
  ACTION_NEEDED: 2,
  VERIFY_RULE: 3,
  COMPLETE: 4,
  INFO: 5
};

const YELLOW_FEVER = Object.freeze({
  vaccine: 'YELLOW_FEVER',
  certificateType: 'ICVP',
  primaryDoseValidAfterDays: 10,
  certificateValidity: 'LIFETIME',
  ruleBasis: 'IHR'
});

export function travelHealthIntelligenceCapabilities() {
  return {
    version: '1.0',
    purpose: 'Warn travellers about destination- and route-specific vaccine requirements and recommendations before departure, while separating legal entry rules from clinical advice.',
    routeAware: true,
    checks: [
      'FINAL_DESTINATION',
      'INTERMEDIATE_DESTINATIONS',
      'TRANSIT_AND_LAYOVER',
      'COUNTRY_OF_ORIGIN_OR_RECENT_PRESENCE_WHEN_RULE_REQUIRES_IT',
      'ENTRY_CERTIFICATE',
      'VACCINE_VALIDITY_BY_ARRIVAL_DATE',
      'RECOMMENDED_TRAVEL_VACCINES',
      'ROUTINE_VACCINE_REVIEW'
    ],
    classifications: [...CLASSIFICATIONS],
    authoritativeSourcePreference: [
      'WHO_IHR_OR_INTERNATIONAL_TRAVEL_HEALTH',
      'DESTINATION_NATIONAL_HEALTH_OR_BORDER_AUTHORITY',
      'EMBASSY_OR_CONSULATE',
      'CDC_TRAVELERS_HEALTH_FOR_HEALTH_RECOMMENDATIONS'
    ],
    yellowFever: YELLOW_FEVER,
    policies: [
      'Entry requirements and health recommendations are different and must be labelled separately.',
      'Country rules can depend on the full itinerary, including transit and the countries visited before arrival.',
      'Never infer that a traveller is medically eligible for a vaccine; contraindications and precautions require a clinician or authorized vaccination service.',
      'If a mandatory rule is uncertain or stale, verify the rule instead of telling the traveller they are cleared.',
      'For yellow fever, a primary ICVP becomes valid 10 days after vaccination and is treated as lifetime-valid under the IHR when properly issued.',
      'Store only the minimum proof needed for travel readiness; do not build a general medical record without explicit user choice.'
    ],
    itineraryMutationAllowedAutomatically: false,
    medicalTreatmentDecisionAllowedAutomatically: false
  };
}

export function buildTravelHealthPlan(input = {}) {
  const itinerary = normalizeItinerary(input.itinerary || input.trip || []);
  const records = normalizeRecords(input.vaccinationRecords || input.vaccines || []);
  const requirements = normalizeRequirements(input.requirements || input.rules || []);
  const today = safeDate(input.now) || new Date();

  const evaluated = requirements
    .map((requirement) => evaluateRequirement(requirement, { itinerary, records, today, traveller: input.traveller || {} }))
    .filter(Boolean)
    .sort((a, b) => (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99));

  const entryBlockers = evaluated.filter((item) => item.status === 'ENTRY_BLOCKER');
  const clinicianReview = evaluated.filter((item) => item.status === 'CLINICIAN_REVIEW');
  const actionNeeded = evaluated.filter((item) => item.status === 'ACTION_NEEDED');
  const verifyRules = evaluated.filter((item) => item.status === 'VERIFY_RULE');
  const recommendations = evaluated.filter((item) => ['RECOMMENDED', 'ROUTINE', 'OUTBREAK_ADVISORY'].includes(item.classification));

  const itineraryHasInternationalCountry = new Set(itinerary.map((stop) => stop.countryCode).filter(Boolean)).size > 0;
  const rulesCoverageKnown = input.rulesCoverageKnown === true;
  const status = entryBlockers.length
    ? 'BLOCKED'
    : clinicianReview.length || actionNeeded.length || verifyRules.length
      ? 'ATTENTION'
      : requirements.length || rulesCoverageKnown
        ? 'READY'
        : itineraryHasInternationalCountry
          ? 'NEEDS_RULE_DATA'
          : 'INFO';

  return {
    version: '1.0',
    status,
    generatedAt: today.toISOString(),
    itineraryCountries: [...new Set(itinerary.map((stop) => stop.countryCode).filter(Boolean))],
    requirements: evaluated,
    entryBlockers: entryBlockers.map(compactAction),
    clinicianReview: clinicianReview.map(compactAction),
    recommendations: recommendations.map(compactAction),
    nextActions: evaluated
      .filter((item) => item.action)
      .map(compactAction),
    alerts: buildAlerts(evaluated, { rulesCoverageKnown, itineraryHasInternationalCountry }),
    readiness: {
      evaluated: requirements.length > 0 || rulesCoverageKnown,
      entryRequirementsSatisfied: entryBlockers.length === 0 && verifyRules.filter((item) => item.isEntryRule).length === 0,
      requiredMissing: entryBlockers.length,
      recommendationsOutstanding: actionNeeded.filter((item) => !item.isEntryRule).length,
      clinicianReviewRequired: clinicianReview.length > 0,
      ruleVerificationRequired: verifyRules.length > 0
    },
    privacy: {
      minimumNecessaryTravelProofOnly: true,
      fullMedicalRecordRequired: false,
      userHealthProfileOptional: true
    },
    policy: {
      informationalTravelHealthSupport: true,
      clinicianDeterminesMedicalEligibility: true,
      itineraryMutationAllowedAutomatically: false,
      medicalTreatmentDecisionAllowedAutomatically: false
    }
  };
}

function evaluateRequirement(requirement, context) {
  if (requirement.conditionStatus === 'NOT_APPLICABLE') return null;

  const arrival = firstApplicableArrival(context.itinerary, requirement);
  const isEntryRule = ['ENTRY_REQUIRED', 'ENTRY_CONDITIONAL'].includes(requirement.classification);

  if (isEntryRule && requirement.sourceFresh !== true) {
    return output(requirement, {
      status: 'VERIFY_RULE',
      isEntryRule,
      arrival,
      summary: `Confirme a exigência atual de ${displayVaccine(requirement.vaccine)} antes da viagem.`,
      action: 'VERIFY_AUTHORITATIVE_ENTRY_VACCINE_RULE'
    });
  }

  if (requirement.classification === 'ENTRY_CONDITIONAL' && requirement.conditionStatus !== 'APPLIES') {
    return output(requirement, {
      status: 'VERIFY_RULE',
      isEntryRule: true,
      arrival,
      summary: `A exigência de ${displayVaccine(requirement.vaccine)} depende do seu itinerário anterior ou da conexão e ainda precisa ser confirmada.`,
      action: 'RESOLVE_CONDITIONAL_ENTRY_VACCINE_RULE'
    });
  }

  const record = bestRecord(context.records, requirement.vaccine);
  const certificateRequired = Boolean(requirement.certificateType);
  const needsClinicalReview = requirement.clinicianReviewRequired === true
    || requirement.medicalEligibilityKnown === false
    || context.traveller?.medicalEligibilityKnown === false;

  if (!record) {
    if (needsClinicalReview) {
      return output(requirement, {
        status: 'CLINICIAN_REVIEW',
        isEntryRule,
        arrival,
        summary: isEntryRule
          ? `${displayVaccine(requirement.vaccine)} pode ser exigida para entrada, mas a elegibilidade médica precisa ser avaliada antes de qualquer vacinação.`
          : `Converse com um profissional de saúde sobre ${displayVaccine(requirement.vaccine)} antes da viagem.`,
        action: isEntryRule ? 'SEEK_TRAVEL_HEALTH_CLINIC_OR_MEDICAL_WAIVER_GUIDANCE' : 'SEEK_TRAVEL_HEALTH_CLINIC_GUIDANCE'
      });
    }
    return output(requirement, {
      status: isEntryRule ? 'ENTRY_BLOCKER' : 'ACTION_NEEDED',
      isEntryRule,
      arrival,
      summary: isEntryRule
        ? `${displayVaccine(requirement.vaccine)} consta como exigência de entrada e não há comprovante válido informado.`
        : `${displayVaccine(requirement.vaccine)} está recomendada para esta viagem e não consta como realizada.`,
      action: isEntryRule ? 'OBTAIN_OR_VERIFY_REQUIRED_VACCINE_AND_CERTIFICATE' : 'REVIEW_RECOMMENDED_VACCINE_WITH_HEALTH_SERVICE'
    });
  }

  const validFromDays = requirement.validFromDaysAfter ?? (requirement.vaccine === 'YELLOW_FEVER' ? 10 : 0);
  const validFrom = addDays(record.administeredAt, validFromDays);
  if (arrival && validFrom && validFrom > arrival) {
    return output(requirement, {
      status: isEntryRule ? 'ENTRY_BLOCKER' : 'ACTION_NEEDED',
      isEntryRule,
      arrival,
      validFrom,
      summary: isEntryRule
        ? `${displayVaccine(requirement.vaccine)} foi registrada, mas o comprovante ainda não estará válido na data de entrada.`
        : `${displayVaccine(requirement.vaccine)} foi registrada muito perto da viagem para a antecedência informada nesta regra.`,
      action: isEntryRule ? 'REVIEW_ENTRY_TIMING_WITH_AUTHORIZED_HEALTH_SERVICE' : 'REVIEW_VACCINE_TIMING_WITH_HEALTH_SERVICE'
    });
  }

  if (requirement.validUntil && arrival && arrival > requirement.validUntil) {
    return output(requirement, {
      status: isEntryRule ? 'ENTRY_BLOCKER' : 'ACTION_NEEDED',
      isEntryRule,
      arrival,
      summary: `O comprovante informado de ${displayVaccine(requirement.vaccine)} não cobre a data da viagem segundo a regra fornecida.`,
      action: 'VERIFY_VACCINE_VALIDITY_FOR_TRAVEL_DATE'
    });
  }

  if (certificateRequired && (!record.certificatePresent || (record.certificateType && record.certificateType !== requirement.certificateType))) {
    return output(requirement, {
      status: isEntryRule ? 'ENTRY_BLOCKER' : 'ACTION_NEEDED',
      isEntryRule,
      arrival,
      summary: `${displayVaccine(requirement.vaccine)} consta como realizada, mas falta o comprovante ${requirement.certificateType} exigido para esta regra.`,
      action: requirement.certificateType === 'ICVP' ? 'OBTAIN_OR_LOCATE_ICVP' : 'OBTAIN_REQUIRED_VACCINATION_CERTIFICATE'
    });
  }

  if (needsClinicalReview && !record.medicalEligibilityConfirmed) {
    return output(requirement, {
      status: 'CLINICIAN_REVIEW',
      isEntryRule,
      arrival,
      summary: `O registro de ${displayVaccine(requirement.vaccine)} existe, mas há indicação de revisão clínica antes de considerar a orientação concluída.`,
      action: 'SEEK_TRAVEL_HEALTH_CLINIC_GUIDANCE'
    });
  }

  return output(requirement, {
    status: 'COMPLETE',
    isEntryRule,
    arrival,
    validFrom,
    summary: isEntryRule
      ? `${displayVaccine(requirement.vaccine)} e o comprovante necessário estão compatíveis com a regra informada.`
      : `${displayVaccine(requirement.vaccine)} consta como atendida para esta recomendação.`,
    action: null
  });
}

function output(requirement, extra) {
  return {
    id: requirement.id,
    vaccine: requirement.vaccine,
    vaccineLabel: displayVaccine(requirement.vaccine),
    classification: requirement.classification,
    countryCode: requirement.countryCode,
    appliesToTransit: requirement.appliesToTransit,
    isEntryRule: Boolean(extra.isEntryRule),
    status: extra.status,
    summary: extra.summary,
    action: extra.action,
    arrivalDate: extra.arrival ? extra.arrival.toISOString().slice(0, 10) : null,
    validFrom: extra.validFrom ? extra.validFrom.toISOString().slice(0, 10) : null,
    certificateType: requirement.certificateType,
    source: requirement.source
  };
}

function buildAlerts(items, context) {
  const alerts = [];
  for (const item of items) {
    if (item.status === 'ENTRY_BLOCKER') alerts.push({ type: 'TRAVEL_VACCINE_ENTRY_BLOCKER', priority: 'CRITICAL', vaccine: item.vaccine, countryCode: item.countryCode, action: item.action });
    else if (item.status === 'CLINICIAN_REVIEW') alerts.push({ type: 'TRAVEL_VACCINE_CLINICIAN_REVIEW', priority: item.isEntryRule ? 'HIGH' : 'MEDIUM', vaccine: item.vaccine, countryCode: item.countryCode, action: item.action });
    else if (item.status === 'ACTION_NEEDED') alerts.push({ type: 'TRAVEL_VACCINE_ACTION_NEEDED', priority: item.isEntryRule ? 'HIGH' : 'MEDIUM', vaccine: item.vaccine, countryCode: item.countryCode, action: item.action });
    else if (item.status === 'VERIFY_RULE') alerts.push({ type: 'TRAVEL_VACCINE_RULE_VERIFY', priority: item.isEntryRule ? 'HIGH' : 'MEDIUM', vaccine: item.vaccine, countryCode: item.countryCode, action: item.action });
  }
  if (!items.length && context.itineraryHasInternationalCountry && !context.rulesCoverageKnown) {
    alerts.push({ type: 'TRAVEL_HEALTH_RULE_DATA_REQUIRED', priority: 'HIGH', action: 'LOAD_AUTHORITATIVE_DESTINATION_HEALTH_RULES' });
  }
  return alerts;
}

function normalizeRequirements(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 200).map((item, index) => {
    const vaccine = token(item.vaccine || item.code || item.name);
    const classification = token(item.classification || item.type || 'RECOMMENDED');
    const countryCode = country(item.countryCode || item.destinationCountry || item.country);
    if (!vaccine || !CLASSIFICATIONS.has(classification)) return null;
    const validUntil = safeDate(item.validUntil || item.expiresAt);
    return {
      id: String(item.id || `health-rule-${index + 1}`).slice(0, 120),
      vaccine,
      classification,
      countryCode,
      conditionStatus: normalizeConditionStatus(item.conditionStatus, item.applies),
      appliesToTransit: item.appliesToTransit === true,
      validFromDaysAfter: finiteNonNegative(item.validFromDaysAfter),
      validUntil,
      certificateType: token(item.certificateType || item.certificate || (vaccine === 'YELLOW_FEVER' && ['ENTRY_REQUIRED', 'ENTRY_CONDITIONAL'].includes(classification) ? 'ICVP' : null)),
      sourceFresh: item.sourceFresh === true ? true : item.sourceFresh === false ? false : null,
      clinicianReviewRequired: item.clinicianReviewRequired === true,
      medicalEligibilityKnown: item.medicalEligibilityKnown === true ? true : item.medicalEligibilityKnown === false ? false : null,
      source: normalizeSource(item.source || item.provenance || {})
    };
  }).filter(Boolean);
}

function normalizeRecords(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).map((item) => {
    const vaccine = token(item.vaccine || item.code || item.name);
    const administeredAt = safeDate(item.administeredAt || item.date || item.vaccinatedAt);
    if (!vaccine || !administeredAt) return null;
    return {
      vaccine,
      administeredAt,
      certificateType: token(item.certificateType || item.certificate),
      certificatePresent: item.certificatePresent === true || Boolean(item.certificateId || item.certificateType || item.certificate),
      medicalEligibilityConfirmed: item.medicalEligibilityConfirmed === true,
      source: token(item.source || 'USER_OR_DOCUMENT')
    };
  }).filter(Boolean);
}

function normalizeItinerary(input) {
  const values = Array.isArray(input) ? input : Array.isArray(input?.stops) ? input.stops : [];
  return values.slice(0, 100).map((item) => {
    const countryCode = country(item.countryCode || item.country || item.destinationCountry);
    const arrivalDate = safeDate(item.arrivalAt || item.arrivalDate || item.date || item.startsAt);
    if (!countryCode) return null;
    return {
      countryCode,
      arrivalDate,
      transit: item.transit === true || item.kind === 'TRANSIT',
      clearsImmigration: item.clearsImmigration === true,
      transitHours: finiteNonNegative(item.transitHours)
    };
  }).filter(Boolean);
}

function firstApplicableArrival(itinerary, requirement) {
  const matches = itinerary
    .filter((stop) => (!requirement.countryCode || stop.countryCode === requirement.countryCode)
      && (requirement.appliesToTransit || !stop.transit || stop.clearsImmigration))
    .map((stop) => stop.arrivalDate)
    .filter(Boolean)
    .sort((a, b) => a - b);
  return matches[0] || null;
}

function bestRecord(records, vaccine) {
  return records
    .filter((record) => record.vaccine === vaccine)
    .sort((a, b) => b.administeredAt - a.administeredAt)[0] || null;
}

function normalizeSource(input) {
  return {
    authority: String(input.authority || input.provider || '').trim().slice(0, 120) || null,
    observedAt: safeDate(input.observedAt || input.checkedAt || input.updatedAt)?.toISOString() || null,
    reference: String(input.reference || input.url || '').trim().slice(0, 500) || null
  };
}

function normalizeConditionStatus(value, applies) {
  const normalized = token(value);
  if (['APPLIES', 'NOT_APPLICABLE', 'UNKNOWN'].includes(normalized)) return normalized;
  if (applies === true) return 'APPLIES';
  if (applies === false) return 'NOT_APPLICABLE';
  return 'UNKNOWN';
}

function compactAction(item) {
  return {
    vaccine: item.vaccine,
    label: item.vaccineLabel,
    countryCode: item.countryCode,
    classification: item.classification,
    status: item.status,
    action: item.action,
    summary: item.summary,
    arrivalDate: item.arrivalDate
  };
}

function displayVaccine(value) {
  const labels = {
    YELLOW_FEVER: 'febre amarela',
    MENINGOCOCCAL: 'meningocócica',
    POLIO: 'poliomielite',
    HEPATITIS_A: 'hepatite A',
    HEPATITIS_B: 'hepatite B',
    TYPHOID: 'febre tifoide',
    RABIES: 'raiva',
    MMR: 'tríplice viral',
    COVID_19: 'COVID-19'
  };
  return labels[value] || String(value || 'vacina').toLowerCase().replace(/_/g, ' ');
}

function addDays(date, days) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + Number(days || 0));
  return copy;
}

function safeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  const text = String(value).trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00Z`) : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function country(value) {
  const text = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2,3}$/.test(text) ? text : null;
}

function token(value) {
  const text = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return text || null;
}
