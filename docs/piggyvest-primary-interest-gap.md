# Primary-wallet paid-interest completion gap

Audited and integrated locally on 7 October 2026 in the takeover worktree.
The append-only completion migration and isolated SQL regressions are not
evidence of deployment or a real provider transaction.

## Accounting contract

- Provider monetary amounts are integer kobo. Public goal `current_amount`
  is principal in naira; convert exactly once at the database boundary.
- Verified funded value is principal plus customer-eligible **net paid**
  interest, after reversals. Gross payout, withheld tax, and daily accrual
  must not increase funded value. Customer allocation may be less than net
  payout under an approved allocation policy.
- Keep principal and paid interest separate. Mobile's
  `wallet-savings-interest-projection.ts` already adds scoped paid interest
  to savings display. Adding the same interest to persisted `current_amount`
  would double count it in that projection.
- Earnings is a report of credited savings interest. Neither an Earnings
  label nor a payout receipt authorizes another credit to the ordinary
  wallet's available balance. Spending stays subject to savings policy,
  purchase reservations, and verified settlement.
- Reservations and accepted/dispatched transfers are not funded money.
  New contribution capacity is `max(0, target - principal - paid interest
  - pending contribution reservations)` in kobo. Completion follows verified
  principal plus paid interest, independently of pending reservations.

## Existing evidence and gaps

`20260926170000_piggyvest_interest_bridge.sql` verifies economics and exact
approved allocation before recording zero principal and positive paid interest.
Receipt identity prevents repeat credit and changed economics return conflict.
The bridge requires the staging ledger worker, staging integration, enabled
goal binding, payout allocation, eligibility evidence, and policy reference.
It does not establish that a `piggyvest_primary` destination is also an
authorized ledger binding, or automatically create such authority.

The `20261004200000` through `20261004200400` drafts are fixture-only SQL in
`supabase/migrations/tests/fixtures/legacy-interest-capacity-drafts/`, outside
the automatic top-level migration registry. Their bytes are preserved; they
are not approved production prerequisites and must not be deployed or added
to the production registry. They propose broader legacy completion, wallet
contribution, transfer and prefunded-card capacity changes, not PRIMARY-only
behavior. The completion draft is loaded explicitly by the isolated fixture
to model coexistence with a legacy trigger; it is not required to establish
production authority. Global legacy interest-driven completion needs separate
product-policy approval. The transfer draft is superseded by canonical later
transfer migrations. See the fixture README for exclusions and frozen hashes.

`20261007144000_piggyvest_primary_savings_reservations.sql` calculates
primary reservation capacity from principal and pending transfers only.
`20261007150000_piggyvest_primary_savings_settlement.sql` increments
principal and checks principal-only target capacity; it does not explicitly
update goal status or `completed_at`. A legacy goal with an enabled ledger
binding inherits the October 4 draft trigger only in the explicit isolated
fixture, not through the production migration chain. Primary destination
registration alone does not guarantee that binding. The historical isolated
primary settlement fixture checked amount and duplicate settlement, not
funded-total completion. The new migration below closes the completion gap
without modifying either historical draft.

Example: target 13,000 kobo, confirmed principal 10,000, verified net paid
interest 3,000. Funded value is 13,000 and the goal is completed; principal
stays 10,000 and new contribution capacity is zero. The principal-only
primary reservation expression would still expose 3,000 kobo of capacity.

## Implemented within Task B scope

`20261007181000_piggyvest_primary_paid_interest_completion.sql` installs
runtime triggers on primary goal updates, authoritative ledger posting
statements, and primary transfer state changes, and backfills scoped legacy
primary goals. Principal-only confirmed settlement now completes a funded
goal even without an interest binding. Interest contributes only through an
existing enabled binding with exact goal/merchant/customer ownership and an
enabled staging registry whose provider business matches the primary business.
The primary environment must be staging for this staging ledger to count.
No binding, allocation, customer eligibility, or provider-wallet attribution
is created. Missing, disabled or ambiguous primary destinations are outside
the new completion scope. The later production bridge below supplies a separate
disabled-by-default evidence/policy contract; principal-only completion still works there.

The posting trigger sees the complete posting statement and sums signed
`paid_interest` plus `purchase_interest`, including reversals. Thus moving
paid interest into a purchase reservation does not erase paid funded value.
Pending accrual and pending primary transfers are excluded from completion.
The final goal trigger normalizes `status`/`completed_at`, preserving principal
and special lifecycle states. A reversal pauses a no-longer-funded completed
goal. The migration adds no wallet cash operation or earnings credit.

Private RLS-denied `savings_completion_reviews` flags exact pending operation
IDs and overshoot kobo; flags clear when capacity is restored without deleting
the audit row. Operations, holds and provider receipts are never cancelled
to force the totals to fit. The existing settlement function is privately
renamed and wrapped at its existing runtime entry point; its source file
is untouched. Its parameter qualifiers are rebound to the private name.
Only capacity exceptions are intercepted, after validated authority, proof
and exact operation ownership. The wrapper preserves the first verified
seven-field settlement proof in private `savings_completion_evidence` and
returns the existing `conflict` outcome, which the runtime exposes as pending.
It does not pretend that excess principal was allocated. Repeated or changed
proof cannot overwrite first-writer evidence. Proof lookup is serialized by
the existing intent advisory lock. Once verified reversal restores capacity,
the exact retained proof can settle once through the unchanged accounting path.

The existing `reserve_savings` runtime entry point is also privately wrapped.
It delegates authentication, validation, idempotency and reservation creation
to the historical implementation, then checks principal plus exactly scoped
paid interest plus all pending reservations under the goal row lock already
held by that implementation. An excessive **new** reservation raises an
internal exception inside a savepoint; the wrapper rolls back its wallet
hold, operation and review changes and returns `insufficient`. Exactly
remaining reservations succeed. Existing pending/confirmed reservation
replays keep their original outcome and never cancel a transfer because
interest arrived later. No authority/binding is provisioned. The renamed
historical reservation implementation loses its direct worker grant.

`primary-wallet-paid-interest-progress.ts` projects trusted, already scoped
and deduplicated totals. It preserves principal, excludes pending accrual
and pending transfers, accounts for reservations, clamps new contribution
capacity, and completes active/paused goals from verified funded totals.
Reversal reopens a completed goal as paused; cancellation/purchase/spent
states are preserved. Invalid kobo and unsafe arithmetic fail closed.
`savingsInterestWalletCreditKobo` is always zero; it expresses that this
projection creates no additional ordinary-wallet credit.

This pure helper makes no provider call, database write, payout allocation,
or deduplication decision. It must receive principal before mobile display
adds paid interest, and interest from the scoped authoritative ledger after
reversals. Repeated projection of identical totals is stable; it is not
proof of storage idempotency. The pure helper still has no runtime caller;
the SQL triggers above provide the actual integration. Existing accounting
draft bytes were preserved in fixture-only storage in the release checkout;
the takeover source checkout and shared settlement source files are untouched.

## Exact remaining owner policy

When paid interest fills a target after a transfer was dispatched and the
provider subsequently confirms that transfer, should the excess confirmed
principal (a) remain saved above target, (b) be returned through a separately
verified refund, or (c) move to another customer-selected goal? No option is
assumed. Until the owner selects one and its settlement contract is supplied,
retain the original confirmed proof, dispatched operation, wallet hold and
private review flag; show pending rather than a false allocation/refund.
The migration implements this evidence-preserving boundary, not an excess
allocation policy. Review-queue operator access/alerts still need an approved
restricted capability. The tables grant no customer or service-role access.

## Required integration and verification gates

1. Supply the precise provider/business/customer/API-wallet-to-goal mapping
   for interest payouts, including the internal destination-wallet relationship.
   Verify gross minus tax equals net equals payout amount, payout identity
   scope/stability, finality and reversal evidence. A success envelope or
   principal transfer confirmation alone does not establish eligible interest.
2. Supply approved customer allocation/eligibility policy and prove each
   production primary savings destination resolves to the exact approved
   crosswalk below. Staging ledger bindings and production receipts are
   exclusive sources, not interchangeable authority. No service-role customer
   operation or auto-enabled binding is justified by this helper.
3. Supply the excess-transfer policy above and a restricted review queue
   capability. The wrapper prevents new overtarget reservations; it preserves
   transfers already dispatched before a payout and retains verified excess
   proofs without inventing a cash settlement or refund.
4. Parent `20261007212000` supplies completion notices; `20261007220003`
   supplies production paid-interest notices and authenticated earnings reads.
   Isolated storage/RPC tests pass; real push delivery remains unverified.
5. Run explicitly scoped fixture SQL and registered PRIMARY migration
   regressions in an isolated database, not the legacy drafts in production:
   payout-only completion, partial payout then exact principal settlement,
   same-payout redelivery/conflict, reversal, overtarget reservation,
   payout/dispatch concurrency, ownership/role rejection and notifications.
   Parent web typecheck, broader lint/test gates, review and any separately
   authorized provider/deployment verification remain outstanding.

## Local validation

- Full isolated PostgreSQL 18 fixture:
  `apps/web/src/lib/piggyvest/primary-wallet-paid-interest-completion.integration.sql`.
  It loads the real primary migration chain and real ledger tables/guards/
  apply functions plus an explicitly included fixture-only October 4
  completion draft, not an approved production migration. The staging registry
  and base application tables are synthetic minimal fixtures. This is not
  a full Supabase-history replay or a production-schema validation.
- Omitting only the new migration with psql
  `-v without_primary_completion=1` fails the exact principal-only completion
  assertion after a provider-confirmed settlement. Removing only the new
  reservation wrapper in the isolated fixture with
  `-v without_primary_capacity=1` fails the one-kobo-above-remaining-capacity
  assertion after a partial paid payout. With the complete migration,
  the full fixture passes: backfill, principal-only completion, partial paid
  interest then exact settlement, payout replay, reversed interest, accrual
  exclusion, ownership/business/environment isolation, preserved lifecycle
  states, partial-interest reservation capacity and rollback, retained
  overshoot proof/review, changed-proof rejection, later
  settlement after capacity restoration, cash invariance and private ACLs.
  The dispatch-before-payout case is a deterministic interleaving, not a
  simultaneous-session stress test. All local fixture clusters were stopped.
- Focused Vitest in `apps/web`: 37 tests passed across
  `primary-wallet-paid-interest-progress.test.ts`, `interest-ledger.test.ts`
  and `primary-wallet-savings-reconciliation.test.ts`, with
  `--environment node`. The new helper suite contains 21 cases.
- Biome check passed for both new TypeScript files.
- Standalone strict TypeScript check passed for the new helper using
  `--ignoreConfig --noEmit --strict --skipLibCheck --target es2022
  --module nodenext --moduleResolution nodenext`. This does not replace
  the parent app typecheck. Every pnpm command used
  `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`.
- The initial helper-only test run failed on the missing module; the later
  SQL red/green fixture reproduces the actual historical settlement defect.
  No mobile source changed, so mobile Jest was not run here. Broad typecheck
  was not repeated; deployment/real-provider verification remains separate.

## Production bridge implemented locally

The append-only `20261007220000` through `20261007220003` migrations add
private crosswalks, immutable production payout receipts/delivery aliases,
reversal evidence storage, completion/capacity totals, authenticated aggregate
and per-goal earnings reads, and exactly-once savings-interest notifications.
No existing migration, shared settlement implementation or registry was edited.

`dispatchPrimaryWalletPaidInterest` is the server-only parent webhook hook.
It independently verifies HMAC-SHA512 against exact bounded raw bytes before
reading financial scope. It parses the existing signed interest-payout schema,
checks integer-kobo gross minus tax equals net equals amount, and resolves the
exact webhook customer/source/accrued/internal destination/envelope destination
tuple. It then performs a bounded authenticated GET of the exact stored API
wallet, checking active NGN status, API wallet/customer and provider business.
No hyphen removal or API/internal customer/wallet ID equivalence is assumed.
Evidence uses the restricted TLS primary evidence login, explicit production
integration/environment/business configuration and the existing enabled inflow
authority. No authority, provider attribution or crosswalk is auto-created.

Crosswalks are immutable except for an explicit enabled toggle and start
disabled. Activation requires provider evidence digest proving the entire
onboarding/webhook/API customer and wallet crosswalk, plus an approved policy
digest/reference that **all provider net payout is customer plan interest**.
No alternative revenue split is silently assumed. The enrolled primary goal
wallet must have immutable explicit interest opt-in before the payout time.
Missing evidence, opt-out, disabled policy, ambiguous primary scope, foreign
customer/business/environment or missing API customer proof returns prerequisite.
Existing legacy-ledger binding also returns prerequisite: a goal cannot acquire
a second source. A legacy interest posting after a production receipt raises a
reconciliation exception under the same goal lock and rolls back atomically.
That exclusivity prevents aggregate and per-goal reads counting both sources.

Financial dedup is integration plus provider payout ID, with immutable first
economics and delivery aliases. Changed economics/identity or reused event ID
returns conflict; retries do not change principal, cash or notices. Fresh API
observation is required at ingestion. Persisted receipt net after bounded
reversals feeds the existing completion/reservation wrappers and parent
completion notices. Daily accrual and provider gross/tax never enter earnings.
Existing authenticated `get_customer_savings_earnings` overloads preserve legacy
results and add production net interest, including per-goal kobo consumed by
mobile's existing savings display projection. They do not change `current_amount`
or ordinary wallet balances. The earlier pure progress helper remains unused;
the database RPC/trigger paths, not that helper, provide runtime integration.
`get_customer_savings_notifications` exposes one paid-interest notice per payout:
“Your savings grew by ₦X in paid interest. Keep going!” Any reversal voids that
original amount notice; parent completion reversal behavior remains intact.

The new production SQL fixture loads real primary, provisioning, ledger and
engagement storage/events migrations with synthetic base tables and provider
proofs. It passes authenticated aggregate/per-goal reads, other-user denial,
net reversal, one notice despite delivery aliases, exclusive-source rejection,
partial-payout exact remaining capacity, and dispatch-before-payout preservation.
Omitting `220002` fails funded completion; omitting `220003` fails interest notice.
All isolated PostgreSQL clusters were stopped. Focused node Vitest: 63 passed
across six suites; Biome: eleven new bridge/schema files passed. Runtime fixture
typing now supplies `NODE_ENV: 'test'`. No broad typecheck was repeated.

Production activation is **not complete**: parent has registered 220000–220003
and wired durable queued intake in the shared webhook. The later 220100/101
worker/backlog and offline scheduler package are described in
`piggyvest-primary-interest-inbox.md`; their registry remains parent-owned.
The bridge is production-only;
staging coverage is the earlier independent ledger fixture, not a production
adapter sandbox. Provider crosswalk/full-net eligibility proof, restricted worker
provisioning, signed/API reversal contract and worker/scheduler activation remain gates.
Reversal SQL is tested with synthetic owner evidence; there is no runtime reversal
handler or worker reversal INSERT grant until the provider contract is known.
Concurrent verified excess principal remains durable review/pending evidence,
not a cash settlement/refund. External excess-allocation policy and restricted
operator resolution are still required. No provider delivery, production schema
replay, deployment or real transaction is claimed.
