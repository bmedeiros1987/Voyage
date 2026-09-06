# Google compliance readiness — Voyage by CrewCheck

## Public identity

- Product: **Voyage by CrewCheck**
- Homepage: `https://crewcheck.online/voyage`
- Support: `contato@crewcheck.com.br`
- Authorized domain target: `crewcheck.online`

## Incremental authorization

### Stage A — sign in

Request only:

- `openid`
- `email`
- `profile`

This grant creates or links the Voyage identity. Gmail is not required to use Voyage.

### Stage B — optional Gmail Travel Intelligence

Request only after the user explicitly chooses to connect Gmail:

- `https://www.googleapis.com/auth/gmail.readonly`

The intended use is to detect, structure and keep current travel-related reservations and changes.

## Restricted data controls

- Never expose Google access or refresh tokens to browser/mobile code.
- Encrypt refresh tokens at rest with a key stored outside the database.
- Never commit tokens, client secrets or production keys.
- Avoid logging email bodies, authentication headers, confirmation documents or tokens.
- Prefer storing structured travel facts plus source references over long-term retention of complete message bodies.
- Ignore and discard irrelevant personal email content.
- Provide explicit Gmail disconnect/revocation controls.
- Provide account/data deletion controls.
- Record scope/purpose/policy-version consent evidence.
- Use push/history synchronization when enabled rather than repeatedly rescanning the full mailbox.

## Verification preparation

Before production access to restricted Gmail scopes:

1. Verify `crewcheck.online` ownership.
2. Publish public Voyage homepage, privacy policy, terms and data-deletion pages.
3. Ensure branding matches the OAuth consent screen.
4. Prepare a scope justification for `gmail.readonly`.
5. Record a verification demo showing sign-in, optional Gmail grant, travel extraction, disconnect and deletion.
6. Complete any Google-required restricted-scope security assessment before public production use.

## Placeholder protection

The backend treats `value`, `changeme`, `placeholder`, empty strings and similar values as **not configured**. Google/Gmail routes must remain disabled until valid credentials and encryption material exist.
