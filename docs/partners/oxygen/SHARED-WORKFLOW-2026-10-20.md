# Shared Oxygen workflow — 20 October 2026

The saved order-bound workflow now connects to the staging provider adapter,
verification forms and durable callback reconciliation. Web, mobile and chat use
one backend. Activation and settlement effects remain disabled.

## Implemented locally

- Five append-only migrations provide customer-readable workflow state, private
  command intent/history, provider references/results, partner-scoped worker
  bindings and a callback inbox. Customer access proves the exact order,
  customer, merchant and authenticated user. Private writes require the bound
  ordinary Auth worker; the application uses no service-role/admin client.
- Commands are claimed durably before sending to Oxygen. Executing or
  indeterminate commands are never automatically reclaimed. Repeated idempotency
  keys do not resend a completed mutation. The worker rechecks order payment,
  cancellation and amount changes. Old booking references remain in history.
- The provider adapter has a fixed staging origin and an operation allowlist.
  It supports onboarding and phone OTP, eligibility, NIN/selfie/address KYC,
  booking/details/cancellation, approval OTP/signature, and payment/setup status.
  There is no activation or settlement operation. The runtime connection also
  refuses `VERCEL_ENV=production`.
- OTPs, onboarding identity/bank fields, signatures and address-document bytes
  are transient request data. Commands persist only action/plan metadata.
  Provider activity/new-user tokens are stored in the private schema and omitted
  from customer status responses. Hosted URLs require an explicit trusted host
  allowlist and use no-referrer handoffs.
- PDF, JPEG and PNG address uploads are checked against content signatures,
  MIME and filename. Signatures accept JPEG/PNG. The application file limit is
  1.5 MB, below the existing proxy's 2 MB request limit; this is not a claim about
  Oxygen's maximum. No proxy or environment files were edited.
- Booked amounts are checked against the server order amount and selected plan.
  Suggested equity is not hardcoded: the current API accepts 25–90%, up to two
  decimals. Provider schedule rows with a null period/installment are separated
  from monthly instalments even when they have a due date. A supplied charge row
  is shown separately; missing charges are not treated as zero.
- The callback route authenticates before worker login, then persists before
  acknowledgement. Transactions correlate by booked-loan reference; address
  callbacks correlate by normalized phone within the configured partner.
  Reconciliation queries Oxygen's KYC/confirmation endpoint. Callback amount
  fields and browser redirects cannot mark a payment complete. Settlement
  callbacks are observed only and never establish receipt of funds.

## Channel entrypoints

| Entry | Contract |
| --- | --- |
| `POST /api/payments/oxygen/workflows` | Create/resume an owned staging draft with `{orderId, channel}`. |
| `GET /api/payments/oxygen/workflows/actions?workflowId=...` | Authoritative saved status, safe provider results and pending command metadata. |
| `POST /api/payments/oxygen/workflows/actions` | `{workflowId, version, idempotencyKey, command}`; JSON for ordinary actions, multipart `payload` plus `file` for address/signature. |
| `/payments/oxygen/[orderId]` | Authenticated order handoff UI. Personal data and OTPs are entered in forms, not URL parameters. |
| `POST /api/payments/oxygen/webhook` | Provider API-key/secret callback authentication; durable inbox then bounded background reconciliation. |
| `POST /api/payments/oxygen/reconcile` | Recovery/drain endpoint for the dedicated worker Auth bearer, scoped again by the database. |

Cookie requests use the existing CSRF helper; mobile/authenticated chat can use
a customer bearer token. Channel is metadata, never authority. Chat can hand off
to the same secure forms; no separate chat finance state machine is needed.
The dedicated handoff page is wired, but Oxygen has not been advertised as a
live method in the production checkout. The loopback preview on port 3432
continues to use its isolated simulation adapter.

## Hosted staging provisioned

The five Oxygen migrations are installed on Ogabassey's isolated VPS staging
PostgreSQL database. A dedicated ordinary Auth worker is bound only to the
existing synthetic staging merchant. Its disabled binding rejected access before
being enabled; scoped reads and anonymous denial were verified over HTTP.
No production database, PiggyVest gateway route or existing service was changed.

The Oxygen-only compiled Next.js application runs separately behind loopback
Nginx and a temporary HTTPS tunnel. The provider returned HTTP 200 confirming the
new callback registration. Authenticated synthetic replay is stored once; no
provider-generated callback has been observed. A worker-only timer drains retained
callbacks every two minutes and never activates a loan or settles funds.

See [deployment evidence](STAGING-DEPLOYMENT-2026-10-20.md) for the live endpoints,
operational limits and verification. The tunnel address is temporary, and the
application/gateway/tunnel systemd units are transient; this is a supervised
staging deployment rather than a durable production host.

Production remains closed. Before any separate production rollout, confirm the
checkout amount basis (the staging implementation uses the server order total),
customer terms/consent presentation, closed/paid-booking recovery and provider
support procedures. Do not auto-rebook a paid/closed booking or assume payment
carries over. There is no production activation/settlement composition here.

## Evidence and limits

- Local integration tests exercise the real adapter against synthetic HTTP
  responses through onboarding, booking, address, approval and both completion
  flags. They stop at `ready_for_activation` and assert no activation/settlement
  operation. Forms, upload validation, ownership, failure/replay and late UI
  responses have separate regression coverage.
- Disposable PostgreSQL tests replay the three new migrations with minimal
  parent/auth fixtures. They verify customer/worker/merchant isolation, private
  grants, secret projection, durable intent/results, callback correlation and
  conflicting replay. This is not a full historical Supabase schema replay or
  deployed PostgREST verification.
- A read-only live check using the new adapter and saved staging checkpoint
  confirmed all six KYC statuses `DONE` and both payment/setup flags `true` on
  the existing request. It sent no booking, approval, activation or settlement
  mutation. It does not establish an end-to-end customer payment or bank receipt.
- Supabase security advisors were run against the disposable loopback database;
  final command outputs and test counts are recorded below after verification.

Current provider sources checked for this implementation:
[booking and approval](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/loan-booking-and-activation),
[KYC](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/kyc-and-address-validation),
[onboarding](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/loan-requests-and-validation),
[callbacks](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis).

Current local validation: 678 affected runtime/form/API tests across 32 files and
11 registration-helper tests passed. Web lint and web/tool-worker TypeScript
checks passed. The five migrations passed the disposable PostgreSQL fixture and
actual staging rollback rehearsals. Hosted deployment verification and its limits
are recorded in [deployment evidence](STAGING-DEPLOYMENT-2026-10-20.md).
