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

### Vercel connectivity: Supavisor session-mode pooler

The direct host `db.<ref>.supabase.co` is IPv6-only and Vercel functions
cannot reach IPv6. On Vercel, point the executors at the Supabase pooler:

- `PIGGYVEST_PRIMARY_DB_HOST` = the pooler host
  (`aws-0-<region>.pooler.supabase.com`; copy it from the Supabase Connect
  dialog), `PIGGYVEST_PRIMARY_DB_PORT` = `5432` (session mode). Never `6543`:
  transaction mode would break session verification and the per-delivery
  connection reuse.
- `PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF` = the 20-character project ref.
  When set, every PiggyVest restricted-login executor connects as
  `<login>.<ref>` (Supavisor requirement). The database session user is still
  the bare role, so session verification is unchanged. A malformed ref is
  refused (fail closed). When unset, behaviour is the direct-host default.
- Supavisor is not documented to forward startup `options`, so in pooler mode
  the executors send no startup options and instead run
  `SET search_path TO pg_catalog; SET statement_timeout = 2500; SET lock_timeout = 1500`
  right after connecting, before session verification.
- TLS stays verify-full with `PIGGYVEST_PRIMARY_DB_CA`. The CA bundle must
  cover the pooler host's certificate chain (use the Supabase CA bundle that
  validates the pooler host).

### Vercel connectivity: TCP passthrough forwarder (end-to-end TLS)

The shared pooler fails the executors' end-to-end TLS check
(`pg_stat_ssl.ssl=false` on the pooler to Postgres hop). The alternative is a
TCP passthrough forwarder on the VPS (which has IPv6 to the database), exposed
as `pg-relay.usebaci.com`. The Postgres TLS handshake passes through untouched,
so TLS is end to end. Settings:

- `PIGGYVEST_PRIMARY_DB_HOST` = `pg-relay.usebaci.com`
- `PIGGYVEST_PRIMARY_DB_PORT` = the forwarder port (`15432`, see the VPS PR)
- `PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME` = `db.aivqthbxdshhltbwipbr.supabase.co`
- `PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF` must be unset. Setting both it and
  the server name is refused (fail closed), as is a server name that is not
  `db.<20-char ref>.supabase.co`.
- `PIGGYVEST_PRIMARY_DB_CA` is unchanged (Supabase Root 2021 CA).

In this mode the login is the bare role and the startup settings are the
direct-mode ones. The executors still verify the certificate (`rejectUnauthorized`
stays true) but check its name against the configured Supabase host instead of
the relay host, using `ssl.checkServerIdentity` (node-postgres overwrites
`ssl.servername` with the connect host, so that option cannot be used). A
certificate for `pg-relay.usebaci.com` is rejected.

`VERCEL_ENV=production` requires primary environment `production`; all other
deployment values permit only `staging`. The database host must satisfy the
runtime DNS-host schema. The CA must verify the actual endpoint; executors
require TLS with certificate verification and never disable it.

Goal provisioning additionally requires
`PIGGYVEST_PRIMARY_SAVINGS_PROVISIONING_ENABLED=true` and
`PIGGYVEST_PRIMARY_GOAL_PROVISIONER_DB_PASSWORD`. It deliberately inherits all
base-runtime requirements, including the onboarding database password. A
provisioning flag is not the separate savings-transfer activation flag.

### Client build floors and onboarding rollout cohort (gate not wired yet)

`apps/web/src/lib/piggyvest/primary-client-capability.ts` and
`primary-onboarding-capability.ts` hold the build-aware capability gate; no route calls it yet. When wired, it reads:

- `PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_IOS` and
  `PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_ANDROID`: the lowest storefront native
  build (iOS `CFBundleVersion`, Android `versionCode`) allowed to use the
  primary wallet, as a positive whole number with no spaces. While either is
  unset or malformed every build is refused, whatever the cohort. The owner
  sets them only after the release that sends the build headers passes App
  Review. Clients send `X-Baci-Client-Platform` (`ios` or `android`) and
  `X-Baci-Client-Build`; a missing or malformed pair counts as an old build.
  A refusal uses `PRIMARY_CARD_NOT_READY` or `SAVINGS_NOT_READY`, which
  released builds already treat as "use the legacy flow" (never the base
  `PIGGYVEST_NOT_READY`, which they cache merchant-wide); a failed read answers `PIGGYVEST_UNAVAILABLE` instead.
- A floor proves only the native build. What reads wallet responses is the
  JavaScript bundle, and an over-the-air update can replace it: the Android
  runtime version is shared by every `versionCode`, so one Android update
  reaches every build, and an iOS export targets one build's runtime. Never
  publish or export an update whose source predates the wallet response
  contract that the builds at or above a floor rely on. If an update
  rollback must cross such a contract change, first unset both floors (or
  raise them past every affected build), and set them again only after the
  forward fix ships. This rule belongs on the storefront release checklist
  (P9-mobile-build-header-pilot-removal); a later change may instead have
  the client send a contract number compiled into the bundle, so the gate
  keys on the JavaScript rather than the native build.
- `piggyvest_primary.rollout_cohort` (migration 20261103012500), keyed by
  merchant and customer. It ships empty and only a privileged operator adds
  rows. A customer with no primary onboarding may start one only while
  listed and while every readiness reader in
  `primary-readiness-registry.ts` reports ready; none is registered yet, so
  onboarding stays closed. A customer whose wallet is verified, or whose
  onboarding is in flight (an intent or mapping not yet released), needs
  only the build floor: removing them from the cohort, or a reader dropping
  to not ready, never strands a provider-side wallet. Route wiring admits an
  in-flight customer to resume that onboarding only, never a fresh claim.
  Include
  `read_rollout_cohort_membership(jsonb)` in the restricted provisioner's
  verified grants; it returns only a boolean for the scoped customer.
- Claim-time binding (route wiring PR, P4-capability-gate-routes). A `fresh`
  verdict is a point-in-time read, not a token. The wiring must re-run
  `resolvePrimaryOnboardingCapability` immediately before dispatching the
  claim, and a follow-up migration must make `claim_onboarding(jsonb,text)`
  re-check `rollout_cohort` membership inside its own transaction, so a
  customer removed from the cohort between the gate and the claim cannot
  create a backed wallet. Until both land no route calls the gate.
- Refusal codes. Gate refusals are per customer or per build, so they use
  only `PRIMARY_CARD_NOT_READY` or `SAVINGS_NOT_READY`, never the base
  `PIGGYVEST_NOT_READY` that released storefront builds cache merchant-wide.

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
`20261101180000_piggyvest_primary_mapped_ownership_review_hold.sql`, and
`20261101190000_piggyvest_primary_onboarding_review_classification.sql` before
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

Apply the review-classification migration before deploying the new six-argument review and four-argument routing-resolution statements. Verify both overloads in the restricted provisioner readiness check. The old signatures remain conservative wrappers: they do not infer routing-only review from an unclassified contradiction. Identity-matched interest-setting contradictions retain a routing reason atomically; identity mismatches remain ownership-held after the recorded DVA closes.

## Onboarding presence

Apply `20261102121549_piggyvest_onboarding_presence.sql` before deploying the GET presence check, and include `has_onboarding(jsonb)` in the restricted provisioner's verified grants. The migration grants EXECUTE on `has_onboarding(jsonb)` only to the `piggyvest_primary_provisioner` group; execution stays denied to `PUBLIC`, client roles and `service_role`. It changes no login roles, environment variables or runtime settings. Because the group's executable-function set grows by one, readiness evidence must be re-captured against an artifact that includes this change; evidence from an earlier artifact fails the onboarding role check by design.

When the scoped customer has no onboarding intent at all, GET answers before any provider, mapping or review read. A failed or malformed presence read fails closed with 503. Only a client that sends `x-baci-piggyvest-snapshot-version: 2` receives `{ "status": "not_started", "account": null }`; every other client, including every installed mobile build, receives the `{ "status": "pending", "account": null }` reply its strict snapshot schema already accepts, which is also what a never-started customer received before this change. The reply varies on that header and is never cached. A mobile build may send the header only once its snapshot schema accepts `not_started`.
