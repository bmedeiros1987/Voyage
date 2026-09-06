# Weather-aware planning

Voyage treats meteorology as a first-class planning constraint before and during a trip.

## Product behavior

- Weather-sensitive activities must not be recommended blindly.
- A water park, pool or similar water activity should be down-ranked or replaced when verified forecast/nowcast indicates unsuitable cold, rain, thunderstorms or wind.
- Outdoor activities should be down-ranked or replaced when verified forecast/nowcast indicates meaningful rain, thunderstorms, severe alerts or other incompatible conditions.
- Indoor activities remain candidates during poor weather, subject to normal opening-hours, distance, quality and preference checks.
- A locked reservation is never silently removed. Voyage warns the user, shows the weather reason, and offers nearby alternatives or rescheduling options.
- When an optional activity becomes unsuitable, Voyage repairs the smallest affected itinerary scope and preserves the user's original intent where possible.

## Replacement examples

- Outdoor park + rain -> nearby museum, indoor attraction, food experience, shopping, wellness or another verified weather-safe option aligned to the user's interests.
- Water park + cold weather -> indoor family attraction, museum, culinary experience, shopping or wellness; never invent a venue.
- Outdoor viewpoint + thunderstorm -> mark unsafe/blocked, keep locked reservations visible, and offer a verified local substitute.

## Forecast lifecycle

1. **Long range:** climate/seasonal information may influence soft planning only. It must never be presented as a verified forecast.
2. **Forecast range:** fresh provider-backed forecast can change ranking and day placement of optional weather-sensitive activities.
3. **During the trip:** re-check the affected day and next weather-sensitive activity when forecast/nowcast materially changes.
4. **Immediate severe weather:** prioritize safety, preserve locked items as warnings, and propose local weather-safe alternatives.

## Data contract

`src/weather-intelligence.mjs` normalizes forecast data with provenance and evaluates each activity with one of:

- `SUITABLE`
- `CAUTION`
- `UNSUITABLE`
- `BLOCKED`
- `UNKNOWN`

Weather sensitivity can be explicit (`INDOOR`, `MIXED`, `OUTDOOR`, `WATER`, `NONE`) or inferred conservatively from structured activity type/tags. Unknown weather stays unknown; it is never fabricated.

## Replacement policy

`buildWeatherReplacementPlan()` returns verified alternatives when they are already available. When no verified candidate exists, it emits a provider-backed search intent with the original interest tags and local cluster instead of inventing a place.

This policy is intended to plug into Planner Brain, live trip monitoring and future weather providers without coupling the UI to a specific meteorology vendor.
