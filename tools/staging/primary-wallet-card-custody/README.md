# Primary-card signed custody worker operator package

Financial-source follow-up: `docs/primary-wallet-card-transfer-adapter.md` now implements the separate gated one-attempt POST dispatcher. This receipt package remains GET/settlement-only and does not launch financial dispatch; the earlier “financial adapter absent” statements below describe its prior handoff. Actual reusable provider crosswalk proof, authenticated policy delivery and financial worker deployment/scheduler bindings remain outstanding, with no live actions performed.

Prepared locally for review/installation, **not installed or activated**. No provider financial transport, financial HTTP, credentials, remote configuration or shared route was changed. Parent reports the actual signature-verified PiggyVest webhook now invokes `dispatchPrimaryCardSignedCustodyIntake` for parsed `wallet-transfer.outflow.success` before legacy processing (42 tests / 6 suites reported by parent). This package uses that exact durable inbox, not another webhook, a goal or a fake transaction.

## Audit and concrete connection

The prior intake-only TypeScript statement profile still used the custody database login. New append-only migration `20261007201100_primary_card_intake_role.sql` introduces a separately expiring, owner-enabled intake authority and `primary_card_signed_intake` capability. Registered `200900`/`201000` and earlier migration bytes are unchanged.

| Process | Login / capability | Permitted operations |
| --- | --- | --- |
| Parent webhook intake | `baci_primary_card_intake` / `primary_card_signed_intake` | Exact signature/capability check, readiness and raw-byte enqueue only. No claim, read table, settle or financial transfer. |
| Signed custody worker | `baci_primary_card_custody` / `primary_card_custody_evidence` | Existing leased inbox claim/reference/context, proof settlement and fenced finish. No direct table access or transfer submission. |
| Separate financial transfer process | `baci_primary_card_transfer` / `primary_card_transfer_worker` | Existing restricted transfer outbox only; **not launched by this package**. |

Important parent runtime binding change: the unchanged intake dispatcher API now requires `PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD`, not the custody worker password. No compatibility fallback to settlement credentials is allowed. Provision the login with only its matching capability, strict TLS, no elevated role flags and no extra memberships. An `intake_authority` row must explicitly match the integration, enable intake and set a future expiry no later than the configured checkout expiry. The migration does not create LOGIN credentials, enable intake, edit owner-selected treasury, extend settings, install a scheduler or make production changes.

The worker path is concrete: compiled entry → `primaryCardCustodyCli` → `runPrimaryCardCustodyLaunch` → existing `createPrimaryCardCustodySignedRuntime` → readiness → durable `claim_signed_inbox` → exact authenticated transaction lookup → existing signed proof/reader → atomic ledger settlement/observation → fenced inbox finish. GET observations only; failure exits nonzero and retains retry state/lease. Deferred or blocked receipt counts do not claim completion. Batch size is pinned to **1** for this launch package to avoid processing a batch beyond its 60-second claim leases.

## Local build, not remote installation

From the takeover worktree, with borrowed dependencies already present:

```sh
node tools/staging/primary-wallet-card-custody/primary-wallet-card-custody-package.mjs /tmp/primary-card-reviewed-package-NEW
```

Output must be a new directory outside the repository. The builder verifies frozen migration hashes, captures and rechecks the compiled source/dependency closure, rejects unrelated imports/externals, and records generator, migration and output SHA-256 values. It emits `custody.cjs`, a systemd oneshot service/timer template and `artifact.manifest.json`. No SSH, install, provider request, scheduler enablement or environment loading occurs during compilation.

This follows existing `tools/staging/prefunded-card/worker-renewal-build` source-capture/bundled-Node artifact mechanics and the VPS worker scheduler pattern, but deliberately does **not** reuse its expired fixed deadline, legacy financial background entry or activation scripts. Runtime deadline comes exclusively from trusted current configuration and independently checked database authority.

## Explicit runtime bindings

**Not autonomous funding / not deploy-ready:** this delivery mode contains operation-specific records. Every new payment needs a newly authenticated issuer record and refreshed pinned file; verified customer wallet ownership alone cannot supply that transfer's exhaustive bank/internal aliases. Readiness and batch reports explicitly include `crosswalkSelection=operation_records_only`, `reusableBindingReady=false`, `autonomousFundingReady=false` and `missingProviderContract=exhaustive_bank_and_internal_transaction_aliases`. Even storage/binding readiness never represents reusable funding readiness.

Worker-only environment: current custody/inbox settings used by `readPrimaryCardCustodyInboxRuntime`, dedicated custody database credential/CA, configured integration/environment/merchant/business/customer identities, issuer/contract, provider **read** token, webhook HMAC secret and batch size `1`. Set `VERCEL_ENV=production` only with the approved production integration, otherwise the staging environment profile. Do not place transfer or intake passwords in the worker process; the launcher rejects either. Scope/expiry/configuration mismatch fails before claims.

Additional worker bindings (all under `PIGGYVEST_PRIMARY_CARD_`):

- `WORKER_APPROVED=true`: explicit owner authorization to launch this receipt worker.
- `CROSSWALK_FILE`: absolute private regular file, single link, no symlink, maximum 1 MiB, permissions 0600 and ownership by root or the worker UID.
- `CROSSWALK_FILE_SHA256`: owner-pinned hash of **exact file bytes**.
- `CROSSWALK_FILE_SIGNATURE`: HMAC-SHA256 of those exact bytes under the independently configured approved issuer delivery key.
- `CROSSWALK_DELIVERY_KEY`: private issuer-delivery verification key, minimum 32 characters, separate from PiggyVest webhook/API credentials.

The binding file schema is `primaryCardCustodyLaunchSchemas.binding`: `deliveryContract=approved-primary-card-crosswalk-file-v1`, exact integration/environment, future expiry no later than runtime authority, and unique `{ operationId, crosswalk }` records. Each crosswalk must satisfy the existing complete provider-authenticated schema, configured issuer/contract, merchant/customer/business scope, public/API/canonical webhook wallet ownership, canonical transaction ID, exhaustive aliases including signed bank inflow, provenance digest and freshness. The resolver matches the exact durable operation/reference and authenticated transaction; no equal-amount or ID heuristic.

**This HMAC/file profile is an internal approved issuer-delivery contract, not an invented PiggyVest API, provider signature format or proof of provider authentication by itself.** The issuer must first obtain the approved authenticated provider evidence and exhaustive crosswalk, then sign/export it through this explicitly authorized delivery channel. Operator-written labels, self-signed guessed mappings or fixture data are not acceptable. That upstream authenticated issuance and refresh/rotation binding is still external and absent. The worker does not generate mappings, infer missing aliases or call an imaginary crosswalk endpoint. Unknown operation mappings remain durably deferred.

## Readiness and scheduler deployment plan (not executed)

The generated templates reference `/opt/baci/primary-card-custody/custody.cjs`, dedicated OS user/group `baci-primary-card-custody` and private `/etc/baci/primary-card-custody-%i.env`, with `%i` being `staging` or `production`. Operator must review artifact manifest/source closure, approve the environment, securely provision role/capability/issuer settings, install the exact verified bytes and protect ancestor directories from untrusted writes. Do not mix environments or copy credentials into the package. Use an approved Node 22 runtime.

`ExecStartPre` runs `custody.cjs --readiness`, verifying current config, pinned/authenticated binding-file envelope and restricted TLS database capability without claims or provider requests. Success reports `storage_and_binding_ready`, `claimsMade=false`, `providerRequestsMade=false`, `receiptProofRequired=true`; it does not assert live receipt economics or that every future operation has a crosswalk.

`ExecStart` runs `custody.cjs --once`. Report `batch_finished` contains claimed/processed/deferred/blocked counts and `fundingComplete=false`. The existing dispatcher alone decides actual per-operation settlement. Any IO, invalid acknowledgement, absent authority or launch failure exits nonzero with sanitized stderr. Never log files, credentials, raw signed bytes or provider bodies. SIGTERM/SIGINT stop further claiming/processing; crashed claims retain the database lease for retry.

The timer polls 30 seconds after each service becomes inactive; systemd prevents overlapping the same instance, and database leases fence additional invocations. Timeout is 55 seconds; no automatic financial retry, reservation release, extra transfer, refund or replenishment is introduced. Operators must monitor nonzero failures, expiry, deferred backlog, blocked/50-attempt receipts and key rotation. Scheduler installation/enablement and a live synthetic/no-money smoke are **not performed** here.

## Remaining external bindings versus code

### Reusable binding audit and exact provider blocker

Source audit: `20261007180000_piggyvest_primary_wallet_verification.sql` verifies primary onboarding wallet/customer/business/active NGN/funding-account ownership. Existing `transfer_context` in frozen `20261007200400` already reuses that scoped verified DB mapping on every operation, with actual stored treasury/reference. The existing authenticated single-transaction GET proves canonical internal transfer, exact `third_party_reference`, source/destination, customer, amount/status/fee. Existing destination-wallet GET supplies `api_customer_id`. These facts automate operation and wallet selection already; none supplies the exhaustive bank-inflow alias set needed to prevent a later signed bank event from crediting the same custody again.

The local provider contract register §1.1 explicitly calls bank `id`, `transaction_id`, `reference`, `third_party_reference`, `internal_reference` and `session_id` **candidate** reconciliation keys with exact dedupe scope unconfirmed. No available reviewed contract states which equal the signed internal outflow's canonical ID or where all bank aliases can be obtained. The existing paid-interest crosswalk table belongs to a goal-specific interest allocation/authority contract; it is not primary-card authorization and is not read or changed here. Synthetic fixture aliases are not provider evidence.

Minimal environment-specific provider evidence required for safe reusable selection:

1. A signed completed owner-source `wallet-transfer.outflow.success` sample and authenticated existing single/TSQ responses proving stable canonical `id`, our exact `third_party_reference`, transaction `customer_id`, source/destination, amount, zero-fee semantics and terminal success.
2. Authenticated destination wallet evidence plus provider confirmation that public wallet ID, API `api_customer_id`, verified onboarding customer ID and signed canonical webhook customer refer to that exact wallet/customer, including any differing ID namespaces. The configured treasury webhook customer and transaction customer must be explicit, not inferred from business ID.
3. Corresponding **signed bank inflow** sample(s) for the same internal transfer, identifying the field used by the primary ledger (`eventData.transaction_id`) and all alternate IDs/redeliveries. The provider must state whether an internal transfer produces no bank event, exactly one or multiple; an authenticated exhaustive alias contract must cover all IDs that the ledger could credit. Amount matching, a random bank reference, or assuming `internal_reference` is sufficient is forbidden.
4. A documented field/location in the **already approved** authenticated single/TSQ response (or an explicitly approved documented read API/durable signed receipt correlation) yielding that complete alias set, plus uniqueness scope, finality, replay stability and freshness. No new endpoint/path is guessed. If aliases can only arrive later as signed inflows, the ledger must wait for a documented terminal completeness signal, not mark the first matching event complete.

Once that contract is supplied and approved, remaining code is a restricted reusable wallet-customer mapping projection and a contract-specific authenticated alias extractor feeding the existing signed crosswalk callback. Current verified DB context can supply local ownership automatically, but no extractor can safely manufacture absent bank alias evidence. No such reusable adapter is claimed implemented now. The static signed file remains an explicit bounded evidence/recovery mode, not the end-state connection or an automatic per-payment issuer integration. Financial transfer transport is separately absent.

Implemented code: executable bounded worker entry/readiness, production/staging artifact and scheduler templates, authenticated internal delivery resolver, separated DB intake grants, claim-to-existing-dispatcher composition, failure/retry tests and exact hash evidence.

Still external: apply/register `201100`; provision both restricted logins, DB authority/current expiry and owner-enabled capability; approve canonical provider fields/customer crosswalk and exhaustive bank aliases; operate signed issuer exports/refresh; securely install artifacts and enable/monitor the selected timer. Parent webhook connection is reported present, but requires the new intake role/password/authority binding. No remote role/configuration/installation readiness was verified.

Still separate code/integration gates: **financial transfer adapter is not wired**; bank-before-custody retry/replay must preserve signed bank bytes; Paystack settlement receivable, replenishment/refund/chargeback and completion notification/cache dispatch are not implemented by this package. Neither `custody_pending`, queued receipt nor worker readiness means customer funding is complete. Legacy funds, limits and owner-selected treasury are unchanged.

## Local evidence

Regression tests first reproduced shared intake-role selection and mandatory transfer credential dependency; the corrected profiles pass. Mocked launch-flow tests exercise actual runtime/executor/mapping/reader/signed settlement composition with five GETs, exact configured crosswalk, one settlement and fenced finish; provider failure persists `io_retry` and fails the launch. CLI tests exercise file metadata, argument rejection and sanitized process failure. Package tests compile/smoke the standalone artifact, validate hashes/templates, refuse reuse/source-tree output and make no network requests.

`primary-wallet-card-custody-launch.integration.sql` applies the existing exact-once bank/card fixture, frozen inbox migrations and `201100` in a fresh Unix-socket-only PostgreSQL cluster. It proves intake enqueue, denied actual claim/settle/table access, intake expiry, worker claiming an intake-created receipt, worker expiry and denied generic user/service-role grants. The cluster is stopped after validation. No credentials or external provider evidence are captured in the package.
