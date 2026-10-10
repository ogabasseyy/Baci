# Bounded primary-card financial transfer worker — review package only

Build locally without configuration, database access or provider requests:

```sh
node tools/staging/primary-wallet-card-transfer/primary-wallet-card-transfer-package.mjs /tmp/new-primary-card-transfer-package
```

The output is a standalone Node 22 `transfer.cjs`, source/output SHA-256 manifest,
and **uninstalled, disabled** systemd oneshot/timer templates. Compilation performs
no financial actions. The artifact DOES contain the real financial POST adapter.
Only invoke it against mocks until the owner authorizes activation and evidence.

Local mandatory package/storage tests (isolated PostgreSQL binaries must already exist):

```sh
node --test tools/staging/primary-wallet-card-transfer/*.test.mjs
```

The database fixture uses a new Unix-socket-only cluster and stops it in `finally`.
Synthetic previous-day reservations and a fresh independently attributed snapshot
permit a new customer reservation without changing owner-selected limits, treasury,
previous attempt states or legacy funds. Parallel sessions compete for one claim;
unknown recovery credits only on signed custody proof, then duplicates are harmless.

The scheduled connection is `transfer.cjs --once` → restricted bounded selector →
`dispatchPrimaryCardProviderTransfer` → verified durable context → committed
one-attempt claim → environment-bound documented wallet transfer POST → durable
submitted/unknown acknowledgement. Selection never claims or resets operations.
Each invocation processes at most one ready operation. Concurrent stale selections
are fenced by the existing locked claim. No reclaim, repeat POST or new reference
is permitted for dispatching, submitted, unknown or completed operations.

`--readiness` authenticates the reusable policy and checks the restricted database
capability with zero selected operations. It cannot claim or POST. Missing/expired
policy, wrong runtime, restricted-session failure or storage failure exits 1 with
redacted stderr. Unresolved unknown/dispatching backlog exits 2 and blocks dispatch
for this integration in both modes, pending signed custody reconciliation.
The timer retries inspection, NOT the ambiguous financial request. Successful
submission remains `submitted_for_custody`, `fundingComplete:false`; idle, raced
and readiness are also not funding completion. Journald receives only status/counts.

The service template runs as `baci-primary-card-transfer`, reads the owner-managed
private `/etc/baci/primary-card-transfer-%i.env`, invokes readiness before once,
and polls every 30 seconds without an overlapping systemd instance. Other instances
still rely on the database one-attempt claim. The signal reaches the dispatcher:
cancellation during context lookup stops before claim; cancellation after committed
claim is fenced immediately before the actual POST and records unknown without
releasing/resetting the claim. Result-write failure or process termination leaves
dispatching for reconciliation, never retry. Cancellation never skips the durable
result write after a claim. Already-started HTTP retains its existing bounded deadline;
it cannot be unsent, and acceptance still requires signed custody proof before credit.

## Required external activation bindings (not provided or activated)

- Register/apply appended migration 201300 after frozen 201200; keep the existing
  financial login with only `primary_card_transfer_worker`, strict TLS and no table
  grants, service-role, intake or custody credentials. Selector and dispatcher
  verify current integration/environment/settings expiry and owner treasury policy.
- Provision the exact trusted runtime fields read by `readPrimaryCardTransferRuntime`,
  including signed reusable policy bytes/signature and authorized issuer key. The
  policy must be based on an approved exhaustive provider alias contract, exact
  business/merchant/integration/environment, treasury webhook customer and transaction
  customer identity. Merely setting flags or self-issuing guessed mappings is not proof.
- Existing verified onboarding records map each customer/user to the destination
  wallet/customer; no per-operation financial selection file is required. Actual
  reusable alias proof remains an external blocker, not deploy-ready capability.
- Install/authorize the service only after reviewing the artifact and restricting
  credentials. No install, secret provisioning or scheduler activation occurred here.
- Parent's signature-verified PiggyVest webhook already dispatches parsed
  `wallet-transfer.outflow.success` before legacy handling into durable signed intake.
  Run the separately restricted custody receipt worker with its approved authenticated
  single-transaction crosswalk/complete bank/internal alias evidence to settle credit.
  Its current operation-record crosswalk delivery still needs an approved reusable
  authenticated reader binding; this financial scheduler does not invent that reader.

Collection, provider submission, signed custody settlement and spendable ledger
credit are separate. Preserved legacy balances are not Piggy-backed funding.

## Activation (scheduler before rail)

The primary-card rail must stay disabled until this worker's systemd timer
instance is installed and enabled; charged checkouts would otherwise sit
`custody_pending` with no settlement drain. The checkout runtime enforces
this: new reservations require `PIGGYVEST_PRIMARY_CARD_TRANSFER_SCHEDULED=true`
(and the custody worker's `PIGGYVEST_PRIMARY_CARD_CUSTODY_SCHEDULED=true`),
each set only after that worker's timer is installed and enabled — without
them initialize answers `PRIMARY_CARD_NOT_READY` while status recovery still
drains. The activation suite makes that ordering verifiable:

- `primary-wallet-card-transfer-package.mjs` builds the sealed offline bundle
  (`transfer.cjs`, `baci-primary-card-transfer@.service`/`.timer` templates
  for user `baci-primary-card-transfer`, manifest) outside the repository.
- `primary-wallet-card-transfer-host-inventory.mjs` collects read-only host
  metadata for one reviewed instance name (installed unit files,
  `systemctl show` state, service account) over SSH from the authorized host.
  It performs no writes.
- `primary-wallet-card-transfer-db-inventory.sql` captures the restricted
  live-DB posture (fixed transfer login, sole capability, exact 4-RPC
  allowlist, mode-0 selector authority probe) with no secret values.
- `primary-wallet-card-transfer-activation-prepare.mjs` seals bundle +
  inventories into an expiry-bounded preparation with a review-only owner
  install plan bound to the inventoried instance.
- `primary-wallet-card-transfer-activation-guard.mjs --owner-gate` refuses to
  run until the owner records exact unexpired approvals, including
  `schedulerStartApproved`, and wires itself as `ExecStartPre` via
  `worker-expiry.conf`.

Local suite checks (no SSH, no database):

```sh
node --test tools/staging/primary-wallet-card-transfer/primary-wallet-card-transfer-host-inventory.test.mjs tools/staging/primary-wallet-card-transfer/primary-wallet-card-transfer-activation-prepare.test.mjs
```
