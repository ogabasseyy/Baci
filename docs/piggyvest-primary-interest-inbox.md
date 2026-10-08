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
- `invalid_signature` / `invalid_payload`: not persisted; no success ACK.
- Unavailable/misconfigured authority, unsafe TLS session or storage failure throws
  a redacted error; parent returns retryable 503, never a false persisted ACK.

Parent reports its shared hook now calls this intake before any legacy financial
path, with persisted outcomes returning queued 200 and invalid/storage failure
returning 503. Parent owns that hook and its regression tests; Task B did not edit it.
The previously finalized 220000–220003 migrations are registered and unchanged.

## Storage and worker

Append-only 220100 stores raw payload/signature/SHA256, integration-scoped event
identity, retry/lease state and immutable conflict variants. RLS denies public,
customer and service-role access. Only the existing restricted TLS evidence
capability has enqueue/claim/finish/readiness function grants; no direct tables.
Its existing enabled authority and exact production integration/environment are
required. No new authority, provider crosswalk, eligibility or credentials are
auto-enabled. SQL trusts that restricted signed-intake capability; actual HMAC
verification occurs before enqueue and again before bridge dispatch, not inside SQL.

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

Operator-only readiness/once additionally require owner-approved secure environment
configuration and `PIGGYVEST_PRIMARY_PAID_INTEREST_WORKER_APPROVED=true`.
Both `PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED` and existing
`PIGGYVEST_PRIMARY_PAID_INTEREST_ENABLED` must be true for the CLI worker.
Intake can persist receipts without API credentials; readiness/worker require
the existing dedicated provider token/business/signing configuration and restricted
evidence DB host/port/name/password/CA. Never use service-role credentials.

Offline packager:
`tools/staging/primary-wallet-paid-interest-inbox/primary-wallet-paid-interest-inbox-package.mjs`.
It builds to a **new external directory**, pins all six bridge/inbox migration
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

Remaining: parent register 220100/101 and review the offline package; owner provision
restricted production credentials/authority and install/activate the scheduler;
prove provider customer/API/internal-wallet crosswalk and full-net customer policy;
define signed reversal intake and excess-principal resolution; provision restricted
quarantine monitoring/operator reconciliation and signing-key rotation procedures.
No automated quarantine release or provider attribution is invented. Source and
local fixtures do not establish provider delivery, live schema readiness or deployment.
