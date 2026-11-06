# Oxygen production preparation — 1 November 2026

Current merge-versus-enable requirements and open owners/evidence are tracked in [release gates](RELEASE-GATES-2026-11-04.md). Historical snapshots below are not current-head approval or production enablement evidence.

## Verified and still disabled

Existing production partner credentials are installed as sensitive Production-only variables in Vercel project `baci`. Read-only partner login and bank listing succeeded. Values, authentication tokens and customer identity are excluded from this document. No production financial request or deployment was made.

`runtime-configuration.ts` selects fixed provider origins from deployment environment. Production requires an explicit runtime flag, separate restricted-worker credentials, separate encryption key and exact hosted-page allowlist. Missing configuration closes access; production never falls back to staging secrets. Environment-aware web execution and recovery contracts are now prepared and rollback-tested. Do not enable the flag until deployment configuration, provider-host confirmation and the remaining review gates below are satisfied.

## Canonical activation recovery

The completed current staging activation was saved in a one-use trial ledger while the shared workflow still said `payment_required`. The append-only reconciliation migration copies only existing, exact-reference `ACTIVATED` evidence into the canonical workflow. It does not call Oxygen. Ownership, environment, enabled worker binding, order validity, booking reference and amount are checked again. Repeated reconciliation is idempotent.

A GET only reads status. POST skips provider activation when activation is already stored and performs only reconciliation. Callback recovery follows the same rule. Reopened canonical activated applications go directly to order confirmation without showing earlier OTP, signature, payment or indeterminate approval controls again. Earlier attempt evidence remains unchanged.

Customer order details show confirmed upfront payment, active plan and saved payment dates separately. These facts do not establish merchant settlement or individual monthly repayment status. Reconciliation deliberately leaves merchant payment status, inventory, shipping and settlement unchanged. In this repository `bnpl_approved` participates in funded-order finalization; it must not be set merely because a plan activated.

## Original production preparation checklist (enablement gates remain open)

1. Integrate the full preserved checkout patch with current main and refresh draft PR #3801. Resolve conflicts without replacing current-main security or performance fixes. Run required CI and current-head review. CodeRabbit review is currently blocked by exhausted allowance/unassigned organization seat; this is not a passed review.
2. Review and apply the prepared environment-aware bindings, runtime policies, snapshot/context schemas, draft storage, saved-plan and diagnostic contracts. Provision the restricted worker and encryption key through the approved secret process. Do not reuse the local portable runtime or grant service-role access to customer routes.
3. Apply and configure the prepared durable, expiring, single-use phone handoff to replace the loopback bridge and temporary tunnel. Keep signed Oxygen URLs and identity data out of logs/model context. Confirm exact production selfie and payment hosted domains before allowlisting.
4. Configure a stable HTTPS Oxygen webhook receiver with authenticated, durable, idempotent ingestion. Register it for the documented events, observe receipt and reconciliation, and retain status recovery. An iframe closing or redirect alone is not payment confirmation.
5. Review, apply and configure the new exact-reference, durable activation orchestration after server-confirmed upfront payment and repayment setup. Existing authorized staging trials remain isolated; the UI no longer independently starts them. Preserve indeterminate-request fences. Settlement remains a separate operation and must not be invoked by this orchestration.
6. Confirm Oxygen's authoritative repayment-history and merchant-settlement contracts. Do not label scheduled repayments paid or release fulfilment based on unconfirmed settlement assumptions.

Before enabling customer execution or activation, an owner must provision an authenticated external callback-drain schedule, verify a scheduled invocation against the serving deployment, and prove that a queued synthetic callback is reconciled. The drain flag alone does not prove a scheduler exists or that the backlog is healthy. The patch now includes a five-minute VPS schedule and an oldest-pending-age failure signal, as described below; deployment, actual scheduled execution and operator alert delivery remain unverified. Establish a named operations owner before customer enablement. Until then, keep customer execution and activation disabled. Do not infer a successful drain from the endpoint's HTTP 200 alone.

The append-only Oxygen runtime migrations use guarded `pg_get_functiondef` replacements: each expected source fragment is checked and missing fragments abort the transaction. This is fail-closed but formatting- and PostgreSQL-version-sensitive; a present fragment alone is not proof that every intended replacement was unique or semantically correct. The focused chain has been exercised in rollback on isolated PostgreSQL 17.6, not persistently applied or validated on the production database. Before migration rollout or customer enablement, the full chronological replay must pass on the supported target version and the resulting functions and grants must be inspected; investigate any mismatch rather than bypassing the guard. A future reviewed append-only migration may replace these dynamic patches with canonical function definitions; existing migrations must remain immutable. The unmerged PR-only `oxygen_current_paid_activation` migration was moved from colliding version `20261101150000` to `20261101150001` with its SQL bytes unchanged, leaving main’s inventory migration untouched. A read-only check found neither version in the isolated staging migration ledger; it does not establish history in any other database. Confirm target ledger/history before any migration rollout.

Deploy only after the review/release gates pass, using the repository prebuilt VPS flow. Start with customer execution disabled, verify the serving deployment SHA/configuration/webhook routing, then arrange one explicitly authorized live purchase. Production observation and customer enablement remain outstanding.

## Local checks

Focused reconciliation, API, callback, UI, runtime configuration and provider tests passed. The isolated database rollback test exercises owner denial, wrong reference, indeterminate evidence, canonical projection, idempotency and preservation of merchant payment status and earlier commands. Affected lint/typechecks passed; six existing unrelated lint warnings remain. No full monorepo test loop was run.

## Preparation snapshot

A separate managed worktree now contains the preserved checkout changes integrated with current main. The original detached checkout and its staging/unstaged/untracked state were retained. Generated PDF/screenshots, Supabase CLI scratch state and unrelated agentic-checkout planning documents were excluded from the release patch, not removed from the source. Thirteen overlapping files were resolved while retaining main's cart-capacity gates, shared-cart order binding, OTP theme/focus/expiry-advisory/cooldown behavior and CSP social integrations.

The isolated current order has now been reconciled: canonical stage `activated`, booking status `ACTIVATED`, payment/setup flags true. Its activation evidence count remained two, merchant payment status remained unchanged and shipping remained pending. Reopening the actual checkout automatically navigated to Order Confirmed. No new activation request was necessary.

Integration main revision: `77654b019b591fd630b7726efc5bc4bd112fad15`.
The integration has not been committed, pushed, merged or deployed. Current-head external review and final integration validation remain release gates.

Final preparation checks: affected lint and all web typechecks passed on the integrated worktree (11 existing unrelated warnings). The initial 110-test integration group passed; follow-up API/history/security tests and the corrected 30-test shared-cart file passed. The final 15-test order-details group passed, including Oxygen-managed funding wording and authoritative refund status. No full monorepo test suite or deployment was run. CodeRabbit returned the same account-seat/quota error; review remains incomplete, so no commit/push was made.

## Durable phone handoff prepared, not enabled

The new handoff uses a short-lived, single-use capability in the QR URL fragment. Signed Oxygen targets are encrypted with application, workflow, environment and capability binding before storage. The authenticated laptop may issue only for its owned, current application; the anonymous phone exchanges the capability through a restricted worker. Exact configured HTTPS provider hosts are checked before redirecting. A replacement QR revokes the earlier unused capability. Expired, replayed or changed-application links fail closed. The phone opens Oxygen directly without an extra continuation button.

The append-only migration has been tested inside an isolated staging rollback, not installed persistently. Focused handoff, route, configuration, encryption, UI and existing runtime tests passed (48 tests). QR generation runs on the server and is loaded only when issuing a QR. The minimal dependency lock change passed a frozen install. No new handoff flag, origin, provider host, worker or encryption secret has been enabled or provisioned. The serving local checkout still uses its existing runtime; these changes are preparation code, not a deployed replacement.

Required per environment: `OXYGEN_<ENV>_DURABLE_HANDOFF_ENABLED`, `OXYGEN_<ENV>_HANDOFF_ORIGIN` and `OXYGEN_<ENV>_SELFIE_HOSTS`, plus that environment's existing runtime encryption key and restricted worker. The handoff origin must be the platform HTTPS origin serving `/auth/oxygen-selfie`; merchant custom-domain auth redirects are not an interchangeable origin. Leave configuration absent until runtime environment contracts and actual provider hosts are verified.

Draft minimization applies to drafts saved with a separate residential ciphertext. Existing drafts without that copy retain their identity ciphertext for address recovery until address completion or expiry cleanup. Before production rollout, reconcile or wait for those legacy drafts to expire and verify the expiry cleanup job is operating; do not claim immediate removal of identity data from legacy rows.

The current browser policy treats `OXYGEN_<ENV>_HOSTED_HOSTS` as the complete set of permitted hosted-frame origins, including both payment and selfie hosts. `OXYGEN_<ENV>_SELFIE_HOSTS` is a narrower camera-enabled subset: each selfie hostname must also appear in `HOSTED_HOSTS`, even when it differs from the payment hostname. A hostname present only in `SELFIE_HOSTS` is ignored, so the selfie cannot open. Confirm both exact provider hosts before configuring either list; this intersection does not restrict the payment frame to payment-only hosts. Separating those permissions requires a coordinated CSP and runtime policy change. A mismatch emits the static `oxygen_selfie_host_configuration_mismatch` operational error once per runtime instance, without logging hostnames; update both lists after verifying the provider hosts. Other configured payment and recovery paths remain available.

## Live provider contract checked on 1 November 2026

The official [Support APIs](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis) document one webhook URL per partner for address, transaction and settlement events. Registration supports API-key header authentication; custom headers are not applied by the sender. A transaction callback's `loan_request_reference` identifies the booked reference. Treat it as a reconciliation hint, then read split-payment confirmation and require both upfront payment and repayment setup before activation. Neither that callback nor activation proves merchant settlement.

The same documentation explicitly states that there is no separate selfie or NIN callback. Continue polling authoritative KYC status for selfie completion. The [KYC documentation](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/kyc-and-address-validation) describes generating a selfie URL for the current application. These retrieved pages do not establish fixed production selfie or payment hostnames; do not infer an allowlist from staging or illustrative URLs.

Durable webhook ingestion already exists in the preserved integration. A bounded recovery endpoint and general activation orchestration are now implemented as described below; external scheduling, registration and rollout remain outstanding.


## Terra finalization pass

Four Terra agents implemented and independently inspected environment isolation, callback recovery, activation and UI completion. New migrations (in order) are `20261101190352`, `20261101190410`, `20261101190557` and `20261101192257`. These add binding-derived workflow environments; environment-bound response evidence, approval timing, callback recovery, saved plans and diagnostics; and a separately gated general activation ledger. No configuration or database policy enabling execution was created.

Activation requires both an environment-specific `OXYGEN_<ENV>_AUTOMATIC_ACTIVATION_ENABLED=true` server flag and an enabled `oxygen_private.general_activation_policy` row. That table starts empty. An exact-booking status result must confirm both prerequisites, match the workflow version and be no older than ten minutes. The durable claim precedes the provider request. Executing or indeterminate claims are never replayed and fence conflicting workflow/resend operations. The response is encrypted before canonical projection; activation does not mark merchant funding, fulfil inventory or invoke settlement.

Both the callback handler and customer payment-status recovery reach the shared activation boundary. The ordinary payment-setup refresh performs a fresh status check into the recovery ledger before activation. Incomplete payment and disabled/pending activation defer the callback; deferred events get a fresh status-check retry key. A callback left queued after canonical activation completes without another provider request. The UI polls canonical saved status with bounded, visibility-aware reads and uses the existing order-confirmation redirect. The previous frontend staging activation-trial mount was removed.

`GET /api/cron/oxygen-callback-reconciliation` authenticates with the existing cron secret before runtime construction, defaults off unless `OXYGEN_CALLBACK_DRAIN_ENABLED=true`, and drains at most the existing two-provider-read budget. Individual failures remain queued. A 200 means the pass ran, not that the backlog is empty. The VPS deployment definition schedules an authenticated pass every five minutes; deployment, runtime configuration, backlog alerting and end-to-end delivery still require verification. Next request-lifetime scheduling remains the immediate wake-up, with this endpoint as recovery.

When the oldest pending callback is at least 15 minutes old, the drain returns
`503` with code `oxygen_callback_backlog` after its bounded pass. The VPS
runner exits nonzero and logs that code without customer data. This is a
monitoring signal, not proof that an operator was notified: configure and test
an alert on the cron failure/log before enabling the production drain.

Local validation: 111 focused integration tests passed; additional focused activation and UI tests passed after review fixes. Web lint and typechecks passed (11 existing unrelated warnings). Isolated rollback validation covered the new environment and activation contracts, evidence, payment recovery, callback recovery, approval timing, address callbacks, saved plans, cache failure and booking blocks. No persistent migration or provider mutation occurred.

Internal review found and corrected incomplete-callback retirement, missing recovery environment binding, staging evidence-key selection, competing frontend activation and already-activated callback recovery. CodeRabbit's whole-patch attempt failed its 150-file limit (582 selected files); a smaller backend attempt then failed the exhausted included-review allowance/unassigned organization seat. External review is incomplete. Do not bypass it or describe this patch as reviewed for release.

Still required: confirm exact production selfie and payment hosts; configure and verify the embedded selfie allowlist plus checkout CSP/camera permissions for those exact hosts; provision separated runtime/worker/encryption/callback settings; apply reviewed migrations; register the stable authenticated receiver and external schedule; pass current-head review and CI; and verify a disabled serving deployment before an authorized live purchase. The embedded selfie component uses the environment-specific exact origins described above; actual production hosts remain unconfirmed and unconfigured. Chat/agentic execution, local draft reuse and operator trial helpers remain intentionally outside this web production scope.


Provider confirmation to request before rollout: the exact production selfie page origin, exact production upfront-payment and repayment-setup origins (including any embedded checkout host), and a sanitized successful activation response showing field names/status/reference binding. Existing staging activation evidence remains the implementation reference until independently confirmed. No bearer tokens, signed URL query strings or customer identifiers are needed in that reply.


## Documentation recheck for the review PR

On 1 November, the live Markdown pages were retrieved successfully (the HTML/browser fetch had failed): [booking and activation](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/loan-booking-and-activation.md), [authentication](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/authentication.md) and [KYC](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/kyc-and-address-validation.md). The documented activation success includes the exact booked `loan_reference` and `status: "ACTIVATED"`, matching the implementation. The independent response-shape documentation gate is therefore resolved; actual production observation is still outstanding.

The authentication page lists `https://api.theoxygen.com/services/partners/`. A redirect-disabled read-only login using the supplied production credentials returned HTTP 400 there; the currently configured `https://api.oxygenx.africa/services/partners` returned login HTTP 200 and bank-list HTTP 200 (18 banks). Retain the currently verified fixed origin and record this documentation discrepancy for Oxygen. No request body, token or secret is committed; only HTTP status/count metadata is saved privately. No financial endpoint was called.

The selfie example uses `develop.d30bxii7anj4d3.amplifyapp.com` without establishing that it is a fixed production host. Payment URL examples use `payments.example.com`. These samples do not resolve the production hosted-page allowlists. Keep them unconfigured and execution disabled until the actual production origins are confirmed. This does not prevent opening a draft PR for CI and review.


The review PR snapshot is based on main `a8f29ecf89d9a6d11fdf3cd56f8c7daaad7936e5`; the source production-prep checkout's HEAD, staged patch, unstaged patch and status were verified unchanged after copying. A focused scan of all 703 initial changed source paths found no JWT, signed-token query, private key, provider live key or credential-URL patterns. This is a pattern scan, not a guarantee or replacement for CI secret scanning.

The narrower CodeRabbit backend review subsequently completed successfully. It raised three issues: one major token-cache expiry/failure bug, one minor uncertain-error classification bug, and one row-validation improvement. All three were verified and fixed with failing-then-passing regression tests; the follow-up focused group passed 60 tests. This was a scoped review, not whole-patch approval. Full PR CI/review and production rollout gates remain open.

## 5 November 2026 contract update: selfie callbacks

The current official Support APIs now document `selfie_status_update` with
`phone_number`, original `loan_request_reference`, and boolean `selfie`.
Automatic verification emits success only; manual review may emit true or false.
This supersedes the earlier no-selfie-callback observation above. The receiver
queues these hints separately from address events, binds both phone and exact
application reference under the configured partner/environment, and reads KYC.
Callback fields never directly mark verification complete or authorize activation.
Polling remains available when delivery is delayed or unavailable.

Production enablement still requires verified worker bindings, exact production
hostnames, callback registration, and serving deployment validation. This hotfix
adds callback compatibility; merging it does not enable those policies.
