# Voyage Automatic Trip Planner

## Goal

The Voyage planner should turn a user's **real life constraints + travel wishes + imported reservations + verified place intelligence** into a realistic itinerary that can continuously adapt during the trip.

It is not a generic list of attractions. The planner is responsible for answering: **what should I do, when should I do it, how long will it take, how do I get there, what must not be moved, and what should change if reality changes?**

## 1. User preference model

The planner must learn or explicitly ask only what materially changes the itinerary.

### Meals

Supported preferences include:

- breakfast at hotel;
- breakfast in recommended local cafés/bakeries;
- decide day-by-day;
- skip breakfast;
- preferred breakfast/lunch/dinner windows;
- dietary restrictions and cuisine preferences;
- target meal duration;
- budget range;
- willingness to travel for a highly rated place versus eating near the current route.

When the hotel breakfast situation is unknown and the user has not made a fixed choice, Voyage should ask a lightweight contextual question such as whether breakfast is included or whether the user wants recommendations nearby.

### Work + free time

The planner supports:

- fixed work shifts;
- meetings;
- remote work blocks;
- quiet-place requirement;
- reliable Wi-Fi requirement;
- coworking preference;
- flexible work blocks that can move around reservations;
- protected personal time;
- sleep target and recovery time.

For CrewCheck-linked crew members, Voyage may consume an explicit, consented schedule contract from CrewCheck. It must never assume that every apparent day off is available for vacation.

### Fitness and wellness

The planner may search/rank:

- gyms;
- hotel gyms;
- running/walking routes;
- swimming pools;
- yoga/pilates;
- wellness/spa;
- outdoor activities.

The user can state whether a gym is mandatory, preferred, or interchangeable with another physical activity.

### Interests and travel style

Examples:

- museums and culture;
- architecture;
- food;
- nightlife;
- shopping;
- nature;
- sports;
- family activities;
- photography;
- concerts/events;
- local experiences;
- accessible/low-walking routes;
- relaxed, balanced or intense pace.

## 2. Hard vs soft constraints

### Hard constraints

Hard constraints are not silently moved by the automatic planner:

- flights and other transport departures;
- hotel check-in/check-out rules when confirmed;
- reserved restaurant times;
- show/event tickets;
- tours with fixed entry time;
- work shifts/meetings marked fixed;
- user-locked itinerary items;
- minimum return margin for crew members;
- accessibility or medical constraints explicitly provided by the user.

### Soft constraints

Soft constraints are optimized:

- preferred meal windows;
- preferred workout time;
- desired number of activities;
- attraction ranking;
- walking versus public transport versus rideshare preference;
- cost;
- route compactness;
- neighborhood grouping;
- preferred time of day for a place;
- rest/free-time buffers.

## 3. Automatic planning objective

The production optimizer should combine multiple objectives rather than optimize only distance.

Suggested objective dimensions:

1. hard-constraint compliance;
2. opening/availability compatibility;
3. time-window feasibility;
4. user-interest fit;
5. verified rating/quality signals;
6. Voyage community signal with sample-size confidence;
7. travel time and dead-distance reduction;
8. realistic transition buffers;
9. meal/sleep/work/fitness preference adherence;
10. budget adherence;
11. group preference fit;
12. resilience to delays and uncertain travel time.

The first foundation implementation uses a deterministic preference-weighted preview. A later map provider can replace the route ordering with a time-window optimizer without changing the public planner contract.

## 4. Place intelligence and community experience

Recommendations may combine provider ratings and aggregated Voyage community signals.

Every score must have provenance and freshness metadata. Voyage must **not invent**:

- ratings;
- opening hours;
- prices;
- travel time;
- reviews;
- distance;
- availability.

When a value is unavailable it remains unknown. Unknown data may reduce planning confidence but cannot be filled with a fabricated estimate presented as fact.

Voyage community experience should be aggregated and privacy-preserving. Examples of structured tags:

- `GOOD_FOR_BREAKFAST`;
- `QUIET_FOR_REMOTE_WORK`;
- `RELIABLE_WIFI`;
- `GOOD_FOR_FAMILIES`;
- `LONG_QUEUE`;
- `WORTH_THE_DETOUR`;
- `ACCESSIBLE`;
- `GOOD_EARLY_MORNING`;
- `GOOD_AFTER_WORK`.

Raw private trip history from another user must never be exposed.

## 5. Maps and external itinerary import

Voyage should accept an itinerary from another application and improve it rather than forcing the user to rebuild everything.

Initial supported ingestion contracts:

- Google Maps shared link;
- Google My Maps / exported route where available;
- Apple Maps shared link;
- Waze shared link;
- KML/KMZ;
- GPX;
- GeoJSON;
- ICS/calendar itinerary;
- manual list of places.

Provider-specific private saved lists must be accessed only through an official API, shared link, user-provided export, or another provider-supported authorization mechanism. Do not scrape a private account.

Imported stops enter the same normalization pipeline as reservations and can then be:

- geocoded/resolved;
- deduplicated;
- reordered;
- grouped geographically;
- matched to existing reservations;
- assigned realistic durations;
- surrounded by meal/work/rest blocks;
- flagged as infeasible if travel time makes the plan impossible.

## 6. Time + distance management

Route planning should use a distance/time provider when available and consider:

- walking;
- driving/rideshare;
- public transit;
- cycling when supported;
- airport/rail station transfer complexity;
- buffer for security/boarding/check-in;
- live traffic where provider permits;
- expected versus live travel time.

A route must not be considered feasible merely because the straight-line distance is short.

When travel-time data is not available, Voyage must label the gap and avoid pretending the transition is verified.

## 7. Dynamic replanning during the trip

A future runtime planner should re-plan around new facts such as:

- flight delay/cancellation;
- attraction closure;
- rain or extreme weather;
- missed reservation;
- user running late;
- traffic/transit disruption;
- new Gmail reservation;
- user adding a new place;
- group member proposal accepted;
- fatigue / user choosing to slow down.

Replanning should preserve locked events and show exactly what changed.

## 8. Collaborative planning (Cowork)

A trip can be shared with collaborators.

Roles:

- **OWNER** — full control, invites, role management, approvals, exports;
- **EDITOR** — edits, proposes, comments, votes, exports;
- **COMMENTER** — comments, proposes and votes;
- **VIEWER** — read only.

The collaboration model uses versioned plans, proposals, comments and votes so concurrent planning is auditable.

Examples:

- one traveler proposes a restaurant;
- another votes for a museum instead;
- Voyage identifies schedule conflict;
- the owner accepts a proposal;
- a new plan version is generated without losing the prior itinerary.

Locked reservations cannot be silently overwritten by collaborators.

## 9. Group preference engine

Each traveler may have separate preferences. Voyage should detect conflicts such as:

- one person wants nightlife while another wants early mornings;
- someone requires accessibility;
- different food restrictions;
- different budgets;
- child-friendly needs;
- one person must work remotely.

The group optimizer should expose trade-offs instead of flattening everyone into an average profile.

## 10. Export

Every approved/versioned plan can produce a canonical snapshot and then export to:

### PDF

Print-friendly travel book including:

- cover and trip summary;
- daily itinerary;
- times and transitions;
- reservations;
- map/distance summary;
- budget;
- participants;
- notes.

### Word (`.docx`)

Editable itinerary with structured headings, daily agenda, reservations, recommendations and notes.

### Excel (`.xlsx`)

Suggested sheets:

1. `Resumo`;
2. `Roteiro`;
3. `Reservas`;
4. `Locais`;
5. `Deslocamentos`;
6. `Orçamento`;
7. `Participantes`;
8. `Notas`.

Exports should be generated from the same immutable plan snapshot so PDF/Word/Excel never disagree with one another.

## 11. Planner UI direction

Core screens/modules:

- **Planejar automaticamente** — asks only missing preference questions;
- **Meu dia** — timeline with work, meals, transport, activities and free time;
- **Mapa inteligente** — route, travel time, nearby alternatives;
- **Descobrir** — ranked recommendations by preference and community experience;
- **Cowork** — participants, proposals, comments, votes;
- **Replanejar** — clear diff of what changed and why;
- **Exportar** — PDF/Word/Excel.

Important UI behavior:

- locked events visually distinct;
- travel time visible between cards;
- impossible transitions flagged before the user reaches them;
- free time is intentionally visible rather than automatically filled;
- user can pin/unpin activities;
- automatic planning explains its major decisions in plain language.

## 12. Delivery sequence

### P0 — foundation now

- planner preference contract;
- meal/work/fitness constraints;
- candidate ranking;
- route-matrix-aware preview;
- external itinerary import contract;
- collaborative role contract;
- database tables for plan versions/items/proposals/comments/votes;
- export manifest for PDF/DOCX/XLSX.

### P1 — provider-backed intelligence

- place search provider;
- opening hours;
- verified ratings;
- travel-time matrix and route alternatives;
- gym/cowork/food/attraction discovery;
- weather-aware suggestions;
- persisted plan generation.

### P2 — dynamic itinerary

- live route updates;
- traffic/transit disruption;
- flight/transport event triggers;
- contextual replanning;
- notifications such as `leave now`, `lunch nearby`, `you will miss this reservation`.

### P3 — collaborative real time + exports

- invitations and permissions;
- comments/votes/proposals;
- optimistic concurrency/versioning;
- PDF generator;
- DOCX generator;
- XLSX generator;
- shareable public/private plan links.

### P4 — Voyage intelligence flywheel

- anonymized community experience signals;
- personalized preference learning with explicit user control;
- trip outcome feedback;
- recommendation quality scoring;
- group preference optimization;
- predictive planning around recurrent user habits.
