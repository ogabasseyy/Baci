# PiggyVest staging connection handoff — 18 September 2026

## Worktree boundaries

- Provider implementation: `/Users/mac/.codex/worktrees/0d77/Baci-app`,
  `feat/piggyvest-wallet`. Preserve the other agent's uncommitted ledger work.
- Isolated infrastructure and pinned mobile bootstrap:
  `/Users/mac/Baci-worktrees/cursor-savings-phase1`.
- These are different checkouts. Neither an infrastructure test nor a passing
  provider unit test demonstrates that one deployed build contains both.

## Verified infrastructure

- Isolated PostgreSQL system identifier: `7685292944002592802`.
- DB, Auth, REST and internal mail containers are healthy.
- `baci-savings-gateway.service` is installed but inactive/dead, with
  `Result=success`. The private installed-unit smoke test still requires the
  owner's sudo entry; noninteractive sudo is unavailable. Do not reuse old
  startup evidence or enable public ingress before that test passes.
- Public webhook GET currently returns registration-ready with event processing
  disabled. A synthetic invalid signature-bearing POST reproduced HTTP 503 with
  `PIGGYVEST_NOT_READY`. This is the separate Vercel registration handler, not
  the VPS Auth gateway. Replacing local Next.js source does not replace that
  standalone deployed function.

## Customer authorization correction

- Customer HTTP handlers must use the authenticated database client.
- Mapping and payout reads need customer/merchant-scoped RLS. Neither customers
  nor anonymous callers may insert or change provider mappings or payouts.
- Wallet provisioning must not be made functional by granting customers table
  writes or by hiding a service-role client in another helper. Until a reviewed
  worker boundary exists, customer provisioning must return an explicit 503
  before any provider write. The existing provisioning implementation can be
  retained for subsequent worker integration; it is not safe to expose directly.
- Staging plan-wallet reads must reject production deployments and any provider
  origin other than `https://staging.piggyvest.business`.

## Connection gates, in order

1. Have the owner execute the reviewed private smoke test for the installed
   gateway. Keep public ingress disabled during installed-unit privilege and
   Unix-socket checks. Successful installation is not a successful smoke test.
2. Reconcile the two worktrees' migrations and build requirements. Rehearse new
   RLS policies with synthetic identities in a transaction that rolls back.
   Apply migrations only after the exact isolated database identity is verified.
3. Configure an isolated backend deployment using the isolated database/Auth
   origins and staging-only provider configuration. Do not copy production
   credentials, alter environment files implicitly, or print secrets.
4. Merge the reviewed pinned mobile bootstrap into the same development source
   used for the provider UI before selecting the live service. Do not simply
   flip its service prop while its shared API/Auth clients still point elsewhere.
5. Verify synthetic login, own-tenant wallet reads, cross-tenant denial, logout
   and persistence. Provisioning, signed delivery, funding settlement and interest
   reconciliation remain separate gates; never treat fixtures as provider proof.

No deployment, financial activation or successful hosted tap-through is claimed
by this handoff. Root installation still requires the owner's local sudo entry.

## Validation of this correction

- Plan-wallet route and exact staging-origin gate: 25 focused tests pass.
- Scoped mapping/payout SQL regressions passed on the verified isolated database
  inside a transaction ending in ROLLBACK. No permanent migration was applied.
- With explicit owner approval, corrected quoted `bigint` type aliases in the
  new interest and inflow migrations; the original interest DDL failed on the
  real isolated PostgreSQL before the correction.
- Root quality gates must be rerun after concurrent changes finish; transient
  failures during editing are not final validation results.

## Webhook repair in progress

- Owner approved renumbering the unapplied customer-read RLS migration from
  `20260918150000` to `20260918160000`; its SQL is unchanged. The transfer
  migration retains its original version.
- Intake now authenticates the original bytes before strict UTF-8 decoding.
  Authentic unknown, malformed, or deferred events do not receive a false
  success acknowledgment without replayable storage. These return 503, not a
  claim of successful receipt; finite provider retries can still expire and
  require manual redelivery after repair.
- Three route regressions failed before the fix. Twelve route/request-byte
  tests now pass, including stream failure. This is local evidence only.
- The lease repair adds database-clock expiration, rotating ownership tokens,
  fenced completion, attempt increments, and retryable busy responses. It also
  refuses to acknowledge a poison event if persisting its failure state fails.
- Lease SQL regressions passed on the identity-verified isolated PostgreSQL
  inside one transaction ending in ROLLBACK. They exercised the service role,
  denied anonymous/authenticated callers, expired/reclaimed claims, stale-token
  rejection, and completion. This used a synthetic inbox fixture with corrected
  type spelling in memory; it is NOT a successful replay of all checked-in
  migrations, and no schema was permanently installed.
- The unapplied inbox migration still contains quoted `bigint` and `integer`;
  the transfer-outbox migration also contains quoted `bigint`. A live read-only
  PostgreSQL cast confirmed `type "bigint" does not exist`. Owner approval to
  correct those protected files is pending. Renumbering approval does not
  authorize unrelated migration edits.
- The current inbox is not a complete replay queue: it omits event details.
  Unknown events need a reviewed durable quarantine/reconciliation path before
  acceptance can be enabled. No raw financial payload logging was introduced.
- The public docs show JSON reserialization for signatures, while the local
  provider contract register records a later raw-byte confirmation. Preserve
  that confirmation and verify an actual signed staging delivery before
  claiming end-to-end signature compatibility.

## Final local checks for this repair

- PiggyVest libraries, schemas, and webhook route: 20 suites, 161 tests passed.
- Repository-wide `pnpm turbo typecheck`: passed.
- Repository-wide `pnpm turbo lint`: blocked only by an unrelated empty catch
  block in `apps/web/tools/perf/sitespeed-build-identity.mjs:35`. That concurrent
  performance work was not changed. Scoped formatting checks passed.
- No public deploy, permanent database migration, secret change, or provider
  financial operation was performed. The reviewed owner-run private smoke
  artifacts remain at `/home/bassey/baci-isolated-savings/private-smoke.3RistMeE`;
  their four pinned checksums were reverified unchanged. Sudo is still required.
