# Oxygen provider contract register

Dated 5 October 2026 (Africa/Lagos). Worktree `feat/oxygen-integration` from `main@68903f4`.
Read with [the integration plan](2026-10-05-integration-plan.md) and [the agent handover](AGENT-HANDOVER.md).

## Sources re-verified for this register

- Live GitBook index and all seven `third-party-collection` pages, re-read 5 Oct 2026 via
  public `.md` URLs. Page set and endpoint inventory unchanged from the plan's account.
- Local checkout at `main@68903f4`: no Oxygen runtime code exists; the only `oxygen`
  matches are the Oxygen font-family name in MCP widget assets (unrelated).
- `/tmp/oxygen-partner-integration-guide.pdf` exists but is image-encoded (no extractable
  text with available tooling); the register does not depend on it. The plan's 5 October 2026
  reading of the June 2026 guide stands as its dated evidence.
- Resolved toolchain (from manifests/lockfile, not assumed): pnpm 11.7.0, Turborepo 2.9,
  Next.js 16.3.0, Zod v4 (^4.4.3), Vitest 4.1.9 (web), TypeScript ~7.0.2 (web/shared),
  Biome 2.5.0, Node 24.x.

Documentation samples below are illustrative request/response shapes, never complete
schemas. Nothing in this register authorises provider calls, deployment, or production use.

## Register

| # | Confirmed source (dated) | Endpoint / behaviour | Unresolved question | Blocks | Evidence required to close |
| --- | --- | --- | --- | --- | --- |
| CR-01 | GitBook overview (5 Oct 2026) publishes `https://api.theoxygen.com/services/partners/`; LIVE 6 Oct 2026: production-dashboard keys returned HTTP 200 at user-supplied `https://api.oxygenx.africa/services/partners/` (see `PRODUCTION-AUTH-CHECK-2026-10-06.md`; keys/token not saved) | Production pairing confirmed live; Dev mapping is user-supplied (`api.theoxygen.com`); Staging unknown | Dev/Staging API bases + test credentials; whether the published hostname is environment-agnostic | Sandbox/test-env calls (no test mapping yet); production use never authorized by this workstream | Dated Oxygen statement mapping each environment to its API base + test credentials delivered securely |
| CR-02 | GitBook authentication (5 Oct 2026): `POST /v1/partner/login` with `reference`+`secret`; Bearer token sample with `expires_in: 300`; LIVE 6 Oct 2026: login returned HTTP 200, Bearer, `expires_in: 300` on the production base (see `PRODUCTION-AUTH-CHECK-2026-10-06.md`) | Login + sample expiry observed live; lifecycle otherwise undocumented | Refresh/rotation/revocation API; retry guarantees; whether `reference` is also secret (guide treats both as confidential) | Production lifecycle use; does not block the mocked login adapter (S-02) using returned expiry | Documented token lifecycle + rotation procedure; reauthentication retry validation before provider use |
| CR-03 | GitBook loan-requests-and-validation (5 Oct 2026): create, existing/new validation, OTP retrigger endpoints + samples | Request/response samples incl. `loan_request_reference` and human-readable branch messages | Required/optional field matrix; new-user `token` origin; stable machine branch codes (messages are human-readable); new-user creation response schema | Phase 3 | Authoritative field matrix + machine-readable branch/status codes |
| CR-04 | GitBook kyc-and-address-validation (5 Oct 2026): selfie URL sample, address request sample, `kyc/status` sample (`address_status`, `selfie_status`) | Selfie/address/status request/response samples | Full state enums; file limits/MIME; hosted-page return protocol; token lifetimes; mobile camera support; sequencing vs booking for new/existing users | Phases 3, 4 | Complete KYC contract per question P1 row in plan |
| CR-05 | GitBook eligibility-checks (5 Oct 2026): `POST /v1/loan-request/get`; affirmative sample (`successful`, `eligible`, `eligible_amount`); 400 sample with `response_code: "99"` | Two documented shapes: affirmative eligibility and credit-score-retrieval-in-progress | Full result/error schemas; pending-code semantics beyond the one sample; polling rules; decision expiry/version; limit scope across concurrent applications; negative schema + reapplication policy | Phase 3 (full orchestration) | Complete eligibility contract per plan P0 row; fail-closed handling of unconfirmed shapes is implementable now (see slice S-01) |
| CR-06 | GitBook loan-booking-and-activation (5 Oct 2026, re-verified 6 Oct 2026): book/trigger-OTP/approve(multipart)/activate + samples (`BOOKED`/`APPROVED`/`ACTIVATED`) | Request/response samples; merchant reference for merchants under a partner | Amount unit/currency; gross vs financed principal; tenure unit/options; product multiplicity; signature encoding; approval/activation prerequisites; equity vs repayment-setup ordering (worded inconsistently). Nuance (6 Oct): book-request sample carries an `"address"` string field and the overview stepper says address verification happens after booking — sequencing signal, not a confirmed contract. | Phase 3 | Authoritative booking contract per plan P0 rows |
| CR-07 | GitBook support-apis (5 Oct 2026) samples; LIVE 6 Oct 2026: authenticated `GET /v1/eligibility/banks` returned HTTP 200 with 44 entries on the production base (see `PRODUCTION-AUTH-CHECK-2026-10-06.md`; payload not saved) | Bank-list endpoint exists live; all other support operations remain samples | Pension/name-enquiry/repayment/cancel/webhook full contracts; settlement/refund/status/verification; corrected cancel + webhook-update samples | Phases 3, 5 | Authoritative status/settlement/refund contracts + corrected cancel/webhook semantics |
| CR-08 | GitBook support-apis webhooks (5 Oct 2026): registration carries URL, api key/secret, `auth_type: API_KEY`, custom headers | Registration request/response sample | Delivered auth header; payload signature algorithm/signed bytes; event types/payloads/event IDs; retries/ack codes/replay retention; registration auth + `/api/v1` concatenation; lookup/ownership for rotation | Phase 5 (all inbound financial transitions) | Complete webhook contract per plan P0 row |
| CR-09 | None — absent from all seven pages | Bank-statement handling is undocumented | Whether statements are unnecessary, collected by Oxygen, or require a partner upload/link flow | Phase 3 completion gate | One of the three confirmed options with full contracts, or explicit not-required statement |
| CR-10 | None — absent from all seven pages | Offer / repayment-schedule retrieval and terms acceptance | Principal, equity, interest/fees, instalments, total repayable, expiry, terms version, acceptance evidence, re-approval rules | Phase 4 (informed approval) | Authoritative offer contract; no calculated/invented terms |
| CR-11 | Partner email (commercial requirement, via plan) | Full approved invoice value reaches merchant without merchant deductions | Settlement timeline, beneficiary, reference, reversals, partial refunds, delivery-failure/warranty-return treatment; ledger semantics | Phase 5 (accounting + fulfilment) | Finance-agreed settlement contract with Oxygen |
| CR-12 | None — no status endpoint in docs | Authoritative loan/transaction/settlement status lookup + per-endpoint idempotency | Statuses, amount/currency/reference fields, correlation after response loss, idempotency-key support per mutation | Phase 3 mutations and phase 5 (safe retries, recovery, confirmation) | Documented status/idempotency contract; without it, ambiguous actions stop for operations review |
| CR-13 | Plan business facts (5 Oct 2026) | Initial territory: South West, South South, South East, Abuja; electronics/gadget BNPL; Oxygen owns credit, Ogabassey owns fulfilment | Which address (residence/delivery/merchant) determines eligibility; BNPL-vs-cash selection mechanism; hosted checkout/SDK vs full Baci application | Phases 1, 4 | Dated product-scope answers; territory basis + permitted states |
| CR-14 | Plan (5 Oct 2026) | Partner vs merchant account model | How merchant references are provisioned/bound to payout beneficiaries; multi-merchant hosting under one Baci partner | Phase 2 schema | Verified account model before persistence finalisation |
| CR-15 | None | Test fixtures + non-functional contract | Test identities/OTPs, fixtures per outcome, rate limits/backoff, support ownership, privacy/consent/retention responsibilities | Sandbox calls for fixtures/rate limits; KYC collection for consent/retention | Provider-supplied sandbox pack |

## Change log

- 5 Oct 2026: initial register from live-doc re-read; CR-01…CR-15 open; no provider
  answers received in this workstream. Slice S-01 (fail-closed local decision primitives)
  proceeds on CR-05's documented samples only; all provider operations stay unavailable.
- 6 Oct 2026: live docs re-read (all 7 pages, unchanged; see RESEARCH-2026-10-06.md).
  CR-06 gains the address/sequencing nuance. All CRs remain open. Slice S-02 (login
  transport + token cache) proceeds on the CR-02 documented login sample only.
- 6 Oct 2026 (live evidence): user-authorized production-key check — login HTTP 200
  with 300s expiry + bank list HTTP 200/44 entries at the user-supplied production
  base; keys/token not saved (see `PRODUCTION-AUTH-CHECK-2026-10-06.md`). CR-01/02/07
  rows updated to partial; earlier 400 conclusions withdrawn as redaction-marker
  artifacts. No question-pack replies; all financial/journey/merchant-mapping
  contracts still open. No further live calls authorized by the current prompt.


## Dependency triage correction — 6 October 2026

Open does not mean every task is blocked. Product choices belong to Baci; missing
provider protocols block only their consumers. CR-12 is a prerequisite for safe mutation
orchestration, not merely phase-5 cleanup. CR-15 privacy/consent requirements precede
collecting identity data, not just final sandbox acceptance. CR-02's undocumented refresh
API does not preclude a local login-response/cache contract using returned expiry;
reauthentication retry semantics still need validation before provider use. The first
agent's PDF extraction failure was tool-specific; the original plan read the guide on
5 October 2026 (June 2026 is its publication/version date, not our reading date).

See REVIEW-2026-10-06.md for a short provider question list and independent next work.


## Superseded authentication observation — 6 October 2026

Correction: these requests used browser redaction markers, not actual credentials.
The conclusions below are historical and withdrawn; see the successful check below.

At the user's explicit request, current production dashboard credentials were used
for a limited login check against the published endpoint. Two calls returned HTTP 400
with `invalid login credentials`; no token was received. Environment mapping and
Partner provisioning remain unresolved. See
[production authentication check](PRODUCTION-AUTH-CHECK-2026-10-06.md).
This supersedes historical no-provider-contact statements only for this later login
check; no financial or sandbox acceptance is claimed. CR-01/02 remain open.


## Development endpoint clarification — 6 October 2026 (400 premise superseded)

The user clarified that
`https://api.theoxygen.com/services/partners/v1/partner/login` is the Development
login endpoint. Treat this as user-supplied environment mapping, not a new live
provider verification. This section's original 400 premise (real production
keys tested against this host) is superseded by the later redaction-marker
finding — no real-key call was made to this host, so nothing about key
validity or host compatibility follows from the 400s. The user-supplied
Development mapping itself stands.

CR-01 is partially clarified: this login endpoint is Development (user-supplied).
Development Partner credentials/access and Staging mapping remain unresolved.
No successful Development login or sandbox journey is claimed. Do not retry any
key pair without fresh authorization; no further live calls are authorized by
the current workstream prompt.


## Successful production pairing and correction — 6 October 2026

Actual keys retrieved with the portal Copy controls authenticated successfully at the
user-supplied `https://api.oxygenx.africa/services/partners/v1/partner/login`: HTTP 200,
Bearer token, returned expiry 300 seconds. Authenticated bank lookup on the same base
returned HTTP 200 with 44 banks. Keys and token were not persisted.

CR-01 is partially resolved for this production-dashboard key/base pairing; Development
and Staging access/mappings still require confirmation. CR-02 login and sample expiry
are now observed live; rotation, revocation and other lifecycle guarantees remain open.
The earlier 400 requests used `<redacted>` substituted by the browser DOM reader, so
they did not test the actual keys and cannot diagnose credential/environment failures.
See [corrected live check](PRODUCTION-AUTH-CHECK-2026-10-06.md).
