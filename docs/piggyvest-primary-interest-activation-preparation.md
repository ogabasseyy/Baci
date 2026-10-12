# Primary paid-interest activation preparation

Interest-worker config/scheduler only. Shared bank/card/mobile code, roles and
registries are not modified. 220000–003 and 220100/101 remain frozen. Preparation
does not authorize installation, restart, DB apply, provider writes or transactions.

## Minimal bank-to-savings release first

Paid-interest activation is separate; do not make its scheduler a prerequisite
for principal funding. The parent owns bank-worker release artifacts and wiring.
Approve the reviewed source/dependency closure, not an isolated library:

- Authenticated wallet `piggyvest-primary`, savings `primary-provisioning`,
  `primary-transfer` and `primary-transfer/pending` routes; signed PiggyVest
  webhook bank intake; the parent's actual restricted bank worker and savings
  dispatch/reconciliation paths. No replacement infrastructure is needed.
- Migration-owner approval of the registered 20261007140000–20261007190000
  primary onboarding/inflow/reservation/settlement/provisioning chain, including
  its existing public-table dependencies and completion guard, plus bank inbox
  20261007230000, custody prerequisite 20261007230100 and worker 20261007230200.
  Use the parent's ordered registry/dependency closure and verify installed
  signatures/ACL/RLS; this list is not a command to replay every timestamp.
- Exact verified production merchant/integration/business and provider-token
  ownership, TLS DB endpoint/CA, stable fingerprint key and provider crosswalk.
  Then separately approve `PIGGYVEST_PRIMARY_ENABLED`, `_INFLOWS_ENABLED`,
  `_BANK_INBOX_ENABLED`, `_SAVINGS_PROVISIONING_ENABLED`, `_SAVINGS_ENABLED`
  as true, with `VERCEL_ENV=production`, primary environment production and
  `_BUSINESS_BINDING_VERIFIED=true`. These suffixes all use the
  `PIGGYVEST_PRIMARY` prefix. Never turn verification flags on without evidence.
- Restricted fixed onboarding/goal-provisioner/authorizer/evidence DB logins
  `baci_piggyvest_primary_provisioner`, `baci_piggyvest_primary_goal_provisioner`,
  `baci_piggyvest_primary_authorizer`, `baci_piggyvest_primary_evidence`, plus
  `baci_primary_bank_intake` and `baci_primary_bank_worker`. Require each reviewed
  capability's exact memberships/grants, no elevated/table authority, privately
  supplied corresponding passwords and finite owner-approved validity.
- Bank runtime additionally requires exact `_BANK_INBOX_EXPIRES_AT`,
  `_BANK_INBOX_WEBHOOK_SECRET`, `_BANK_INTAKE_PASSWORD`, `_BANK_WORKER_PASSWORD`
  and bounded retained signing keys when needed. Bank scheduler activation,
  actual provider contract/receipt proof and post-start reconciliation are
  separate owner gates. Queued acknowledgment alone is not funded savings.

The interest-only preparation does not establish those bank deployment gates.
Read-only inventory commands for its own artifacts are:

```sh
node --input-type=module -e "import { collectPrimaryInterestHostInventory } from './tools/staging/primary-wallet-paid-interest-inbox/primary-wallet-paid-interest-host-inventory.mjs'; console.log(JSON.stringify(collectPrimaryInterestHostInventory()));"
node /PATH/TO/SEALED/package/activation-guard.mjs --verify /PATH/TO/SEALED/package
psql -X -qAt -v ON_ERROR_STOP=1 -v integration_id=PROVEN_UUID -v business_id=PROVEN_BUSINESS -f /PATH/TO/SEALED/package/restricted-db-inventory.sql
```

Run the first command from the takeover worktree. The last command requires
an approved restricted verified-TLS connection configured through private
credential delivery; it does not authorize acquisition of unknown credentials.
The new catalog-inventory script is preparation source, not independently
executed live DB evidence. Existing isolated inbox SQL tests do not validate
this separate live inventory or prove deployment.

## Current host facts, not financial readiness

Authorized read-only metadata inspection of `bassey@82.29.190.219` found Node
24.21.0, no `baci-primary-interest-inbox` OS account, and interest worker/timer
units `LoadState=not-found`, inactive. Initial nonprivileged artifact/config paths
were absent or not visible. No environment contents, credentials, live DB tables,
provider data, logs or unrelated worker state were read. This does not prove
the production DB roles/migrations/provider bindings are present or absent.

`primary-wallet-paid-interest-host-inventory.mjs` performs a fixed-host metadata
collection, excludes environment-file contents/digests and emits only known
path metadata/unit status. It never uses sudo, readiness/once, restart or install.
Nonprivileged `unreadable` is not converted to `absent`. An owner must repeat a
privileged read-only current-layout check before choosing any install/rollback.

## Exact existing runtime and role prerequisites

- `VERCEL_ENV=production`, `PIGGYVEST_PRIMARY_ENVIRONMENT=production`.
- `PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED=true`, existing
  `PIGGYVEST_PRIMARY_PAID_INTEREST_ENABLED=true`, and separate worker approval
  `PIGGYVEST_PRIMARY_PAID_INTEREST_WORKER_APPROVED=true`.
- Exact `PIGGYVEST_PRIMARY_INTEGRATION_ID` and
  `PIGGYVEST_PRIMARY_PAID_INTEREST_BUSINESS_ID`; no inferred provider identity.
- Dedicated `PIGGYVEST_PRIMARY_PAID_INTEREST_API_TOKEN`,
  `PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET` and optional bounded retained
  signing-key JSON; never echo or put actual values in a prepared package.
- `PIGGYVEST_PRIMARY_DB_HOST`, `_DB_PORT`, `_DB_NAME`, `_DB_CA` and
  `PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD`. Actual DB login is fixed in code:
  `baci_piggyvest_primary_evidence`; certificate/hostname verification stays on.
- SESSION_USER/CURRENT_USER must remain that non-elevated login, solely a member
  of non-login/non-elevated `piggyvest_primary_evidence`, without parent-group
  escalation or direct private-table privileges. PUBLIC/customer/service-role
  interest entry-point execution must be absent.
- Six interest RPCs: enqueue, claim, finish, readiness, read exact crosswalk,
  apply paid interest. The same existing evidence capability also exposes
  `apply_inflow_environment`, `settle_savings`, `read_dispatched_savings`.
  This is **not** a new interest-only DB role. Do not silently revoke, rotate,
  shorten credentials or rebind the existing evidence authority: other primary
  workers may share it. Obtain that capability owner's coordination explicitly.
- Exact enabled production integration/inflow authority must match that login
  and independently proven business. Worker/storage readiness can succeed while
  every customer payout remains prerequisite-blocked; it is not provider proof.

## Concrete read-only DB procedure

The prepared `restricted-db-inventory.sql` runs catalog inventory inside a
READ ONLY transaction, followed by the existing exact authority readiness
SELECT. That SELECT temporarily takes SHARE locks; it makes no durable writes
and must use READ COMMITTED as required by the existing authority function.
It does not enqueue, claim, finish, credit, transfer or request provider data.

An approved operator uses a verified-TLS restricted session and private secret
delivery, with `psql -X -qAt -v ON_ERROR_STOP=1 -v integration_id=<proven UUID>
-v business_id=<proven business> -f restricted-db-inventory.sql`. Do not pass
passwords/tokens in command arguments or enable SQL/error debug logging.
Capture the two sanitized JSON results as `restricted_inventory` and
`authority_inventory`; the collector does not acquire credentials automatically.
Also obtain a privileged owner's installed-migration/signature/ACL/RLS receipt
and actual endpoint/certificate/database identity proof. Catalog observations
from a fixture or another database cannot authorize the live worker.

## Sealed prepare-only artifacts

`preparePrimaryInterestActivation` builds the actual worker/package at a new
external directory, validates frozen migrations, and adds:

- `host-inventory.json`, sanitized `database-inventory.json`, operator-proof
  metadata, `preparation.json`, current artifact manifest and `SHA256SUMS`.
- `runtime.env.example` with exact keys and deliberate unusable placeholders;
  **not** real credentials or an environment file ready to install.
- `owner-actions.review.json`: exact paths, modes, account/login capability,
  desired unit installation, separately gated owner commands and rollback policy.
- `owner-approval.example.json` with all approvals false; it is not authorization.
- `activation-guard.mjs` and mandatory `worker-expiry.conf` service drop-in:
  verify every sealed file before existing restricted worker readiness.
- Standalone host/DB inventory artifacts for independently reviewed operator use.

Preparation expiry is at most 24 hours; inventory/operator evidence must be no
older than one hour. A supplied operator attestation must bind exact host/DB
inventory and candidate bundle digests plus provider/migration proof references.
Finite DB credential validity must fit the approval window. Unknown/unlimited,
stale or unsafe inventory cannot produce reviewed operator evidence. Without
that evidence the package remains host-metadata-only and its owner gate refuses.
An operator attestation remains an attestation, not independent provider delivery.

For future approved installation, nonsecret sealed assets are root-owned 0644,
package directory root-owned 0755, approval metadata root:worker-group 0640,
secret environment root:root 0600. Systemd securely supplies that environment;
the worker never reads/prints the secret file itself. The approval metadata
must be readable by the worker but not writable by it. Real owner approval is
external to the preparation seal and binds its exact externally reviewed digest.
The expiry guard refuses missing approvals, changed bytes, unsafe custody or
expired approval before each poll. It does not terminate already-running sessions;
the worker is separately bounded, and DB validity does not revoke existing sessions.

## Separate owner-only approvals required

1. Fresh privileged current-layout comparison and backups; refuse unknown state
   or changed artifact hashes rather than overwriting an existing installation.
2. Migration owner receipt and exact restricted capability/config approval,
   including shared evidence-login coordination and finite credential expiry.
3. Independently verified provider customer/API/internal-wallet crosswalk,
   full-net opted-in plan eligibility and retained signing-key/outer webhook policy.
4. Exact prepared seal/package installation approval and dedicated OS account,
   secure secret delivery and quarantine/incident monitoring ownership.
5. Separate scheduler-start approval after read-only readiness; an explicit
   owner-started poll may perform financial accounting and is not authorized here.
6. Rollback approval: stop/disable only this interest timer/worker, preserve all
   inbox/ledger/observations/quarantine and restore only matching backed-up bytes
   or proven newly owned files. Stopping is not a refund. No role revocation,
   bank/card/mobile changes, blind file deletion or receipt purge is implied.

The prepared commands are review artifacts only. No installer/apply mode runs
them, no owner approval is manufactured and no service was installed or activated.
