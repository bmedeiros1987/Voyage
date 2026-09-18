# Operational launch candidate

This candidate continues clean-port v3 (`ab9e547`) on main `417f475`. PR #50 is historical; #49 remains independently gated and is not included.

## Implemented
- Real-server Google OAuth routing, canonical persisted session check and revocable logout.
- Minimal web entry with configured login, PDF review, confirmed journey storage/list/read and no demo journeys.
- Authenticated owner-scoped import and journey APIs. Confirmation retries return the existing journey.
- Original extraction and user-confirmed facts remain distinct. Raw PDFs and text previews are not persisted by the new path.
- Gmail remains unavailable at the router, including callback issuance, until separately reviewed.
- Production disables demo and preview routes. Service worker does not return offline HTML for API/OAuth navigation.
- Additive schema 008 and explicit `npm run migrate:launch` for schemas 001/006/008. Requires DATABASE_URL plus VOYAGE_DATABASE_NAME matching the dedicated Voyage database; rejects a CrewCheck database name. This is not an automatic migration on startup.

## Evidence and gates
- Local HTTP E2E stubs Google only, and exercises login, PDF parsing, explicit review, duplicate confirmation, two-user isolation, logout/revocation and another login retrieving the same journey.
- Local tests: 338 passed, zero failed, one SQL integration test skipped without its dedicated database.
- CI persistence-sql uses disposable MySQL 8.4 to verify SQL adapters and pool recreation. This is compatibility evidence, not proof of production TiDB durability or a process restart.
- Browser verified the unauthenticated entry correctly shows login unavailable when unconfigured.
- Render production now directly follows main (issue #52 closed), deploy dep-dam9ie942hec738qa8jg LIVE, health OK. No candidate code deployed yet.

## Required before merge/release
1. Exact candidate SHA CI green, independent review of OAuth/identity and authorization. Identity creation now uses a transaction, with rollback on partial failure and collision; review this at the exact SHA before enabling signup.
2. Dedicated Voyage Google client configuration. Production currently reports googleLogin=not_configured. Never copy credentials from CrewCheck.
3. Verify dedicated TiDB database and apply additive migrations; execute genuine restart and cross-user E2E against it.
4. Real Google callback/session, real user-supplied travel PDF, explicit review, save, close/reopen/relogin/read. Local synthetic PDF and stub provider are not this proof.
5. Verify production entry in the browser at the gated launch SHA. Android still uses its existing shell; release signing/distribution and launch-shell parity remain a separate unmet gate.
6. The existing Render service has a linked environment group named CrewCheck. No group or secrets were modified. Audit and remove unintended inheritance only after verifying all required Voyage settings are independently configured.

Issue #53 stays open. No production-readiness claim is made by this candidate.
