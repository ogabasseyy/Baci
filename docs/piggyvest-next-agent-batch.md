# Next local implementation batch

Dispatched 12 September 2026 from dirty worktree HEAD `d0d1cbd2fd`.
This is agent dispatch, not application deployment or completion evidence.

## Separate ownership

| Agent | Work | Owned new files |
| --- | --- | --- |
| Sartre | Concrete authenticated RLS goal resolver; exact persisted variant and policy facts | `lib/piggyvest/customer-goal-resolver*`, `schemas/piggyvest-customer-goal*` |
| Fermat | Accessible staging-only funding details display | `components/storefront/piggyvest-savings/funding-*` |
| Russell | Deployment-gated, authenticated server funding projection | `lib/piggyvest/customer-funding-view*`, `schemas/piggyvest-customer-funding-view*` |

Paths are relative to `apps/web/src`. Existing shared provider adapters, routes,
production Paystack code and other agents' files are not owned by this batch.

## Parent integration and acceptance gates

- Match the funding projection and component's serializable contract before wiring.
- Resolve customer authentication once; derive tenant, goal and exact device from
  authenticated RLS reads, not caller-supplied account identity or display labels.
- Missing persisted consent/guarantee facts must return unavailable, not infer
  consent from legacy goals. Request a concrete persistence contract before adding
  later migrations; do not pretend a callback interface completes persistence.
- Reject wrong integration, merchant, customer, project and wallet mapping before
  any provider request; expose no funding details on pending or unavailable states.
- Display only account number, account name and bank name to the mapped customer.
  Do not leak provider/internal IDs, credentials or sensitive error details.
- Use synthetic fixtures, regressions, scoped tests and parent review. Parent runs
  final lint/typecheck and relevant security-boundary integration tests once agent
  changes are stable; do not run competing full monorepo suites.
- No deployment, remote migrations, secrets, DNS, external messages or actual money
  movement. No claim about fees, production readiness or provider sandbox success.

Agents report `READY FOR PARENT REVIEW` with files, tests, limitations and their
report path when finished. Their completion notifications are not review approval.
Full savings lifecycle, purchase/refund settlement and provider activation remain
outside these bounded tasks and are still outstanding in the readiness report.

## Parent review and persistence follow-up

The funding projection now feeds the actual display component in synthetic
integration tests. A client panel validates its public response schema, aborts
obsolete loads and invalidates account details when the session/goal key or loader
changes. Independent review found a null-to-same-key stale display; the hook now
invalidates synchronously, with intermediate-commit regression coverage. Callers
must include authenticated-session generation in the key. No live page is wired.

The authenticated goal resolver remains `needs_migration`: legacy timestamps are
not versioned consent. Sartre owns new private draft-policy persistence and local
SQL fixtures; Hooke owns its exact-statement restricted runtime integration;
Descartes independently reviews SQL. Parent owns immutable migration hash
registration and final validation. No new provider approval is needed to continue
this local work.

Initial policy storage is draft-only and collection-paused, with no activated
price guarantee. An empty local ledger cannot prove that no provider funds are
pending reconciliation. The authenticated acceptance ceremony, provider chronology
and financial activation remain separate requirements. Review identified relative
timestamp expiry and UUID-casing issues; these require append-only SQL fixes and
regressions before this follow-up is accepted.

## Authenticated draft review and consent batch

The persistence follow-up passed parent tests and independent corrective review.
The next batch connects the existing draft store to a concrete RLS-authenticated
identity resolver and a bounded GET/POST handler, with a matching customer review
component. It must not enable collection, a guarantee, money movement or new
interest terms on an existing funded plan.

- Sartre: authenticated identity from `getUser`, configured staging merchant and
  matching customer/goal RLS rows; no request-selected customer or actor.
- Russell: no-store draft read/accept handler, CSRF, bounded strict input, exact
  staged revision and hash-verified server-owned terms text; generic errors.
- Fermat: accessible draft review and explicit consent UI, reset on session/goal/
  revision/terms changes, stale-action and failure regressions.
- Hooke: actual policy store through restricted Node/PostgreSQL executor in a
  disposable local database, rather than relying only on mocked driver tests.
- Parent: composition tests, independent review, targeted and root quality checks.

Ruling: no live route or production savings-page registration in this batch.
The policy writer is deliberately local-test-only, and reviewed deployable
authentication/configuration is not yet provisioned. The handler and UI can be
composed and verified locally without reading production customer data or relaxing
that boundary. No production terms text is fabricated; missing exact documents
remain unavailable. This is an implementation boundary, not a smaller final scope.

Implementation review: all four coding assignments delivered. Parent added
`PolicyPanel` and a synthetic handler-to-panel composition test. The combined
focused suite and root lint/typecheck pass. Independent context/panel review found
no verified issues; a handler stalled-body finding was fixed with bounded timeout,
abort and cancellation regressions. Existing production savings pages remain
untouched. Actual authentication/deployment and approved terms remain unverified.
