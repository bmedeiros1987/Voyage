const SEVERITY = new Set(['PREFERENCE', 'INTOLERANCE', 'ALLERGY', 'SEVERE_ALLERGY']);
const CONFIDENCE = new Set(['UNKNOWN', 'USER_REPORTED', 'VENUE_REPORTED', 'MENU_VERIFIED', 'STAFF_CONFIRMED']);
const COMMON_RESTRICTIONS = [
  'GLUTEN', 'WHEAT', 'MILK', 'LACTOSE', 'EGG', 'PEANUT', 'TREE_NUT', 'SOY', 'SESAME',
  'FISH', 'SHELLFISH', 'MUSTARD', 'CELERY', 'SULPHITES', 'LUPIN', 'MOLLUSCS',
  'VEGETARIAN', 'VEGAN', 'PESCATARIAN', 'HALAL', 'KOSHER', 'LOW_SODIUM', 'LOW_SUGAR',
  'NO_PORK', 'NO_BEEF', 'NO_ALCOHOL', 'OTHER'
];

export function dietaryCapabilities() {
  return {
    severities: [...SEVERITY],
    confidenceLevels: [...CONFIDENCE],
    commonRestrictions: COMMON_RESTRICTIONS,
    supportsCrossContact: true,
    supportsGroupProfiles: true,
    supportsPerMealOverrides: true,
    principles: [
      'Allergies and severe allergies are hard safety constraints, never soft ranking preferences.',
      'Unknown allergen or cross-contact information remains unknown; Voyage does not infer safety from cuisine, rating or popularity.',
      'A restaurant can be recommended for a dietary preference while still being blocked for an allergy.',
      'Each traveller keeps an individual dietary profile; group planning uses the strictest applicable constraint for shared meals.',
      'User-entered medical or dietary details are private profile data and must not be exposed to other travellers without explicit sharing.'
    ]
  };
}

export function normalizeDietaryProfile(input = {}) {
  const restrictions = Array.isArray(input.restrictions) ? input.restrictions.slice(0, 80).map((item, index) => normalizeRestriction(item, index)) : [];
  return {
    profileVersion: 1,
    restrictions,
    avoidsCrossContact: input.avoidsCrossContact === true || restrictions.some((item) => item.severity === 'SEVERE_ALLERGY'),
    requiresStaffConfirmation: input.requiresStaffConfirmation === true || restrictions.some((item) => ['ALLERGY', 'SEVERE_ALLERGY'].includes(item.severity)),
    emergencyNoteEnabled: input.emergencyNoteEnabled === true,
    preferredCuisines: uniqueStrings(input.preferredCuisines).slice(0, 30),
    avoidedCuisines: uniqueStrings(input.avoidedCuisines).slice(0, 30),
    freeTextNote: safeString(input.freeTextNote, 1500)
  };
}

export function evaluateFoodCandidate(candidate = {}, profileInput = {}) {
  const profile = normalizeDietaryProfile(profileInput);
  const venue = normalizeVenueDietary(candidate);
  const blockers = [];
  const warnings = [];
  const matches = [];

  for (const restriction of profile.restrictions) {
    const status = venue.restrictions[restriction.code] || 'UNKNOWN';
    if (restriction.severity === 'PREFERENCE') {
      if (status === 'SUPPORTED') matches.push(restriction.code);
      else if (status === 'UNSUPPORTED') warnings.push(`PREFERENCE_UNSUPPORTED:${restriction.code}`);
      continue;
    }

    if (status === 'CONTAINS') {
      blockers.push(`KNOWN_CONFLICT:${restriction.code}`);
      continue;
    }

    if (status === 'UNKNOWN') {
      if (['ALLERGY', 'SEVERE_ALLERGY'].includes(restriction.severity)) blockers.push(`ALLERGEN_STATUS_UNKNOWN:${restriction.code}`);
      else warnings.push(`RESTRICTION_STATUS_UNKNOWN:${restriction.code}`);
      continue;
    }

    if (status === 'UNSUPPORTED') {
      if (['ALLERGY', 'SEVERE_ALLERGY'].includes(restriction.severity)) blockers.push(`RESTRICTION_UNSUPPORTED:${restriction.code}`);
      else warnings.push(`RESTRICTION_UNSUPPORTED:${restriction.code}`);
    }
  }

  if (profile.avoidsCrossContact) {
    if (venue.crossContact === 'UNSAFE') blockers.push('CROSS_CONTACT_UNSAFE');
    if (venue.crossContact === 'UNKNOWN') blockers.push('CROSS_CONTACT_UNKNOWN');
  }

  if (profile.requiresStaffConfirmation && !['STAFF_CONFIRMED', 'MENU_VERIFIED'].includes(venue.confidence)) {
    warnings.push('STAFF_OR_MENU_CONFIRMATION_REQUIRED');
  }

  const safe = blockers.length === 0;
  return {
    safe,
    eligibleForAutomaticRecommendation: safe,
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
    matchedPreferences: uniqueStrings(matches),
    venueEvidence: venue,
    policy: safe
      ? 'Candidate may be ranked using normal quality, distance and preference signals.'
      : 'Candidate is excluded from automatic food recommendations until the blocking dietary uncertainty/conflict is resolved.'
  };
}

export function buildGroupDietarySummary(travellers = []) {
  const normalized = Array.isArray(travellers) ? travellers.slice(0, 50).map((traveller, index) => ({
    travellerId: safeString(traveller.travellerId, 160) || `traveller-${index + 1}`,
    displayName: safeString(traveller.displayName, 120),
    profile: normalizeDietaryProfile(traveller.profile || traveller)
  })) : [];

  const hardConstraints = new Map();
  const preferences = new Set();
  let avoidsCrossContact = false;
  let requiresStaffConfirmation = false;

  for (const traveller of normalized) {
    avoidsCrossContact ||= traveller.profile.avoidsCrossContact;
    requiresStaffConfirmation ||= traveller.profile.requiresStaffConfirmation;
    for (const item of traveller.profile.restrictions) {
      if (item.severity === 'PREFERENCE') preferences.add(item.code);
      else {
        const current = hardConstraints.get(item.code);
        if (!current || severityWeight(item.severity) > severityWeight(current.severity)) {
          hardConstraints.set(item.code, { code: item.code, severity: item.severity });
        }
      }
    }
  }

  return {
    travellerCount: normalized.length,
    hardConstraints: [...hardConstraints.values()].sort((a, b) => a.code.localeCompare(b.code)),
    preferences: [...preferences].sort(),
    avoidsCrossContact,
    requiresStaffConfirmation,
    privacyPolicy: 'Expose only the group-safe planning requirements by default; individual medical/dietary details require explicit sharing.'
  };
}

export function buildDietaryTravelCard(profileInput = {}, locale = 'pt-BR') {
  const profile = normalizeDietaryProfile(profileInput);
  const serious = profile.restrictions.filter((item) => ['ALLERGY', 'SEVERE_ALLERGY'].includes(item.severity));
  const intolerances = profile.restrictions.filter((item) => item.severity === 'INTOLERANCE');
  const preferences = profile.restrictions.filter((item) => item.severity === 'PREFERENCE');
  return {
    locale,
    title: locale.toLowerCase().startsWith('pt') ? 'Restrições alimentares' : 'Dietary restrictions',
    serious,
    intolerances,
    preferences,
    crossContactWarning: profile.avoidsCrossContact,
    staffConfirmationRequired: profile.requiresStaffConfirmation,
    designedForOfflineAccess: true,
    disclaimer: 'This card communicates user-provided dietary requirements. It does not certify that a venue or dish is medically safe.'
  };
}

function normalizeRestriction(item, index) {
  const raw = typeof item === 'string' ? { code: item, severity: 'PREFERENCE' } : item || {};
  const code = safeToken(raw.code || raw.name, `OTHER_${index + 1}`);
  const severity = SEVERITY.has(raw.severity) ? raw.severity : 'PREFERENCE';
  return {
    code,
    label: safeString(raw.label || raw.name, 120),
    severity,
    notes: safeString(raw.notes, 500),
    active: raw.active !== false
  };
}

function normalizeVenueDietary(candidate) {
  const restrictions = {};
  const supplied = candidate.dietary || candidate.restrictions || {};
  if (supplied && typeof supplied === 'object' && !Array.isArray(supplied)) {
    for (const [key, value] of Object.entries(supplied).slice(0, 120)) {
      const code = safeToken(key, null);
      if (!code) continue;
      const status = String(value || '').toUpperCase();
      restrictions[code] = ['SUPPORTED', 'UNSUPPORTED', 'CONTAINS', 'UNKNOWN'].includes(status) ? status : 'UNKNOWN';
    }
  }
  const confidence = CONFIDENCE.has(candidate.dietaryConfidence) ? candidate.dietaryConfidence : 'UNKNOWN';
  const crossContactRaw = String(candidate.crossContact || '').toUpperCase();
  const crossContact = ['SAFE', 'UNSAFE', 'UNKNOWN'].includes(crossContactRaw) ? crossContactRaw : 'UNKNOWN';
  return {
    restrictions,
    crossContact,
    confidence,
    source: safeString(candidate.dietarySource, 220),
    checkedAt: safeDateTime(candidate.dietaryCheckedAt)
  };
}

function severityWeight(value) {
  return value === 'SEVERE_ALLERGY' ? 4 : value === 'ALLERGY' ? 3 : value === 'INTOLERANCE' ? 2 : 1;
}

function uniqueStrings(input) {
  return [...new Set((Array.isArray(input) ? input : []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function safeToken(value, fallback) {
  const token = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return token || fallback;
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function safeDateTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
