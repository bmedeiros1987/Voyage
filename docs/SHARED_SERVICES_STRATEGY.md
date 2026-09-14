# Voyage shared services strategy

Voyage and CrewCheck remain separate products, but they should reuse compatible backend integrations when this avoids duplicated providers, credentials, cost and operational risk.

## Core rule

Before adding a new external provider to Voyage, evaluate whether CrewCheck already exposes the required capability through a versioned shared service.

Resolution order:

1. Eligible CrewCheck shared service.
2. Existing Voyage-native service.
3. New provider evaluation only when neither existing path is suitable.

## Suitable shared capabilities

Typical infrastructure candidates include:

- flight status and airport operations;
- terminal, gate and baggage carousel data;
- weather;
- route and traffic intelligence;
- map/place providers;
- notifications;
- public transit;
- currency data.

A provider contract or service must explicitly permit Voyage usage before it is treated as reusable.

## Personal data isolation

Sharing infrastructure never means sharing user-context data between products.

Gmail, Calendar, payment, identity and other user-context integrations may reuse provider contracts, backend code and deployment infrastructure only when:

- Voyage obtains its own product-specific user consent;
- tokens and authorization context are scoped appropriately;
- data remains request- or product-scoped;
- CrewCheck personal data is not silently exposed to Voyage and vice versa.

## Secret handling

Provider keys and credentials stay on the server. Capability discovery may expose service name, provider, status, version, supported capabilities and freshness, but never API keys, tokens, passwords or raw credentials.

## Availability and freshness

A shared service should not be selected blindly. The router evaluates health, freshness, sharing policy and isolation before using it. A down, stale or policy-ineligible CrewCheck service may fall back to a Voyage-native capability when one exists.

## Architectural direction

The preferred long-term pattern is:

`External provider -> versioned integration service -> CrewCheck / Voyage`

Product-specific business logic remains above that layer. For example, Cirium may supply the same operational flight facts to both products, while CrewCheck turns them into crew operational context and Voyage turns them into passenger connection, baggage and airport-navigation guidance.
