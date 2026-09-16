# Manual Concierge / Wizard-of-Oz — Phase 2

This slice validates Voyage guidance before deeper automation.

It is intentionally provider-free and LLM-free. The recorder stores only the structured evidence needed to evaluate whether a recommendation saved time, reduced manual checks and remained trustworthy.

## Session lifecycle

`STARTED → GUIDANCE_RECORDED → COMPLETED`

A session records:
- pseudonymous user and optional trip id;
- the decision/question that needs orientation;
- context facts with provenance, observed time and freshness;
- declared preferences separately from inferences;
- inferences explicitly labelled with confidence;
- guidance with status, explanation, confidence, alternatives, trade-off and missing information;
- observed user outcome and validation metrics.

## Valid guidance statuses

- `ACTION_RECOMMENDED`
- `NO_ACTION_REQUIRED`
- `INSUFFICIENT_INFORMATION`

An action recommendation requires at least one recorded fact. Silence/no-action and insufficient-information are first-class valid outcomes.

## Metrics

The recorder aggregates:
- perceived time saved;
- manual checks avoided;
- helpfulness;
- correction and override rates;
- need-to-open-another-app rate;
- repeat trust;
- critical false-claim count.

Critical false-claim target is zero.

## Guardrails

- facts require provenance and freshness;
- inference never becomes fact;
- cross-user reads fail closed;
- material JSON values cannot be silently coerced;
- invalid/future fact timestamps fail closed;
- no booking, cancellation, payment or itinerary mutation exists in this slice.

## First validation scenario

GRU Terminal 2 remote-gate guidance: field-confirmed groups 214–219 and 251–254 can be communicated to passengers as `Embarque por ônibus · Portão remoto`, while exact walking minutes, bus dispatch timing and accessibility routing remain unknown unless a fresh authoritative source is available.

Refs: #40 #47.
