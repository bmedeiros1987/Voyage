# Google Maps / My Maps import into Voyage

## Goal

Allow a user to bring their own Google Maps planning data into Voyage with explicit authorization, normalize it into Voyage itinerary items, and then let the Automatic Trip Planner improve ordering, timing and fit with reservations, work, meals and preferences.

## Preferred path: Google Data Portability API

Voyage should use Google's Data Portability API for private account data rather than scraping Google Maps pages.

Initial verified resource scopes:

- `https://www.googleapis.com/auth/dataportability.mymaps.maps` — maps created in Google My Maps, exported as KML/KMZ data.
- `https://www.googleapis.com/auth/dataportability.saved.collections` — saved collections that can include items saved from Google Maps/Search.

Google's Maps portability schema also documents exported Maps objects such as pinned/commute trips, including ordered place visits, destinations and transportation modes. Enable only resource groups that are approved and exposed for the Voyage Google Cloud project during onboarding/verification.

## Other supported ingestion paths

1. Google Maps shared route URL supplied by the user.
2. Google My Maps KML/KMZ export.
3. Saved collections export.
4. Pinned trips / Maps export returned by Google Data Portability.
5. Manual list as fallback.

## Pipeline

```text
Google authorization / shared link / exported file
    -> source validation
    -> GoogleMapsPortabilityNormalizer
    -> ExternalItineraryImport
    -> place resolution (Places provider)
    -> time/distance matrix (Routes provider)
    -> TripGraph / Trip Planner
    -> optimized Voyage itinerary
```

## Privacy and behavior

- Authorization must be incremental and separate from Google Login and Gmail authorization.
- Never scrape private Google Maps pages, cookies or browser sessions.
- Imported data is a user-authorized copy; Voyage must preserve provenance and imported-at timestamps.
- Do not silently edit or delete the user's source Google Maps content.
- The user can choose which imported map/list becomes part of a Voyage trip.
- A shared link that cannot be safely resolved remains `NEEDS_PROVIDER_RESOLUTION`; Voyage must not guess its stops.
- Imported places may be reordered by the planner only in a new Voyage plan version; the original imported order remains available for comparison/rollback.

## Current implementation

`src/google-maps-portability.mjs` provides:

- capability/scopes contract;
- shared Google Maps URL validation;
- KML placemark normalization;
- Saved collections CSV normalization;
- pinned-trip export normalization.

The next production step is the OAuth/Data Portability job flow in the backend once the Google Cloud project and scopes are authorized.
