# Voyage Planner Brain

## Objective

Voyage should plan a trip like a careful travel coordinator, not like a search result page. It must understand what the user wants, protect fixed commitments, use verified facts, group places intelligently, reserve time for human needs, explain important choices and repair the plan when reality changes.

## Planning method

Every automatic plan follows the same doctrine:

1. **Understand intent** — what would make this trip worthwhile for this user?
2. **Establish ground truth** — dates, reservations, imported PDFs/Gmail facts, Google Maps/My Maps places, hotel, work and transport.
3. **Lock hard anchors** — flights, tickets, fixed meals, work, meetings, tours and user-locked items.
4. **Shape each day** — arrival, full sightseeing, work, transfer, recovery or departure day.
5. **Discover candidates** — attractions, restaurants, cafés, activities, gyms, coworking and other relevant places.
6. **Cluster geographically** — avoid backtracking and excessive dead travel.
7. **Place meals/work/rest** — meals, sleep, recovery, work and free time are first-class constraints.
8. **Optimize route and time** — use real route/time data when available.
9. **Verify feasibility** — opening hours, duration, transition time, reservation windows and return margins.
10. **Stress test** — likely delays, weather, traffic, fatigue and uncertainty.
11. **Explain** — show why material choices were made.
12. **Monitor and replan** — repair the smallest affected scope when something changes.

## What the planner optimizes

Priority is lexicographic where needed: a high-rated attraction never justifies missing a flight or fixed reservation.

The objective considers:

- hard-constraint compliance;
- actual feasibility;
- must-do items;
- user interests and stated wishes;
- verified quality/reviews with provenance;
- route efficiency and geographic clustering;
- meal timing and food preferences;
- work obligations;
- sleep/recovery/free time;
- fitness/wellness wishes;
- accessibility;
- budget;
- weather suitability;
- group preferences;
- resilience to disruption.

## Google Maps and imported places

A place imported from Google Maps/My Maps is treated as a strong signal that the user cares about it. It receives a ranking boost, but it is not automatically immutable. The user can pin/lock it when it must stay.

This allows Voyage to improve an existing user-created map rather than replacing it blindly.

## Day types

### Arrival day

Keep the schedule light, absorb arrival uncertainty, prioritize transfer, check-in, food and orientation.

### Full day

Use geographic clusters, meals and realistic transitions according to the chosen pace.

### Work day

Work is the primary anchor. Fit food, fitness and nearby leisure around it.

### Transfer day

Treat the transfer as the main event and avoid fragile bookings around it.

### Departure day

Protect the airport/station/terminal margin. Only suggest low-risk nearby activities before departure.

### Recovery day

Reduce stop count, increase buffers and protect sleep/rest.

## Free time

Free time is a legitimate itinerary item. Voyage should not fill every available minute simply because another attraction exists.

Default guidance:

- relaxed: about 150 minutes/day intentionally unscheduled;
- balanced: about 90 minutes/day;
- intense: about 45 minutes/day.

These are planning defaults, not hard rules.

## Learning

Voyage can learn from:

- explicit preferences;
- places pinned/unpinned;
- accepted/rejected suggestions;
- visited/skipped places;
- ratings;
- manual itinerary edits.

Explicit statements have higher confidence than inferred behavior. Inferred behavior decays over time and never silently overrides an explicit hard preference.

All learning is reversible.

## Explainability

Material automatic decisions should store:

- inputs/facts used;
- selected option;
- meaningful alternatives;
- rationale;
- confidence;
- provenance;
- whether the choice is reversible.

Examples:

- “Moved lunch to Trastevere because your next two saved places are there; this removes 38 minutes of backtracking.”
- “Did not schedule this museum today because the opening window is unverified.”
- “Removed one optional stop after the delay so the 19:30 show remains protected.”

## Replanning doctrine

When reality changes, repair the smallest affected scope first.

- delay/running late: preserve next hard anchor, remove lowest-value optional stop, recalculate transitions;
- closure/cancellation: remove unavailable item, find a nearby equivalent, reoptimize the local cluster;
- weather: move weather-sensitive content and prefer indoor alternatives where appropriate;
- fatigue: reduce stop count, widen buffers, protect meals/rest;
- new reservation: add it as an anchor and show which items were displaced.

Voyage must show the diff rather than silently rewriting the trip.

## Failure policy

Unknown facts stay unknown. Voyage must never invent:

- opening hours;
- availability;
- ticket rules;
- prices;
- travel times;
- distances;
- ratings/reviews;
- reservation details.

If feasibility depends on a missing fact, the planner flags the uncertainty and resolves it through a trusted provider or asks only when the user is genuinely required.
