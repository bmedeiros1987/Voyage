# Voyage document retention, purge and encryption policy

This document is normative for document handling in Voyage. The product must prefer structured travel facts plus provenance over retaining source documents.

## Principles

1. **Minimize by default.** A source PDF, email body, attachment or other raw document is transient input. Persist normalized facts, source identifiers/digests and review provenance when they are sufficient; do not persist raw source bytes merely for convenience.
2. **Fail closed.** Low-confidence or partial documents remain `NEEDS_REVIEW`; retention rules must never be relaxed to compensate for an uncertain parse.
3. **User ownership.** A user-initiated delete must remove Voyage-owned persisted copies and derived records that are no longer required, subject only to an explicitly documented legal or security hold. Provider-owned originals are not deleted unless the user separately requests that provider action.
4. **No hidden cross-product replication.** Embedded Voyage must not copy CrewCheck operational records into Voyage document storage.

## Raw PDF lifecycle

### PWA share target

The web share target may place one validated PDF in the dedicated `voyage-shared-pdf-v1` Cache Storage namespace solely to bridge the browser share-target POST into the running Voyage shell.

- Maximum accepted size: **15 MiB**.
- Required signature: `%PDF-`.
- Maximum cache lifetime: **30 minutes**.
- The cached entry is deleted **before** dispatching the reconstructed `File` to the Universal Travel Importer.
- Expired or malformed-timestamp entries are purged during service-worker activation and before share consumption.
- Shared PDFs must never enter the normal offline shell cache.

Cache Storage is not application-level encryption. Therefore this cache is intentionally short-lived and must not be treated as durable document storage. Long-term raw-document persistence requires authenticated encryption at rest and a separate documented retention purpose.

### Android share target

The Android share plugin reads the provider URI into memory only after enforcing the 15 MiB limit and `%PDF-` signature. After one successful consumption it replaces the share intent so foreground/resume checks cannot import the same document again. Voyage must not create a durable Android copy merely to process a share intent.

### Local importer queue (IndexedDB)

The PWA importer stores each accepted PDF in the browser's IndexedDB store
`voyage-local` so the import survives a reload and can be retried offline. This
is durable raw-document storage on the device and is governed here.

- The raw `blob` and the raw `textPreview` are transient. Structured facts,
  provenance, review reasons and the source digest are what the record keeps.
- **Synced records** (uploaded and parsed, so carrying `syncedAt` and no longer
  `LOCAL_QUEUED`) expire **30 days after `syncedAt`**.
- **Never-synced records** (`LOCAL_QUEUED` — offline device, or a backend that
  kept refusing) expire **30 days after `createdAt`**. Without this clock a
  document that never reached the backend would sit on the device forever, so
  local retention is bounded independently of any upload ever succeeding.
- Expiry removes only `blob` and `textPreview`, marks `retentionState`
  (`BLOB_PURGED` when synced, `LOCAL_BLOB_EXPIRED` when it never synced) and
  records `rawBlobPurgedAt`. It never marks the item as synced and never
  fabricates an upload that did not happen.
- An unreadable or missing timestamp never triggers a purge: a corrupt date must
  not be a reason to destroy a user's document.
- The purge runs at shell bootstrap, when the imports screen opens and when the
  device comes back online. It is idempotent — a record whose bytes are already
  gone is skipped.
- Manual entries (`application/vnd.voyage.manual+json`) carry no raw bytes and
  are out of scope for this expiry; they are user-authored structured data.

IndexedDB is not application-level encryption. Bounded local retention is the
control here; treating this store as durable document storage would require
authenticated encryption at rest and a separate documented purpose.

### API/manual upload

The foundation API ingests the request body for parsing and returns structured results; it does not define durable raw-PDF storage. Any future server-side source retention must be opt-in by an explicit product purpose, associated with an authenticated owner, encrypted at rest, assigned a bounded TTL, and covered by a purge job plus delete regression tests before release.

## Email and OAuth data

Gmail authorization is separate from Google Login and uses the least-privilege read-only scope. Irrelevant message bodies and attachments must not be retained after classification. When structured travel facts and provenance are sufficient, raw message content should be discarded.

OAuth refresh/access tokens are secrets, not documents. When persistence is enabled they must use the existing AES-256-GCM authenticated-encryption envelope with a 32-byte key supplied outside the repository. Key material, plaintext tokens and plaintext credentials must never be committed or logged.

## Retention classes

| Data class | Default retention | Storage rule |
| --- | --- | --- |
| PWA shared raw PDF bridge | <= 30 minutes; delete on consumption | Dedicated transient Cache Storage only |
| Local importer raw PDF, synced | <= 30 days from `syncedAt` | IndexedDB `voyage-local`; bytes and raw text purged, facts kept |
| Local importer raw PDF, never synced (`LOCAL_QUEUED`) | <= 30 days from `createdAt` | IndexedDB `voyage-local`; same purge, marked `LOCAL_BLOB_EXPIRED` |
| Android shared raw PDF | Memory/intent lifetime; consume once | No Voyage durable copy |
| Manual/API raw PDF | Request-processing lifetime in current foundation | No durable raw storage by default |
| Structured travel facts/provenance | Account/trip lifecycle, subject to user deletion | Authenticated owner-scoped persistence |
| OAuth tokens | Until revoked/expired/account unlink | AES-256-GCM encrypted at rest |
| Home/layout preferences | Account/device lifecycle | Must not contain document bytes or provider secrets |

## Required controls for any future durable document store

A durable raw-document store is release-blocked until all of the following exist: authenticated owner scoping, encryption at rest with managed key rotation, a documented TTL per purpose, deterministic purge processing, user deletion semantics, access logging without document contents, backup-expiry handling, and regression tests proving expiry and cross-user isolation.

A provider fact that is unknown remains unknown after purge. Retention must never be used as justification to invent missing itinerary or operational data.
