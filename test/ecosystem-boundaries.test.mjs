import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcosystemIdentity, isCrewCheckMember, assertNoOperationalLeak } from '../src/ecosystem-identity.mjs';
import { evaluateAccountLink } from '../src/auth-provider.mjs';
import { resolveEntitlements, gateFeature } from '../src/entitlements.mjs';
import { buildVacationBridge, projectAuthorizedWindow } from '../src/calendar-boundary.mjs';

test('CrewCheck membership is silent, verified, and operational data never leaks into Voyage', () => {
  const visitor = buildEcosystemIdentity({ memberships:[{ product:'CREWCHECK', seen:true, active:true, crewRole:'PILOT' }] });
  assert.equal(isCrewCheckMember(visitor), false);
  assert.equal(visitor.crewCheckDetection.mustNotPromptUser, true);
  assert.equal(visitor.memberships.CREWCHECK.crewRole, null);
  const active = buildEcosystemIdentity({ memberships:[{ product:'CREWCHECK', verifiedByProduct:true, active:true, crewRole:'CABIN_CREW' }] });
  assert.equal(isCrewCheckMember(active), true);
  assert.equal(active.crewCheckDetection.detectionMethod, 'SILENT_IDENTITY_GRAPH');
  assert.equal(assertNoOperationalLeak({ DUTY_ROSTER:[] }).ok, false);
});

test('email alone never links accounts and Gmail scope cannot ride on login', () => {
  const emailOnly = evaluateAccountLink({ existingIdentity:{ provider:'PASSWORD', subject:'local', email:'same@example.test' }, incoming:{ provider:'GOOGLE', subject:'g1', email:'same@example.test', emailVerified:true } });
  assert.equal(emailOnly.linked, false);
  assert.equal(emailOnly.decision, 'REQUIRE_EXPLICIT_CONFIRMATION');
  const gmailScope = evaluateAccountLink({ incoming:{ provider:'GOOGLE', subject:'g1', grantedScopes:['openid','https://www.googleapis.com/auth/gmail.readonly'] } });
  assert.equal(gmailScope.decision, 'REJECT');
  assert.equal(gmailScope.reason, 'GMAIL_SCOPE_MUST_NOT_RIDE_ON_LOGIN');
});

test('premium capability never implies CrewCheck/Voyage connection consent', () => {
  const resolved = resolveEntitlements({ subscriptions:[{ product:'VOYAGE', state:'ACTIVE' }] });
  assert.equal(resolved.unifiedCalendar.entitled, true);
  assert.equal(gateFeature('UNIFIED_CALENDAR',{ entitlements:resolved.entitlements, consents:{} }).reason, 'CONNECTION_CONSENT_REQUIRED');
  assert.equal(gateFeature('UNIFIED_CALENDAR',{ entitlements:resolved.entitlements, consents:{ CREWCHECK_VOYAGE_CONNECTION:true } }).allowed, true);
});

test('Vacation Bridge strips operational fields and never exposes itself to non-members', () => {
  const projection = projectAuthorizedWindow({ vacationStart:'2027-05-10T00:00:00Z', vacationEnd:'2027-05-25T00:00:00Z', DUTY_ROSTER:['LA1'], LEGALITY_LIMITS:{ max:100 } });
  assert.deepEqual(projection.rejectedOperationalFields, ['DUTY_ROSTER','LEGALITY_LIMITS']);
  const hidden = buildVacationBridge({ identity:{ memberships:{ CREWCHECK:{ state:'VISITOR' } } }, entitlements:['UNIFIED_CALENDAR'], consents:{ CREWCHECK_VOYAGE_CONNECTION:true } });
  assert.equal(hidden.visibleToUser, false);
  assert.equal(hidden.mustNotPromptUser, true);
});
