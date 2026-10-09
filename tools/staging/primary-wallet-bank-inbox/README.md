# Restricted primary bank retry entry

Prepared, tested locally and **not installed/enabled**. This is a bounded retry
of exact already signed bank receipts, not a provider financial action or a
replacement webhook. Migration hashes and intake contract are recorded in
`docs/primary-wallet-bank-signed-inbox.md`.

## Commands

From a reviewed checkout with its existing dependencies and approved worker
environment already injected (never load/export secrets in command arguments):

```sh
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm exec tsx --conditions=react-server --tsconfig apps/web/tsconfig.json tools/staging/primary-wallet-bank-inbox/primary-wallet-bank-inbox-entry.ts --readiness
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm exec tsx --conditions=react-server --tsconfig apps/web/tsconfig.json tools/staging/primary-wallet-bank-inbox/primary-wallet-bank-inbox-entry.ts --once
```

`--plan` prints the offline executable plan with no database/provider
operations; it is also the sealed bundle's self-proof after packaging.

Do not run these against a remote database without owner authorization. No
dependencies need installation for the local source/smoke check. The scheduler
runtime must retain the reviewed Node/tsx dependency closure and TypeScript path
mapping; unavailable dependencies are an installation gate, not reason to
substitute legacy/service-role code. Unknown/extra CLI arguments are rejected
before any database operation.

## Existing scheduler pattern

Use the same operator-reviewed systemd oneshot + `OnUnitInactiveSec=30s` timer
pattern as `tools/staging/primary-wallet-card-custody`; no overlap or loops inside
this process. Run `--readiness` as ExecStartPre and `--once` as ExecStart, under a
dedicated nonroot OS account, approved absolute working directory/runtime paths,
`TimeoutStartSec=30`, `UMask=0077`, `NoNewPrivileges=true`, `ProtectSystem=strict`,
`ProtectHome=true` and `PrivateTmp=true`. Keep the environment file root-owned
0600 and out of the checkout. Neither service nor timer is created or activated
by this package; the operator selects exact reviewed artifact/runtime paths.
Do not add a duplicate scheduler or modify Vercel cron/registries automatically.

Runtime settings pin `PIGGYVEST_PRIMARY_INTEGRATION_ID`, `ENVIRONMENT`,
`MERCHANT_ID`, `BUSINESS_ID`, existing primary database host/port/name/CA,
`PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED=true`, `BANK_INBOX_EXPIRES_AT`,
`BANK_INBOX_WEBHOOK_SECRET` and `BANK_WORKER_PASSWORD` (all bank names prefixed
`PIGGYVEST_PRIMARY_`). The worker login is fixed `baci_primary_bank_worker` with
only `primary_bank_inbox_worker`; intake separately uses `baci_primary_bank_intake`
with only `primary_bank_signed_intake` and `BANK_INTAKE_PASSWORD`. Optional
`PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS` is an approved JSON string list
of at most three retained keys. No fallback to evidence/service-role credentials.

Before activation, inventory unexpected inherited/PUBLIC/effective grants rather
than copying fixture ACL revokes. DB authority is owner-enabled, independently
pinned to exact merchant/business/environment/deadline; credential validity must
not exceed it. A missing signing key or expanded privilege set must alert on a
nonzero run, not be called successful reconciliation. Deferred counters do not
mean wallet credit. Monitor blocked/attempt-limit receipts and lease expiry with
approved aggregate-only operational access; requeue/review policy is not automated.
Never journal raw bytes, signatures, identifiers, configuration or credentials.

## Activation (scheduler before intake)

The bank inbox intake must stay disabled until this worker's systemd timer is
installed and enabled; accepted deposits would otherwise sit in the inbox with
no drain. The activation suite makes that ordering verifiable:

- `primary-wallet-bank-inbox-package.mjs` builds the sealed offline bundle
  (`bank-inbox.cjs`, `baci-primary-bank-inbox.service`/`.timer` templates for
  user `baci-primary-bank-inbox`, frozen migration bytes, manifest) outside
  the repository.
- `primary-wallet-bank-inbox-host-inventory.mjs` collects read-only host
  metadata (installed unit files, `systemctl show` state, service account)
  over SSH from the authorized host. It performs no writes.
- `primary-wallet-bank-inbox-db-inventory.sql` captures the restricted live-DB
  posture (fixed worker login, sole capability, exact RPC allowlist, enabled
  authority row) with no secret values.
- `primary-wallet-bank-inbox-activation-prepare.mjs` seals bundle + inventories
  into an expiry-bounded preparation with a review-only owner install plan.
- `primary-wallet-bank-inbox-activation-guard.mjs --owner-gate` refuses to run
  until the owner records exact unexpired approvals, including
  `schedulerStartApproved`, and wires itself as `ExecStartPre` via
  `worker-expiry.conf`.

Local suite checks (no SSH, no database):

```sh
node --test tools/staging/primary-wallet-bank-inbox/*.test.mjs
```
