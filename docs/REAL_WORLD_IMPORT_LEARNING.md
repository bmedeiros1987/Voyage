# Real-world Travel Import Learning

Voyage's importer is hardened against real reservation formats using **user-authorized examples**. Raw personal Gmail messages, booking codes, identity documents, addresses, payment cards and original PDFs are never committed to the repository. Regression fixtures are synthetic/redacted and preserve only structural characteristics needed to test parsing.

## Formats observed and generalized

### Airline itinerary / e-ticket

Observed structure includes booking reference, one or more flight segments, operating carrier, IATA origin/destination, local departure/arrival time, cabin, aircraft, ticket receipts and special-service information.

Parser requirements:
- keep `BOARDING_PASS` more specific than generic `AIR_TRAVEL` when both signals exist;
- support multiple passengers and multiple segments;
- distinguish marketing vs operating carrier;
- do not treat every number as a ticket or booking reference.

### Intercity bus BP-e / boarding voucher

Observed structure includes carrier, class, origin/destination, boarding time, departure time, seat, platform, line, locator and fare components. Some PDFs repeat the same reservation in passenger and driver copies.

Parser requirements:
- deduplicate repeated sections;
- preserve boarding time separately from departure time;
- model seat/platform and fare breakdown without retaining government identifiers.

### Tour / activity voucher

Observed structure includes booking ID, activity title, date/time, participant count, language, pickup instructions/location, provider, price/payment state and cancellation deadline/policy.

Parser requirements:
- model pickup as an operational anchor for the planner;
- keep cancellation deadline as structured policy where confidently extracted;
- distinguish intermediary from actual service provider when available.

### Car-rental contract / voucher

Observed formats include both direct rental-company contracts and agency/loyalty-program vouchers. Fields can include confirmation/contract number, rental supplier, vehicle or reserved category, pickup/return date and branch, mileage policy, fuel/odometer on completed rentals, included services and totals.

Parser requirements:
- sniff `%PDF-` because some providers label PDFs as `application/octet-stream`;
- keep pickup and return as distinct timed places;
- preserve reserved/used/charged category when available;
- intentionally exclude CPF/government IDs, residential address, card number and payment authorization from canonical travel facts.

### Event / museum ticket PDF

One PDF may contain multiple individual tickets, often one page per attendee, each with an independent ticket/barcode code and shared event/time/venue.

Parser requirements:
- emit multiple ticket items rather than collapsing to one;
- keep the event reservation linked to all ticket artifacts;
- preserve fixed time window as a locked planner anchor.

### iCalendar / myIDTravel

`.ics` attachments may be sent with an incorrect MIME type such as `text/html`. One calendar event can embed an HTML table containing multiple flight alternatives/segments and standby/listing states.

Parser requirements:
- choose parser from filename + content signature, not MIME alone;
- recognize `BEGIN:VCALENDAR` / `VEVENT`;
- model standby/listed/failed/confirmed separately; never convert standby into a confirmed seat.

### Booking email body

Hotel confirmation, modification and cancellation lifecycle can live entirely in the email body without a PDF.

Parser requirements:
- parse body as a first-class travel source;
- match updates to an existing reservation instead of duplicating it;
- **cancellation requested is not cancellation confirmed**. A cancellation request remains pending until provider evidence confirms cancellation.

### Activity provider email body

Some providers place booking ID, activity, date/time, duration, price and ticket instructions directly in the email, with no useful PDF attachment.

Parser requirements:
- extract useful structured facts from the body;
- follow linked/provider details only through approved integrations, not mailbox-link scraping;
- retain provenance to the source Gmail message.

## Privacy-safe learning contract

1. Gmail is read-only and separately consented from Google Sign-In.
2. Only travel-candidate messages are fetched in detail.
3. Raw mailbox content is transient processing input whenever possible.
4. Canonical storage prefers structured travel facts, source IDs, digests and provenance.
5. Sensitive identity/payment data that does not improve the trip is not extracted into the canonical graph.
6. Repository tests use synthetic values only.
7. Unknown/ambiguous facts remain unknown or `NEEDS_REVIEW`; Voyage never fabricates them.

## Current implementation

- `src/travel-provider-parsers.mjs` — provider/format-specific extraction.
- `src/attachment-ingest.mjs` — signature/content-sniffed PDF/ICS attachment ingestion.
- `src/pdf-ingest.mjs` — generic PDF extraction + provider enrichment.
- `src/gmail-travel.mjs` — Gmail candidate classification and reservation lifecycle semantics.
- `test/travel-provider-parsers.test.mjs` — synthetic regression corpus based on structural learnings.
- `test/gmail-reservation-lifecycle.test.mjs` — cancellation-state fail-safe regression.
