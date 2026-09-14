# RNDS + CIVP integration strategy

Verified against official Brazilian sources on 2026-09-07.

## RNDS access reality

The official RNDS/DATASUS FAQ states that RNDS integration is available to hospitals, clinics, laboratories, other health establishments, state/municipal health secretariats, and developers working on health systems that need interoperability. The establishment must have a valid CNES and request API credentials through the DATASUS Service Portal.

The access path is:

1. choose the relevant portfolio in the DATASUS Service Portal;
2. sign in with Gov.br;
3. request access to the homologation environment;
4. provide the institution/developer information required by the portal;
5. use an ICP-Brasil digital certificate for authentication;
6. complete integration tests in homologation and collect the required evidence;
7. submit the evidence for analysis;
8. after approval, request production access.

RNDS currently lists the RIA portfolio for integration of campaign, routine and clinical-study immunization records. RIA uses HL7 FHIR resources including `Bundle`, `Composition` and `Immunization`.

### Product implication for Voyage

Voyage must not make its public launch depend on direct RNDS access. A standalone consumer travel app is not clearly described by the official material as an independently eligible health establishment. Direct access should therefore be treated as an institutional/regulated integration track, potentially requiring a CNES-qualified health partner or explicit authorization from DATASUS/Ministry of Health.

Until such authorization exists, Voyage should use user-controlled import of vaccination documents/certificates rather than attempting to query sensitive RNDS records indirectly.

## Brazilian CIVP guidance

For yellow fever, the official Brazilian flow is:

1. Check Meu SUS Digital first (`Minha Saúde` → `Vacinas`) for the International Certificate of Vaccination/Prophylaxis (CIVP).
2. If it is not available there, use the official Gov.br CIVP request service.
3. For the fallback request, the official service asks for CPF and a legible vaccination proof showing personal identification, yellow-fever vaccine, vaccination date, vaccine batch, professional signature and identification/stamp of the health unit.
4. After approval, download the certificate from the government request area and keep an offline copy for travel.

Important official rules implemented in Voyage guidance:

- yellow-fever ICVP travel validity begins 10 days after vaccination;
- once valid and properly issued, the yellow-fever CIVP is valid for life;
- the Anvisa guidance says a fractionated yellow-fever dose is not accepted for CIVP issuance;
- destination and transit-country requirements must be checked before travel;
- medical eligibility/contraindication decisions are outside Voyage and must be handled by an authorized health professional.

## Voyage implementation

Server-side guide:

- `GET /api/v1/travel-health/civp/br/capabilities`
- `POST /api/v1/travel-health/civp/br/guide`

The guide supports these states:

- `CHECK_MEU_SUS_FIRST`
- `READY_TO_DOWNLOAD`
- `REQUEST_ON_GOV_BR`
- `NOT_VALID_BY_TRAVEL_DATE`
- `DOSE_REVIEW_REQUIRED`
- `VACCINATION_NEEDED_OR_REVIEW`
- `CLINICIAN_REVIEW`
- `SPECIAL_CASE`

The mobile UI should present the official path step-by-step and offer a secure user-controlled option to store the resulting certificate offline in Voyage. Health data must remain product-scoped and must not be shared with CrewCheck merely because backend infrastructure is shared.
