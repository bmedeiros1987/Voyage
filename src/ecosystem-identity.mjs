import { randomUUID } from 'node:crypto';

export const PRODUCTS = Object.freeze(['VOYAGE', 'CREWCHECK']);
export const MEMBERSHIP_STATES = Object.freeze(['ACTIVE', 'VISITOR', 'NONE']);

const VOYAGE_PERSONAL_SCOPE = Object.freeze([
  'PERSONAL_TRIPS', 'PERSONAL_DOCUMENTS', 'PERSONAL_PREFERENCES', 'PERSONAL_CONSENTS', 'PERSONAL_BUDGET'
]);
const CREWCHECK_OPERATIONAL_SCOPE = Object.freeze([
  'DUTY_ROSTER', 'FLIGHT_ASSIGNMENTS', 'CREW_BASE', 'OPERATIONAL_LEGALITY', 'EMPLOYER_RECORDS'
]);

export function ecosystemIdentityCapabilities() {
  return Object.freeze({
    version: '1.0', products: PRODUCTS, membershipStates: MEMBERSHIP_STATES,
    voyagePersonalScope: VOYAGE_PERSONAL_SCOPE, crewCheckOperationalScope: CREWCHECK_OPERATIONAL_SCOPE,
    principles: [
      'A single globalUserId identifies the human; each product membership is independent and separately revocable.',
      'Voyage must never ask the user whether they are crew. CrewCheck membership is resolved silently from the identity graph.',
      'A CrewCheck visitor is not a CrewCheck member: only a verified, active membership unlocks crew-aware surfaces.',
      'CrewCheck operational data stays in CrewCheck. Voyage may consume authorized context, never own the roster.',
      'Membership never implies consent to connect the two products; connection stays opt-in.'
    ]
  });
}

export function createGlobalIdentity({ globalUserId = null, createdAt = null } = {}) {
  return Object.freeze({ globalUserId: globalUserId || `gid_${randomUUID()}`, createdAt: createdAt || new Date().toISOString() });
}

export function normalizeMembership(input = {}) {
  const product = PRODUCTS.includes(String(input.product || '').toUpperCase()) ? String(input.product).toUpperCase() : null;
  if (!product) return null;
  const verified = input.verifiedByProduct === true;
  const state = verified && input.active === true ? 'ACTIVE' : input.seen === true || verified ? 'VISITOR' : 'NONE';
  return Object.freeze({
    product, state, verifiedByProduct: verified,
    productAccountId: input.productAccountId ? String(input.productAccountId).slice(0, 190) : null,
    linkedAt: input.linkedAt || null,
    crewRole: product === 'CREWCHECK' && verified && input.active === true && input.crewRole ? String(input.crewRole).toUpperCase().slice(0, 40) : null
  });
}

export function buildEcosystemIdentity(input = {}) {
  const identity = createGlobalIdentity(input);
  const memberships = (Array.isArray(input.memberships) ? input.memberships : []).map(normalizeMembership).filter(Boolean);
  const byProduct = new Map(memberships.map((membership) => [membership.product, membership]));
  const voyage = byProduct.get('VOYAGE') || normalizeMembership({ product: 'VOYAGE' });
  const crewcheck = byProduct.get('CREWCHECK') || normalizeMembership({ product: 'CREWCHECK' });
  return Object.freeze({
    globalUserId: identity.globalUserId, createdAt: identity.createdAt,
    memberships: Object.freeze({ VOYAGE: voyage, CREWCHECK: crewcheck }),
    crewCheckDetection: Object.freeze({
      linkedAccountDetected: crewcheck.state !== 'NONE', activeMember: crewcheck.state === 'ACTIVE', crewRole: crewcheck.crewRole,
      detectionMethod: crewcheck.state === 'NONE' ? null : 'SILENT_IDENTITY_GRAPH', mustNotPromptUser: true
    }),
    dataBoundary: Object.freeze({
      voyageOwns: VOYAGE_PERSONAL_SCOPE, crewCheckOwns: CREWCHECK_OPERATIONAL_SCOPE,
      sharedByDefault: Object.freeze([]), requiresExplicitConnectionConsent: true
    })
  });
}

export function isCrewCheckMember(identity) { return identity?.memberships?.CREWCHECK?.state === 'ACTIVE'; }

export function assertNoOperationalLeak(voyageRecord = {}) {
  const leaked = Object.keys(voyageRecord).filter((key) => CREWCHECK_OPERATIONAL_SCOPE.includes(String(key).toUpperCase()));
  return Object.freeze({ ok: leaked.length === 0, leaked: Object.freeze(leaked) });
}
