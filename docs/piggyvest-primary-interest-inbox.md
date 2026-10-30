# Primary paid-interest durable inbox

Local source, mocked provider, isolated PostgreSQL and offline package validation
only. No real provider requests, database provisioning, deployment, installation
or scheduler activation were performed.

## Parent intake contract

Import `dispatchPrimaryWalletPaidInterestInbox` from
`apps/web/src/lib/piggyvest/primary-wallet-paid-interest-inbox-intake.ts`.
Call with `{ rawBody: Uint8Array, signature: string | null, env?: ProcessEnv }`.
The caller must retain untouched bounded raw request bytes; no JSON reserialization.

- `accepted`: exact signature-verified bytes committed to private pending storage.
- `duplicate`: identical bytes already durable, whether pending or processed.
- `quarantined`: conflicting bytes and original are durable; no blind credit.
- These three outcomes can ACK **200 queued**, not credited/completed. Intake
  creates no payout, contribution, cash, completion or interest notification.
- `disabled`: explicit inbox feature disabled; parent owns legacy bridge fallback.
- `invalid_signature`: not persisted; no financial processing.
- Authenticated malformed JSON, invalid UTF-8, unknown shapes and unmapped
  interest deliveries retain their bounded exact bytes in private quarantine.
  They are evidence, not permission to credit or automatically release funds.
- Unavailable/misconfigured authority, unsafe TLS session or storage failure throws
  a redacted error; parent returns retryable 503, never a false persisted ACK.

The shared webhook verifies the signature before attempting raw interest capture,
and captures before the full event schema is parsed. Explicit interest events
without an interest-family capability return 503 rather than silently taking a
hash-only legacy acknowledgement. Known bank/custody deliveries continue through
their authorized handlers when keys overlap. Missing capture configuration or
storage failure returns a redacted 503; no direct financial fallback bypasses
capture. The previously finalized migrations remain unchanged.

## Storage and worker

Append-only 220100 stores raw payload/signature/SHA256, integration-scoped event
identity, retry/lease state and immutable conflict variants. RLS denies public,
customer and service-role access. Only the existing restricted TLS evidence
capability has enqueue/claim/finish/readiness function grants; no direct tables.
Its existing enabled authority and exact production integration/environment are
required. No new authority, provider crosswalk, eligibility or credentials are
auto-enabled. SQL trusts that restricted signed-intake capability; actual HMAC
verification occurs before enqueue and again before bridge dispatch, not inside SQL.

Append-only `20261025181703_piggyvest_primary_interest_inbox_capture.sql` extends
the same enqueue RPC and existing immutable tables; it adds no role, table or
financial writer. Recognizable, primary-involved interest envelopes enter the
existing pending workflow. Other authenticated bytes remain quarantined, using
the original safe event ID or a deterministic `raw:` SHA256 identifier when none
can be decoded. Same-ID variants preserve both bodies and invalidate an active
lease. Unmapped deliveries no longer fall through to hash-only quarantine.

Capture retains the complete body, original signature, SHA256, receipt time and
processing state. It does not log bodies or credentials, or archive arbitrary
Authorization/Cookie headers. The 64 KiB body bound remains in force. Retention
is in the existing private, RLS-denied primary inbox, not the public application
log. This is not a claim that a request rejected upstream or never delivered can
be recovered. Generic legacy-only unidentifiable traffic is outside this
interest-family capture contract.

220101 claims batches 1–10 with `FOR UPDATE SKIP LOCKED`, fresh random claim tokens
and 90-second leases. Expired leases can be reclaimed; stale finishes fail.
Prerequisite and I/O failures retain exact bytes and retry after bounded backoff
30 seconds to 15 minutes. Attempt counters saturate at 50, but unresolved valid
receipts are not silently dropped after 50 tries. Financial conflicts or invalid
economics enter durable quarantine and are never automatically released.
Changed bytes under an existing event ID preserve both versions and quarantine
the original, invalidating any lease. This cannot reverse an already committed
original payout; operator/provider reconciliation remains necessary.

`drainPrimaryWalletPaidInterestInbox` rechecks raw SHA256, HMAC, event identity and
gross-minus-tax equals net equals amount before invoking the **existing** signed,
authenticated provider-wallet bridge. The bridge still requires the exact owner-
approved customer/wallet/business crosswalk and opt-in/net allocation policy.
Its existing immutable financial dedup handles a crash after payout commit and
before queue finish. An append-only observation records event+raw digest+payout
only after `credited` or `duplicate`; SQL refuses a processed finish without that
matching durable financial observation. A lease outcome is never financial proof.
The bridge wrapper locks any corresponding inbox row and refuses pending intake,
expired processing leases, mismatched raw digests or quarantine before accounting;
an in-flight dispatch cannot bypass a newly recorded event conflict.
Existing earnings/completion/savings-interest notices fire only from real bridge
accounting, not enqueue, claim, prerequisite, I/O retry or quarantine.

## Signing-key retention

Current key is `PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET`.
Optional `PIGGYVEST_PRIMARY_PAID_INTEREST_RETAINED_WEBHOOK_SECRETS` is a secret-store
JSON array of at most four approved historical keys; never print it or place it in
source/package manifests. Intake and worker can reverify original raw bytes with
those server-configured keys. The worker passes the matching retained key only
to the existing server bridge verifier; it does not rewrite frozen signature bytes.
No signature match remains I/O-retry pending; it cannot authorize financial credit.
Owners must retain needed keys until their backlog is drained and coordinate the
parent route's outer signature gate during rotation. No user/provider payload
selects a secret or activates a retained key.

## Source-connected worker and offline scheduler package

`apps/web/src/scripts/primary-wallet-paid-interest-inbox-worker-cli.ts` provides:

- `--plan`: static description only; no database/provider/config-secret reads.
- `--readiness`: approved configuration plus verified restricted TLS session and
  exact enabled production/business authority; no claims or provider operations.
  This is worker/storage readiness, **not** proof of customer crosswalk readiness.
- `--once`: same readiness gate, then at most one receipt, bounded abort signal,
  and only aggregate counters in output. Missing policy can still defer safely.
  Provider/DB I/O first attempts durable `io_retry` finish, then exits nonzero with
  a redacted error so systemd can detect an incident. A failed finish also exits
  nonzero; its uncompleted claim is recoverable after lease expiry. Legitimate
  prerequisite deferral is a successful poll, not an operational-error exit.

Launch from the web workspace using borrowed dependencies:

```sh
NODE_OPTIONS=--conditions=react-server PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm exec tsx src/scripts/primary-wallet-paid-interest-inbox-worker-cli.ts --plan
```

Operator-only readiness/once require owner-approved secure environment
configuration, `PIGGYVEST_PRIMARY_PAID_INTEREST_WORKER_APPROVED=true`, and valid
restricted production bindings. `PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED`
gates creation of new inbox receipts; `PIGGYVEST_PRIMARY_PAID_INTEREST_ENABLED`
gates direct-bridge intake. Worker/drain mode intentionally ignores both flags
so rollback does not strand durable receipts already queued. Neither flag is a
prerequisite for readiness or draining.
Intake additionally requires
`PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_DRAIN_SCHEDULED=true` as an attestation
that the drain timer is actually installed and running. Without that attestation,
intake fails closed and the provider redelivers instead of queueing payouts
nobody drains.
Intake can persist receipts without API credentials; readiness/worker require
the existing dedicated provider token/business/signing configuration and restricted
evidence DB host/port/name/password/CA. Never use service-role credentials.

Offline packager:
`tools/staging/primary-wallet-paid-interest-inbox/primary-wallet-paid-interest-inbox-package.mjs`.
It builds to a **new external directory**, pins the bridge/inbox and capture migration
hashes, captures and rechecks bundled source bytes, and writes executable bundle,
manifest and hardened systemd service/timer templates. No secrets are packaged.
The package entry calls the actual CLI, not an unused library. Systemd templates
run as `baci-primary-interest-inbox`, read an owner-provisioned environment file
at `/etc/baci/primary-paid-interest.env`, and run readiness before each one-receipt
poll. The timer uses 30-second non-overlapping oneshot polling. The bundle path
is `/opt/baci/primary-paid-interest/interest-inbox.cjs`; Node 22+ is required.
These are templates, not installed or enabled services. Frozen migrations in
the artifact are audit inputs, not an instruction to reapply historical files.

## Validation and outstanding activation gates

The full isolated fixture loads the prior production/accounting/notification
fixtures and the two new migrations. It checks prerequisite persistence/backoff,
exact duplicate bytes, claim exclusion, lease recovery and stale finish rejection,
no completion without financial proof, crash-after-credit dedup, one savings notice,
same-event raw variants, proof-conflict quarantine, long-lived retries, immutable
raw evidence, exact authority/environment readiness and no ordinary cash movement.
SQL uses synthetic signatures at the trusted worker boundary; TypeScript mocks
exercise genuine exact-byte HMAC-SHA512 including whitespace and key rotation.
Offline package tests launch only plan and refusal paths with no configured backend.

Capture/replay regressions exercise failure before durable storage, worker I/O
failure followed by replay of the original bytes without provider redelivery,
and recovery after financial commit but before queue acknowledgement. The
route/intake/worker/signed-bridge test uses synthetic provider and storage
boundaries; isolated PostgreSQL separately checks durable bytes, quarantine,
conflicts, leases, immutable evidence and financial deduplication. Unknown nested
fields, Unicode and whitespace remain part of the original signed body.
Quarantined receipts require operator review; these tests do not add an automatic
quarantine-release endpoint or simulate a genuine monthly provider payout.

The capture migration is registered as a pending source, not as applied production
history. Remaining: owner review the updated offline package and approve the
capture migration; provision restricted production credentials/authority and
install/activate the scheduler;
prove provider customer/API/internal-wallet crosswalk and full-net customer policy;
define signed reversal intake and excess-principal resolution; provision restricted
quarantine monitoring/operator reconciliation and signing-key rotation procedures.
No automated quarantine release or provider attribution is invented. Source and
local fixtures do not establish provider delivery, live schema readiness or deployment.

## Disabled-capture review clarification — 26 October 2026

Authenticated unknown, malformed, or mismatched envelopes signed only by the
interest key intentionally return retryable 503 when raw capture is disabled.
They must not fall back to a hash-only acknowledgement: their exact bytes may
be the only recoverable evidence of a future monthly-interest shape. The existing
legacy/bank/custody handlers still receive known events authorized by their own
matching key families. Configure and verify durable intake and its drain before
pointing live delivery at this receiver; a 503 is not durable retention and a
finite provider retry budget cannot replace receiver availability.

The interest family does not require a second provider-issued secret. A business
signing key may be explicitly configured for both the legacy and interest
families; the union then authorizes both, and the interest inbox independently
verifies that key before storing the original bytes. Do not infer interest
authority merely because a key verified as legacy. A legacy-only payout remains
retryable until interest authority, durable storage and its drain are configured.
The legacy inbox's redacted fields are not a replayable replacement for the raw
monthly request. `interest-raw-capture.signing.test.ts` covers shared-key capture,
missing authority, disabled/unscheduled intake and storage failure without
changing production configuration or permitting an acknowledgement before storage.
