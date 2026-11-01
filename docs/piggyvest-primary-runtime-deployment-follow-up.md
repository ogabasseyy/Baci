# Primary onboarding and goal-provisioning deployment follow-up

This is preparation for operator review, not an installer, authorization to
activate, or evidence of remote deployment. No environment files, credentials,
remote database, provider account or nginx configuration were changed.

## Application coverage

- `/api/storefront/customer/wallet/piggyvest-primary`: authenticated GET reads
  owned wallet/accounts and persists exact accepted-to-verified proof; CSRF
  protected POST creates the customer with main-wallet interest accrual on and
  routed to the configured Ogabassey payout wallet (fixed at creation), then
  records the wallet only after `GET /wallet/:id` reads that routing back.
  An existing customer returned on a fresh claim is an ownership verdict
  (`OWNERSHIP_REVIEW_REQUIRED`, terminal). A readback that contradicts the
  routing (another wallet, customer, business or payout wallet, or accrual
  explicitly off) goes to review (`INTEREST_ROUTING_REVIEW_REQUIRED`, with a
  `PIGGYVEST_PRIMARY_ROUTING_NEEDS_REVIEW` alert carrying the intent id). A
  failed or not-yet-settled readback, including a reclaimed existing
  customer's, keeps the created wallet's ids and its creation-time payout
  wallet in an unusable `routing_pending` state (migration 20261031230000): it
  is never exposed or credited, setup is never re-dispatched, and each GET
  re-reads it read-only against that stored payout wallet, making it usable
  once the routing is proven or rejecting it (same alert) when contradicted.
  A rejected wallet keeps its ids, so deleting that customer still waits for
  its DVA closure; a recheck never promotes a wallet whose closure was
  attested. A wallet sent to review at onboarding is rejected with its ids
  in one write, so no recheck can ever promote it; if that write fails,
  nothing else is written and the retry after the claim lease keeps the ids.
  A retried setup first asks PiggyVest for customers carrying our
  identifier: it creates again only when none exist, and adopts an existing
  customer only when it is exactly the one listed. Several listed customers,
  a duplicate created despite a listed one, or an existing customer that is
  not listed are never adopted (`OWNERSHIP_REVIEW_REQUIRED` or still
  pending, with a `PIGGYVEST_PRIMARY_OWNERSHIP_NEEDS_REVIEW` alert carrying
  the intent id). A setup stored before interest routing is recognised by
  its earlier fingerprint format for the same customer and goes through the
  same lookup-gated retry; a customer it created has accrual off, so it goes
  to routing review. The onboarding role's readiness list includes every
  function the runtime calls.
- `/api/storefront/customer/savings/primary-provisioning`: authenticated,
  CSRF-protected POST persists explicit immutable interest choice before the
  single creation dispatch; PATCH recovers via provider reads without another
  creation or a changed choice. Accounts appear only after durable enrollment.
- Both paths now select a fixed provider origin from validated runtime
  environment through `getPrimaryWalletProviderOrigin`: staging uses
  `https://staging.piggyvest.business`, production uses
  `https://api.piggyvest.business`. No client-selected origin is accepted.

## Required deployment configuration

Primary onboarding requires all of these server-only settings:

- `PIGGYVEST_PRIMARY_ENABLED=true`
- `PIGGYVEST_PRIMARY_ENVIRONMENT=staging` or `production`
- `PIGGYVEST_PRIMARY_MERCHANT_ID`, `PIGGYVEST_PRIMARY_INTEGRATION_ID`,
  `PIGGYVEST_PRIMARY_BUSINESS_ID`
- `PIGGYVEST_PRIMARY_BUSINESS_BINDING_VERIFIED=true`, set only after independent
  provider business/environment verification
- `PIGGYVEST_PRIMARY_FINGERPRINT_KEY`, stable across retries and at least 32
  characters; rotating it requires a separately reviewed replay policy
- `PIGGYVEST_PRIMARY_PROVIDER_TOKEN`, belonging to that business/environment
- `PIGGYVEST_PRIMARY_INTEREST_PAYOUT_WALLET_ID`, the Ogabassey business wallet
  (26-character uppercase PiggyVest wallet ULID, no whitespace) that receives
  main-wallet interest. Only new setups need it: when it is missing or
  malformed, POST returns `PIGGYVEST_ONBOARDING_NOT_READY` (not the
  merchant-wide `PIGGYVEST_NOT_READY`, so clients never fall back to a legacy
  account) and no customer is created. Reads, savings and the recheck of
  routing-pending wallets keep working without it, because each pending
  wallet stores the payout wallet it was created with. Each customer's
  routing is immutable, so set it before any onboarding, and change it only
  while no setup is in flight: a retried setup checks the customer it adopts
  against the current value, so one created under the previous value goes
  to routing review.
- `PIGGYVEST_PRIMARY_DB_HOST`, `PIGGYVEST_PRIMARY_DB_PORT`,
  `PIGGYVEST_PRIMARY_DB_NAME`, `PIGGYVEST_PRIMARY_DB_PASSWORD`,
  `PIGGYVEST_PRIMARY_DB_CA`

`VERCEL_ENV=production` requires primary environment `production`; all other
deployment values permit only `staging`. The database host must satisfy the
runtime DNS-host schema. The CA must verify the actual endpoint; executors
require TLS with certificate verification and never disable it.

Goal provisioning additionally requires
`PIGGYVEST_PRIMARY_SAVINGS_PROVISIONING_ENABLED=true` and
`PIGGYVEST_PRIMARY_GOAL_PROVISIONER_DB_PASSWORD`. It deliberately inherits all
base-runtime requirements, including the onboarding database password. A
provisioning flag is not the separate savings-transfer activation flag.

## Restricted database preparation

1. Review the pending primary migration chain and its public-table dependencies.
   Onboarding needs 20261007140000, mapping reads 20261007141000 and proof
   verification 20261007180000. Goal provisioning needs 20261007190000 plus
   the savings-destination storage/dependencies introduced by 20261007144000.
   Verify installed function signatures, schema usage, RPC execution grants and
   deny-by-default table policies. Do not rewrite historical migrations.
2. Separately prepare LOGIN roles `baci_piggyvest_primary_provisioner` and
   `baci_piggyvest_primary_goal_provisioner`. Neither may have SUPERUSER,
   BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION. Their only role membership
   must respectively be `piggyvest_primary_provisioner` and
   `piggyvest_primary_goal_provisioner`. Effective privileges must permit their
   restricted RPCs without granting table access or unrelated capabilities.
   Executors require SESSION_USER and CURRENT_USER to remain the fixed login.
3. A privileged operator must configure an independently verified, exact
   `piggyvest_primary.integrations` row with matching integration UUID,
   merchant UUID, business ID, environment and
   `executor_login=baci_piggyvest_primary_provisioner`. Goal provisioning needs
   the same integration in `piggyvest_primary.goal_provisioning_authorities`
   with `executor_login=baci_piggyvest_primary_goal_provisioner`. Both bindings
   must be explicitly enabled after review. No customer/goal binding is
   guessed or preseeded; authenticated ownership is checked at runtime.
4. Supply distinct credentials via approved secret delivery, never CLI
   arguments, reports, logs or repository environment files. Refuse unexpected
   existing roles/bindings; do not rotate or overwrite them automatically.
5. Rehearse positive and negative TLS, session identity, role membership,
   scoped ownership and privilege checks against disposable local PostgreSQL
   before any separately authorized deployment.

The existing `funding-setup/install-isolated-postgres-tls-and-provisioner.sh`
targets the legacy `piggyvest_staging_provisioner` and its staging RPCs. It does
not provision these primary logins, group memberships or authority bindings;
running it is not a substitute for this preparation.

## Route/deployment verification still required

Apply `20261101171000_piggyvest_primary_onboarding_review_hold.sql`,
`20261101174000_piggyvest_primary_legacy_review_deletion_hold.sql`, and
`20261101180000_piggyvest_primary_mapped_ownership_review_hold.sql` before
deploying the review-status reader or ambiguous-onboarding recovery. Include
`record_onboarding_ownership_hold(jsonb,uuid,uuid)` and
`read_onboarding_review(jsonb)` in the restricted provisioner's verified grants.
The former retains an immutable review hold without choosing or exposing a
provider wallet; the latter returns only the scoped terminal-review reason.
An unresolved dispatched/unknown intent also blocks customer deletion, including
the window where provider creation succeeded but its custody write failed.
Mapped wallets still require their existing DVA closure attestation. Unmapped
ownership holds require operator reconciliation of all matching provider
customers and their DVAs; no automatic hold-clear or wallet-adoption permission
is introduced. A separately reviewed, evidence-backed operator resolution path
is required before production activation.

Legacy `record_onboarding_rejection` writes have no durable reason that
distinguishes a definitive foreign-customer response from an ambiguous
provider creation handled by an older application instance. The compatibility
migration therefore blocks deletion for every rejected intent without a
provider wallet ID, including rows whose `review_reason` is NULL and explicit
foreign rejections. Treat these rows as requiring operator reconciliation;
do not infer safe deletion from the old response or clear the hold
automatically. No migration grant or automatic release path is added.

A mapped rejected review with `review_reason` NULL also requires ownership
reconciliation. This includes duplicate-creation reviews that retain the
duplicate wallet IDs: attesting closure of that wallet satisfies only its DVA
closure condition and cannot prove the original provider customer was
reconciled. Such a customer remains undeletable after closure. A rejected row
classified as `review_reason='routing'` has proven ownership and keeps the
existing mapped-DVA rule: deletion remains blocked until closure is attested,
then becomes allowed. No automatic ownership release, wallet adoption or
additional runtime RPC is introduced.

The existing staging wallet nginx installer covers the legacy exact wallet
GET path. It does not establish or probe the new primary paths. Verify actual
deployment routing, authentication, CSRF and no-store responses for primary
GET/POST and provisioning POST/PATCH without enabling an unauthenticated path
or exposing the database. Review the current routing topology before generating
an installer; historical container/IP/port assumptions are not sufficient.

Local mocked transport tests do not verify token ownership, migration
application, credential installation, provider creation, interest payouts or
customer-visible account readiness. Card, interest, inflow and savings-transfer
activation remain separate capabilities outside this document's installer scope.

## Local metadata-only readiness inventory

`apps/web/src/lib/piggyvest/primary-restricted-readiness.ts` exports
`inspectPrimaryRestrictedReadiness(inventory, now)`. Its strict metadata contract
is `apps/web/src/schemas/primary-restricted-readiness.ts`; the required server
variable names, fixed capability groups/RPC signatures and route modules are in
`primary-restricted-readiness.constants.ts`. The checker has no database,
filesystem, environment-value, HTTP or installer access. It performs no remote
apply, probe, customer creation, deposit, transfer or financial action.

Supply only sanitized observations from an independently reviewed inventory
collector, never passwords, tokens, BVNs, headers or response bodies. Unknown
fields are rejected; reports return only static gate results, required variable
names and the evidence-source classification, not scope identifiers or input
values. Synthetic fixtures cannot become remote evidence. Even an
`operator_inventory` report always sets `remoteVerified=false` and
`activationAuthorized=false`; `prepared` means the supplied metadata satisfies
the local contract, not that its attestations have been independently verified.

The contract requires exact deployment/provider origins, enabled exact
merchant/integration/business/environment and goal-authority bindings, both
private-runtime validation attestations, fixed logins with their sole capability
membership, non-login non-elevated groups, effective exact RPC grants, no direct
table/PUBLIC execution, and verified database identity/TLS/hostname attestations.
Evidence must not be future-dated or older than one hour; approval must remain
unexpired and be at most 24 hours from capture. Each login's finite password
`validUntil` must be strictly after evaluation time and no later than the
approved evidence expiry. Null/unlimited, expired or over-approved credential
validity blocks preparation.

Route observations must cover onboarding GET/POST and provisioning POST/PATCH,
with exactly one entry per method/path, the expected module, application origin
and reviewed artifact digest. Only unauthenticated, body-free 401 observations
with zero attested provider calls/database writes are accepted. A generic 401 is
insufficient: matching-artifact authentication, CSRF, ownership, single-dispatch,
immutable-interest-choice and provider-origin regression attestations are also
required. Do not perform an authenticated POST to collect this inventory.

These flags are attestations, not remote proof or an executable installer.
Current primary runtime/integration tables do not enforce this approval expiry;
an activation owner must implement and verify the revocation procedure.
PostgreSQL password validity does not terminate existing sessions. The legacy
installer or its route/role receipts cannot satisfy missing primary evidence.
