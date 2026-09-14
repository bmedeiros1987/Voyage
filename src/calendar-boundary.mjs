import { gateFeature } from './entitlements.mjs';
import { isCrewCheckMember } from './ecosystem-identity.mjs';

const CREWCHECK_OWNED = Object.freeze(['DUTY_ROSTER','FLIGHT_ASSIGNMENTS','STANDBY','RESERVE','LEGALITY_LIMITS','CREW_SWAPS','BID_LINES','OPERATIONAL_ALERTS']);
const VOYAGE_OWNED = Object.freeze(['PERSONAL_TRIPS','PERSONAL_RESERVATIONS','PERSONAL_ACTIVITIES','PERSONAL_BUDGET','PERSONAL_DOCUMENTS']);
const AUTHORIZED_PROJECTION = Object.freeze(['VACATION_WINDOW_START','VACATION_WINDOW_END','WINDOW_LABEL']);

export function calendarBoundaryCapabilities() {
  return Object.freeze({ version:'1.0', crewCheckOwned:CREWCHECK_OWNED, voyageOwned:VOYAGE_OWNED, authorizedProjection:AUTHORIZED_PROJECTION,
    principles:[
      'The operational roster belongs to CrewCheck; Voyage never stores or re-implements it.',
      'Voyage consumes only an authorized vacation-window projection, never duty detail.',
      'Vacation Bridge overlays personal travel on a vacation window; it does not schedule work.',
      'Every event is labelled with its origin so CrewCheck and Voyage data never blur.',
      'Itinerary changes stay approval-gated regardless of where the context came from.'
    ]});
}

export function normalizeVacationWindow(input={}) {
  const start=toDate(input.start||input.vacationStart); const end=toDate(input.end||input.vacationEnd);
  if(!start||!end||end<start) return null;
  return Object.freeze({ start:start.toISOString(), end:end.toISOString(), label:input.label?String(input.label).slice(0,120):'Férias', origin:'CREWCHECK' });
}

export function projectAuthorizedWindow(rawCrewCheckRecord={}) {
  const window=normalizeVacationWindow({ start:rawCrewCheckRecord.vacationStart||rawCrewCheckRecord.start, end:rawCrewCheckRecord.vacationEnd||rawCrewCheckRecord.end, label:rawCrewCheckRecord.label });
  const rejected=Object.keys(rawCrewCheckRecord).filter((key)=>CREWCHECK_OWNED.includes(String(key).toUpperCase()));
  return Object.freeze({ window, rejectedOperationalFields:Object.freeze(rejected) });
}

export function buildVacationBridge(input={}) {
  const identity=input.identity||{};
  const gate=gateFeature('UNIFIED_CALENDAR',{ entitlements:input.entitlements||[], consents:input.consents||{} });
  if(!isCrewCheckMember(identity)) return Object.freeze({ available:false, reason:'NO_ACTIVE_CREWCHECK_MEMBERSHIP', visibleToUser:false, mustNotPromptUser:true, overlay:null });
  if(!gate.allowed) return Object.freeze({ available:false, reason:gate.reason, visibleToUser:true, upgradeRequired:gate.upgradeRequired, consentRequired:gate.consentRequired, overlay:null });
  const projection=projectAuthorizedWindow(input.crewCheckWindow||{});
  if(!projection.window) return Object.freeze({ available:false, reason:'NO_AUTHORIZED_VACATION_WINDOW', visibleToUser:true, overlay:null });
  const windowStart=Date.parse(projection.window.start), windowEnd=Date.parse(projection.window.end);
  const personalEvents=(Array.isArray(input.personalEvents)?input.personalEvents:[]).slice(0,200).map(normalizePersonalEvent).filter(Boolean);
  const insideWindow=personalEvents.filter((event)=>Date.parse(event.start)>=windowStart&&Date.parse(event.start)<=windowEnd);
  const outsideWindow=personalEvents.filter((event)=>!insideWindow.includes(event));
  return Object.freeze({ available:true, reason:null, visibleToUser:true, vacationWindow:projection.window, rejectedOperationalFields:projection.rejectedOperationalFields,
    overlay:Object.freeze({ insideWindow:Object.freeze(insideWindow), outsideWindow:Object.freeze(outsideWindow) }),
    boundary:Object.freeze({ rosterRemainsInCrewCheck:true, voyageDuplicatesOperationalFeatures:false, itineraryMutationRequiresApproval:true }) });
}

function normalizePersonalEvent(event={}) { const start=toDate(event.start||event.startsAt); if(!start) return null; const end=toDate(event.end||event.endsAt); return Object.freeze({ id:event.id?String(event.id).slice(0,120):null, title:event.title?String(event.title).slice(0,220):'Evento', start:start.toISOString(), end:end?end.toISOString():null, origin:'VOYAGE' }); }
function toDate(value){ if(!value) return null; const date=new Date(value); return Number.isNaN(date.getTime())?null:date; }
