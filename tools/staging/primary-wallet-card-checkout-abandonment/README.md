# Stale primary-card checkout abandonment worker — review package only

Build locally without configuration, database access or provider requests:

```sh
node tools/staging/primary-wallet-card-checkout-abandonment/primary-wallet-card-checkout-abandonment-package.mjs /tmp/new-primary-card-abandonment-package
```

The output is a standalone Node 22 `abandonment.cjs`, source/output SHA-256 manifest,
and **uninstalled, disabled** systemd oneshot/timer templates. Compilation performs
no financial actions. The artifact contains NO financial POST adapter: the worker
only re-verifies provider state (GET) and records abandonment/collection for
provider-settled rows. Only invoke it against mocks until the owner authorizes
activation and evidence.

Local mandatory package tests:

```sh
node --test tools/staging/primary-wallet-card-checkout-abandonment/*.test.mjs
```

The scheduled connection is `abandonment.cjs --once` → restricted bounded selector
(`select_stale_ready_checkouts`, at most 25 rows older than 24h) → per-operation
Paystack verify → `record_abandonment` for provider-confirmed dead checkouts,
`record_collection` for provider-confirmed paid ones the client never polled.
Pending and reconciliation_required outcomes are left untouched for the
client/webhook paths. Selection alone changes nothing.

`--readiness` validates the drain runtime and the owner-approval flag with zero
selected operations. It cannot verify or terminalize. Missing approval, wrong
runtime, or storage failure exits 1 with redacted stderr. Journald receives only
status/counts.

The service template runs as `baci-primary-card-abandonment`, reads the
owner-managed private `/etc/baci/primary-card-abandonment.env`, invokes readiness
before once, and polls hourly without an overlapping systemd instance. The evidence
database login (`baci_primary_card_evidence`) executes only the four abandonment
RPCs; it holds no table grants and no transfer/intake/custody credentials.

## Required external activation bindings (not provided or activated)

- Register/apply appended migration 20261008093900 after frozen storage,
  abandoned-release, and expiry-drain; keep the existing evidence login with
  only `primary_card_evidence`, strict TLS and no table grants.
- Provision the exact trusted runtime fields read by
  `readPrimaryWalletCardCheckoutRuntimeDrain`, plus
  `PIGGYVEST_PRIMARY_CARD_ABANDONMENT_APPROVED=true`. The worker runs on the
  drain reader by design: abandonment is drain-only work.
- Review the database inventory
  (`primary-wallet-card-checkout-abandonment-db-inventory.sql`) and host
  inventory (`primary-wallet-card-checkout-abandonment-host-inventory.mjs`)
  against the target host before installing the timer.

## Activation (scheduler before rail)

The primary-card rail must stay disabled until this worker's systemd timer is
installed and observed reclaiming a synthetic stale checkout, or walk-away
checkouts pin customers to dead operations with no server-side recovery.

Do not add a duplicate scheduler or modify Vercel cron/registries automatically.
Activation follows the same owner-approval gate as the sibling primary-card
workers (disabled templates here; owner installs and enables out of band).
