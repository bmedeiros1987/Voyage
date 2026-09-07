import { lodgingIntelligenceCapabilities, resolveLodgingPlan } from './lodging-intelligence.mjs';
import { budgetIntelligenceCapabilities, buildBudgetPlan, assessPaymentReadiness } from './budget-intelligence.mjs';
import { chronologicalItineraryCapabilities, buildChronologicalItinerary } from './chronological-itinerary.mjs';
import { transportIntelligenceCapabilities, buildTransportChoice } from './transport-intelligence.mjs';
import { departureIntelligenceCapabilities, buildDepartureDecision } from './departure-intelligence.mjs';
import { weatherPlanningCapabilities, evaluateActivityWeather, buildWeatherReplacementPlan } from './weather-intelligence.mjs';
import { travelHealthIntelligenceCapabilities, buildTravelHealthPlan } from './travel-health-intelligence.mjs';
import { airportConnectionCapabilities, buildAirportConnectionPlan, knownAirportConnectionFacts } from './airport-connection-intelligence.mjs';
import { baggageIntelligenceCapabilities, buildBaggageConnectionDecision } from './baggage-intelligence.mjs';
import { baggagePassportCapabilities, analyzeBaggagePassport } from './baggage-passport-intelligence.mjs';
import { airportIndoorNavigationCapabilities, buildAirportIndoorRoute } from './airport-indoor-navigation.mjs';
import { arrivalIntelligenceCapabilities, buildArrivalIntelligence } from './arrival-intelligence.mjs';
import { journeyReadinessCapabilities, buildJourneyReadiness } from './journey-readiness.mjs';
import { journeyCommandCenterCapabilities, buildJourneyCommandCenter } from './journey-command-center.mjs';
import { ecosystemServiceRouterCapabilities, buildEcosystemServiceCatalog, resolveEcosystemCapabilities } from './ecosystem-service-router.mjs';

const MAX_JSON_BYTES = 512 * 1024;

const GET_ROUTES = new Map([
  ['/api/v1/lodging/capabilities', lodgingIntelligenceCapabilities],
  ['/api/v1/budget/capabilities', budgetIntelligenceCapabilities],
  ['/api/v1/planner/chronological/capabilities', chronologicalItineraryCapabilities],
  ['/api/v1/transport/capabilities', transportIntelligenceCapabilities],
  ['/api/v1/departure/capabilities', departureIntelligenceCapabilities],
  ['/api/v1/weather/capabilities', weatherPlanningCapabilities],
  ['/api/v1/travel-health/capabilities', travelHealthIntelligenceCapabilities],
  ['/api/v1/airport-connections/capabilities', airportConnectionCapabilities],
  ['/api/v1/baggage/capabilities', baggageIntelligenceCapabilities],
  ['/api/v1/baggage/passport/capabilities', baggagePassportCapabilities],
  ['/api/v1/airports/indoor/capabilities', airportIndoorNavigationCapabilities],
  ['/api/v1/journey/arrival/capabilities', arrivalIntelligenceCapabilities],
  ['/api/v1/journey/readiness/capabilities', journeyReadinessCapabilities],
  ['/api/v1/journey/command-center/capabilities', journeyCommandCenterCapabilities],
  ['/api/v1/ecosystem/capabilities', ecosystemServiceRouterCapabilities],
  ['/api/v1/airport-connections/known-facts', () => ({ version: '1.0', facts: knownAirportConnectionFacts() })]
]);

const POST_ROUTES = new Map([
  ['/api/v1/lodging/resolve', resolveLodgingPlan],
  ['/api/v1/budget/plan', buildBudgetPlan],
  ['/api/v1/budget/payment-readiness', assessPaymentReadiness],
  ['/api/v1/planner/chronological/preview', buildChronologicalItinerary],
  ['/api/v1/transport/choice', buildTransportChoice],
  ['/api/v1/departure/decision', buildDepartureDecision],
  ['/api/v1/travel-health/plan', buildTravelHealthPlan],
  ['/api/v1/airport-connections/plan', buildAirportConnectionPlan],
  ['/api/v1/baggage/connection', buildBaggageConnectionDecision],
  ['/api/v1/baggage/passport/analyze', analyzeBaggagePassport],
  ['/api/v1/airports/indoor/route', buildAirportIndoorRoute],
  ['/api/v1/journey/arrival/preview', buildArrivalIntelligence],
  ['/api/v1/journey/readiness', buildJourneyReadiness],
  ['/api/v1/journey/command-center', buildJourneyCommandCenter],
  ['/api/v1/ecosystem/catalog', buildEcosystemServiceCatalog],
  ['/api/v1/ecosystem/resolve', resolveEcosystemCapabilities]
]);

export function intelligenceHttpCapabilities() {
  return {
    version: '1.3',
    getRoutes: [...GET_ROUTES.keys()],
    postRoutes: [...POST_ROUTES.keys(), '/api/v1/weather/activity-check', '/api/v1/weather/replacement-plan'],
    policy: {
      previewAndDecisionLayerOnly: true,
      automaticBookingAllowed: false,
      automaticItineraryMutationAllowed: false,
      operationalFactsMayRefreshAutomatically: true,
      explicitUserApprovalRequiredForItineraryMutation: true,
      unknownProviderFactsRemainUnresolved: true
    }
  };
}

export async function handleIntelligenceHttp(req, res, path) {
  if (req.method === 'GET' && path === '/api/v1/intelligence/capabilities') {
    return sendJson(res, 200, intelligenceHttpCapabilities());
  }

  if (req.method === 'GET' && GET_ROUTES.has(path)) {
    const result = await GET_ROUTES.get(path)();
    return sendJson(res, 200, result);
  }

  if (req.method === 'POST' && path === '/api/v1/weather/activity-check') {
    const body = await readJson(req);
    return sendJson(res, 200, evaluateActivityWeather(body.activity || {}, body.weather || body.context || {}));
  }

  if (req.method === 'POST' && path === '/api/v1/weather/replacement-plan') {
    const body = await readJson(req);
    return sendJson(res, 200, buildWeatherReplacementPlan(body));
  }

  if (req.method === 'POST' && POST_ROUTES.has(path)) {
    const body = await readJson(req);
    const result = await POST_ROUTES.get(path)(body);
    return sendJson(res, 200, result);
  }

  const knownPath = GET_ROUTES.has(path)
    || POST_ROUTES.has(path)
    || path === '/api/v1/intelligence/capabilities'
    || path === '/api/v1/weather/activity-check'
    || path === '/api/v1/weather/replacement-plan';

  if (knownPath) {
    res.setHeader('Allow', allowedMethods(path));
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  return false;
}

function allowedMethods(path) {
  if (path === '/api/v1/intelligence/capabilities' || GET_ROUTES.has(path)) return 'GET, OPTIONS';
  return 'POST, OPTIONS';
}

async function readJson(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType && contentType !== 'application/json') throw httpError(415, 'intelligence_unsupported_content_type');

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw httpError(413, 'intelligence_request_body_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object_required');
    return value;
  } catch {
    throw httpError(400, 'intelligence_invalid_json');
  }
}

function sendJson(res, statusCode, payload) {
  if (res.writableEnded) return true;
  const data = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
  return true;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = message;
  return error;
}
