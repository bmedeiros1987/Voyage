const SEVERITY = new Set(['PREFERENCE', 'INTOLERANCE', 'ALLERGY', 'SEVERE_ALLERGY']);
const CONFIDENCE = new Set(['UNKNOWN', 'USER_REPORTED', 'VENUE_REPORTED', 'MENU_VERIFIED', 'STAFF_CONFIRMED']);
const COMMON_RESTRICTIONS = [
  'GLUTEN', 'WHEAT', 'MILK', 'LACTOSE', 'EGG', 'PEANUT', 'TREE_NUT', 'SOY', 'SESAME',
  'FISH', 'SHELLFISH', 'MUSTARD', 'CELERY', 'SULPHITES', 'LUPIN', 'MOLLUSCS',
  'VEGETARIAN', 'VEGAN', 'PESCATARIAN', 'HALAL', 'KOSHER', 'LOW_SODIUM', 'LOW_SUGAR',
  'NO_PORK', 'NO_BEEF', 'NO_ALCOHOL', 'OTHER'
];
const FOOD_PLACE_TYPES = ['RESTAURANT', 'CAFE', 'BAKERY', 'FOOD_HALL', 'MARKET', 'DELI', 'DESSERT', 'BAR_WITH_FOOD', 'CULINARY_EXPERIENCE', 'HOTEL_BREAKFAST', 'OTHER_FOOD'];

export function dietaryCapabilities() {
  return {
    primaryPurpose: 'FOOD_DISCOVERY_AND_RANKING',
    foodPlaceTypes: FOOD_PLACE_TYPES,
    severities: [...SEVERITY],
    confidenceLevels: [...CONFIDENCE],
    commonRestrictions: COMMON_RESTRICTIONS,
    supportsCuisinePreferences: true,
    supportsGroupProfiles: true,
    supportsPerMealOverrides: true,
    optionalSafetyMode: true,
    supportsCrossContact: true,
    principles: [
      'Dietary restrictions primarily help Voyage find and rank restaurants, cafés, bakeries, markets and culinary experiences that fit the user.',
      'Cuisine, menu fit, distance, opening hours, rating and itinerary compatibility are combined when trusted data is available.',
      'Unknown dietary compatibility remains unknown; Voyage does not invent menu support.',
      'Allergy and cross-contact handling is an optional stricter safety layer when the user explicitly identifies an allergy or requests safety mode.',
      'Each traveller keeps an individual food profile so group dining can optimize for everyone without exposing private details by default.'
    ]
  };
}

export function normalizeDietaryProfile(input = {}) {
  const restrictions = Array.isArray(input.restrictions) ? input.restrictions.slice(0, 80).map((item, index) => normalizeRestriction(item, index)) : [];
  const containsAllergy = restrictions.some((item) => ['ALLERGY', 'SEVERE_ALLERGY'].includes(item.severity));
  const safetyMode = input.safetyMode === true || containsAllergy;
  return {
    profileVersion: 2,
    primaryPurpose: 'FOOD_DISCOVERY',
    restrictions,
    safetyMode,
    avoidsCrossContact: safetyMode && (input.avoidsCrossContact === true || restrictions.some((item) => item.severity === 'SEVERE_ALLERGY')),
    requiresStaffConfirmation: safetyMode && (input.requiresStaffConfirmation === true || containsAllergy),
    preferredCuisines: uniqueStrings(input.preferredCuisines).slice(0, 30),
    avoidedCuisines: uniqueStrings(input.avoidedCuisines).slice(0, 30),
    preferredFoodPlaceTypes: uniqueStrings(input.preferredFoodPlaceTypes).filter((value) => FOOD_PLACE_TYPES.includes(value)).slice(0, 20),
    freeTextNote: safeString(input.freeTextNote, 1500)
  };
}

export function evaluateFoodCandidate(candidate = {}, profileInput = {}) {
  const profile = normalizeDietaryProfile(profileInput);
  const venue = normalizeVenueDietary(candidate);
  const blockers = [];
  const warnings = [];
  const matches = [];
  const discoverySignals = [];

  for (const restriction of profile.restrictions) {
    if (restriction.active === false) continue;
    const status = venue.restrictions[restriction.code] || 'UNKNOWN';

    if (status === 'SUPPORTED') {
      matches.push(restriction.code);
      discoverySignals.push(`DIETARY_MATCH:${restriction.code}`);
      continue;
    }

    if (status === 'CONTAINS' || status === 'UNSUPPORTED') {
      if (profile.safetyMode && ['ALLERGY', 'SEVERE_ALLERGY'].includes(restriction.severity)) {
        blockers.push(`KNOWN_CONFLICT:${restriction.code}`);
      } else {
        warnings.push(`DIETARY_MISMATCH:${restriction.code}`);
      }
      continue;
    }

    if (status === 'UNKNOWN') {
      if (profile.safetyMode && ['ALLERGY', 'SEVERE_ALLERGY'].includes(restriction.severity)) {
        blockers.push(`ALLERGEN_STATUS_UNKNOWN:${restriction.code}`);
      } else {
        warnings.push(`DIETARY_STATUS_UNKNOWN:${restriction.code}`);
      }
    }
  }

  if (profile.safetyMode && profile.avoidsCrossContact) {
    if (venue.crossContact === 'UNSAFE') blockers.push('CROSS_CONTACT_UNSAFE');
    if (venue.crossContact === 'UNKNOWN') blockers.push('CROSS_CONTACT_UNKNOWN');
  }

  if (profile.safetyMode && profile.requiresStaffConfirmation && !['STAFF_CONFIRMED', 'MENU_VERIFIED'].includes(venue.confidence)) {
    warnings.push('STAFF_OR_MENU_CONFIRMATION_REQUIRED');
  }

  const cuisine = safeToken(candidate.cuisine, null);
  if (cuisine && profile.preferredCuisines.map((item) => safeToken(item, null)).includes(cuisine)) discoverySignals.push(`CUISINE_MATCH:${cuisine}`);
  if (cuisine && profile.avoidedCuisines.map((item) => safeToken(item, null)).includes(cuisine)) warnings.push(`CUISINE_AVOIDED:${cuisine}`);

  const discoveryEligible = blockers.length === 0;
  const dietaryMatchScore = Math.max(0, matches.length * 2 + discoverySignals.length - warnings.length * 0.35);

  return {
    safe: profile.safetyMode ? blockers.length === 0 : null,
    safetyMode: profile.safetyMode,
    discoveryEligible,
    eligibleForAutomaticRecommendation: discoveryEligible,
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
    matchedPreferences: uniqueStrings(matches),
    discoverySignals: uniqueStrings(discoverySignals),
    dietaryMatchScore: Number(dietaryMatchScore.toFixed(2)),
    venueEvidence: venue,
    policy: profile.safetyMode
      ? 'Use dietary fit for food discovery and apply stricter allergy rules where the user explicitly needs them.'
      : 'Use dietary fit as a discovery/ranking signal for restaurants and other culinary places; unknown menu compatibility lowers confidence but is not treated as a medical blocker.'
  };
}

export function buildFoodDiscoveryQuery(profileInput = {}, context = {}) {
  const profile = normalizeDietaryProfile(profileInput);
  return {
    purpose: 'FIND_FOOD_PLACES',
    meal: safeToken(context.meal, null),
    near: safeString(context.near, 300),
    destination: safeString(context.destination, 220),
    preferredCuisines: profile.preferredCuisines,
    avoidedCuisines: profile.avoidedCuisines,
    dietaryFilters: profile.restrictions.filter((item) => item.active !== false).map((item) => ({ code: item.code, severity: item.severity })),
    preferredFoodPlaceTypes: profile.preferredFoodPlaceTypes.length ? profile.preferredFoodPlaceTypes : FOOD_PLACE_TYPES,
    safetyMode: profile.safetyMode,
    rankingSignals: ['dietary_fit', 'cuisine_fit', 'distance', 'travel_time', 'opening_hours', 'rating', 'community_signal', 'price_fit', 'itinerary_fit']
  };
}

export function buildGroupDietarySummary(travellers = []) {
  const normalized = Array.isArray(travellers) ? travellers.slice(0, 50).map((traveller, index) => ({
    travellerId: safeString(traveller.travellerId, 160) || `traveller-${index + 1}`,
    displayName: safeString(traveller.displayName, 120),
    profile: normalizeDietaryProfile(traveller.profile || traveller)
  })) : [];

  const hardConstraints = new Map();
  const discoveryPreferences = new Set();
  let safetyMode = false;

  for (const traveller of normalized) {
    safetyMode ||= traveller.profile.safetyMode;
    for (const item of traveller.profile.restrictions) {
      if (item.active === false) continue;
      if (traveller.profile.safetyMode && ['ALLERGY', 'SEVERE_ALLERGY'].includes(item.severity)) {
        const current = hardConstraints.get(item.code);
        if (!current || severityWeight(item.severity) > severityWeight(current.severity)) hardConstraints.set(item.code, { code: item.code, severity: item.severity });
      } else {
        discoveryPreferences.add(item.code);
      }
    }
  }

  return {
    travellerCount: normalized.length,
    purpose: 'GROUP_FOOD_DISCOVERY',
    hardConstraints: [...hardConstraints.values()].sort((a, b) => a.code.localeCompare(b.code)),
    preferences: [...discoveryPreferences].sort(),
    safetyMode,
    privacyPolicy: 'Expose only the food-planning requirements needed for shared venue discovery; individual profile details remain private by default.'
  };
}

export function buildDietaryTravelCard(profileInput = {}, locale = 'pt-BR') {
  const profile = normalizeDietaryProfile(profileInput);
  return {
    locale,
    title: locale.toLowerCase().startsWith('pt') ? 'Preferências alimentares' : 'Food preferences',
    restrictions: profile.restrictions.filter((item) => item.active !== false),
    preferredCuisines: profile.preferredCuisines,
    avoidedCuisines: profile.avoidedCuisines,
    safetyMode: profile.safetyMode,
    crossContactWarning: profile.avoidsCrossContact,
    staffConfirmationRequired: profile.requiresStaffConfirmation,
    designedForOfflineAccess: true,
    disclaimer: profile.safetyMode ? 'This card communicates user-provided dietary requirements and does not certify venue safety.' : 'This card summarizes user-provided food preferences for venue discovery.'
  };
}

function normalizeRestriction(item, index) {
  const raw = typeof item === 'string' ? { code: item, severity: 'PREFERENCE' } : item || {};
  const code = safeToken(raw.code || raw.name, `OTHER_${index + 1}`);
  const severity = SEVERITY.has(raw.severity) ? raw.severity : 'PREFERENCE';
  return { code, label: safeString(raw.label || raw.name, 120), severity, notes: safeString(raw.notes, 500), active: raw.active !== false };
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
  return { restrictions, crossContact, confidence, source: safeString(candidate.dietarySource, 220), checkedAt: safeDateTime(candidate.dietaryCheckedAt) };
}

function severityWeight(value) { return value === 'SEVERE_ALLERGY' ? 4 : value === 'ALLERGY' ? 3 : value === 'INTOLERANCE' ? 2 : 1; }
function uniqueStrings(input) { return [...new Set((Array.isArray(input) ? input : []).map((item) => String(item || '').trim()).filter(Boolean))]; }
function safeToken(value, fallback) { const token = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80); return token || fallback; }
function safeString(value, max) { if (value === null || value === undefined) return null; const text = String(value).trim(); return text ? text.slice(0, max) : null; }
function safeDateTime(value) { if (!value) return null; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(); }
