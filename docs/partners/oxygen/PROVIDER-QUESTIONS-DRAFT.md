# Provider question pack — DRAFT (user sends; agent sends nothing)

Dated 6 October 2026. Purpose: get Oxygen's contract answers, now the
critical path — no further isolated helper is planned until answers land
(see `S04-DESIGN.md` answer → build map). Paste into the EXISTING partner
thread; do not open a new channel. Detailed closure criteria per item live in
`CONTRACT-REGISTER.md` (CR-01…CR-15).

---

Subject: Baci integration — request for sandbox access + open API contracts

Hello Oxygen team,

Baci has built and mock-tested partner-login helpers, conservative eligibility
response handling and a pure availability policy against your public GitBook docs.
These remain unwired; no sandbox or financial journey has been verified. We have now verified login and bank lookup with production-dashboard keys at
`https://api.oxygenx.africa/services/partners/`; the returned token expiry was 300
seconds. This is a limited live check, not sandbox or financial journey acceptance.
To connect it to sandbox and proceed, we need the items below. A single authoritative reply
per group is ideal; pointers to corrected doc pages work where they exist.

**1. Access (blocks authenticated test calls)**
- Partner API access for `j.bassey@ogabassey.com` in Development and Staging
  (dashboards show no API menu), with test credentials delivered securely.
- Exact API base URL per environment (Dev/Staging/Production).
- Token lifetime guarantees, rotation procedure, and rate limits/backoff.

**2. Test fixtures (blocks sandbox validation)**
- Test identities, OTPs, and fixtures covering: eligibility yes/no/pending,
  KYC pass/fail, booking, approval, activation, cancellation, webhook retry,
  and settlement timing. A support owner/contact for the sandbox phase.

**3. Money, offer, and fulfilment (blocks booking + dispatch)**
- Amount unit and currency; whether `loan_amount` is gross invoice or
  financed principal; equity amount/collection/refund; tenure unit and
  options; multiple products per booking.
- How we retrieve the authoritative offer/repayment schedule (principal,
  fees, instalments, total, expiry, terms version) and record acceptance.
- The exact event/status that authorizes device dispatch; full-invoice
  settlement timeline, beneficiary, reference, reversals, and refund rules.

**4. Recovery and events (blocks safe retries + webhooks)**
- Authoritative loan/settlement status endpoint (statuses, fields) and
  per-endpoint idempotency for create/book/approve/activate/cancel.
- Webhook event types, payload schemas, event IDs, delivery auth (exact
  header / signature algorithm + signed bytes), retries, acknowledgement,
  replay retention, and registration lookup/rotation.
- Please confirm corrections for three doc samples: loan-cancel rejects
  `BOOKED` though prose allows cancel-after-booking; the webhook-update
  sample is malformed (`active` inside headers, unclosed brace); the
  OTP-retrigger response sample is invalid JSON.

**5. Account mapping (blocks multi-merchant design)**
- Partner vs merchant model: how merchant references are provisioned and
  bound to payout beneficiaries; whether one Baci partner may host multiple
  merchants; webhook ownership across merchants.
- Customer journey: required/optional fields for new/existing customers, stable
  branch codes, origin of the new-user validation token, OTP expiry/attempt limits,
  KYC sequencing/status values, document limits and hosted-page return/expiry rules.
- Eligibility: full positive/negative/pending/error schemas, polling interval/maximum
  duration, decision validity and credit-limit scope across concurrent applications.
- Hosted-vs-API capabilities for electronics BNPL; whether bank statements are needed
  and who collects them. If partner action is required, please supply the consent,
  link/upload, processing-status and failure contracts.
- Activation: the booking page introduction describes BNPL equity versus cash-loan
  repayment setup differently from its flow notes. Confirm exactly which completed
  checks are required for BNPL activation and how we verify them.
- Territory basis (residence/delivery/merchant), permitted states, consent/retention
  responsibilities, application/booking expiry and stock-unavailable handling.

Thank you — these answers directly schedule our build. Happy to jump on a
call for groups 3–5 if faster.

---

## What each group unlocks (for Baci-side prioritization)

| Group | Unlocks |
| --- | --- |
| 1. Access | Any authenticated call; transport wiring tests |
| 2. Fixtures | Sandbox validation runs |
| 3. Money/offer/fulfilment | Booking, offer UX, dispatch + accounting |
| 4. Recovery/events | Safe retries, webhooks, reconciliation |
| 5. Account mapping | Connection schema, readiness resolver, route Phase A |

Record dated answers in `CONTRACT-REGISTER.md` as they arrive; close each CR
only against its stated evidence.


## Authentication follow-up correction

Production login and authenticated bank lookup now succeed at `api.oxygenx.africa`.
Do not include the earlier invalid-credentials escalation: those tests inadvertently
used browser redaction markers. Request remaining environment mappings and contracts
without claiming that the production key pair fails.
