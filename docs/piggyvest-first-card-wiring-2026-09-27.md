# First-card phone wiring: 27 September 2026

This continuation connects the existing first-card checkout implementation to
authenticated HTTP and mobile recovery. It does not substitute Paystack collection
for PiggyVest settlement or extend the staging deadline.

## Public contract

- `GET /api/storefront/customer/savings/card-checkout?goalId=<uuid>` returns
  `goalId`, `enabled`, `maximumAmountKobo`, and `currency: NGN`.
- `POST` to the same path accepts the existing first-card customer request:
  `goalId`, integer `amountKobo`, UUID `idempotencyKey`, and explicit one-time
  contribution plus saved-card consent. No actor, customer, email, merchant,
  provider-wallet or treasury identity comes from the phone.
- `PATCH` accepts only `goalId` and `intentId`, and independently verifies the
  original provider reference. Both mutations require authenticated access and
  CSRF protection. Refresh is deliberately not a mutating GET.
- The return page is `https://staging.ogabassey.com/savings/card-return`. It ignores
  payment query parameters and never asserts payment success. Its fixed
  `ogabassey://wallet` link is navigation, not financial evidence.

The separate saved-card contribution endpoint is unchanged. Manual bank transfers
remain independent. Saving a card does not enroll an automatic debit schedule.

## Receipt boundary

The existing generic Paystack webhook must not process `prefunded_first_card`
metadata or `pvb-first-` references as ordinary-wallet funding, card setup or order
settlement. A new extracted boundary runs after signature verification and before
legacy privileged access. Until a dedicated durable reconciler is installed, it
returns retryable HTTP 503 instead of falsely acknowledging a receipt.

This is a safety guard, not a working background first-card receiver. Authenticated
refresh alone does not establish unattended recovery. The dedicated staging
payment-webhook endpoint still needs activation and durable receipt verification.

Provider integration retains the official [initialize and verify contract](https://paystack.com/docs/api/transaction/)
and [webhook signature/retry contract](https://paystack.com/docs/payments/webhooks/).
Provider-return navigation never replaces server verification of amount, currency,
test domain, stored reference, original identity and reusable authorization.

## Verified baseline and parent checks

- SSH read-only inspection: gateway, drafts, funding and test-payments services
  report active; passwordless sudo is unavailable.
- Both staging origins return 404 for the new checkout, saved-card contribution
  and return paths. The payment-webhook path also returns 404 to an unsigned POST.
  These are observations of those exact paths, not proof of provider registration.
- Parent return-page and webhook suites: 113 tests passed. The first-card legacy
  routing regressions were observed failing before the boundary was added.
- Receiver routing transformer and existing receiver preservation: 23 tests passed
  across four suites including the CSRF-bootstrap addition; receiver typecheck
  passed before that routing-only addition.
  It adds only four exact paths with method rejection to an explicitly
  checksum-pinned route baseline, without replacing the PiggyVest receiver.
  The transformer has not been applied to a deployed artifact.
- `/api/csrf` was also 404 on both public origins. The exact GET-only bootstrap
  route is part of the proxy package; it must be activated on Nginx as well. The
  mobile client now consumes the existing endpoint's `token` response field.
- Parent review reproduced a real Supabase-user shape failure that minimal mocks
  missed. The context resolver now projects only the authenticated `id` and
  `email` before strict validation. Its failing regression is now green, with
  nine focused context/schema tests passing.
- Mobile first-card, persistence, recovery, completion refresh, shared-client and
  savings API checks: 81 tests passed across 14 suites; 25 scoped files passed
  Biome. Synchronous verification failures now release the recovery request latch.
- The saved-card hook extraction preserves recovery and latest callback behavior:
  16 tests passed across four suites. Its two helper suites were rerun after
  tightening the consent fixture types: seven tests passed, and both files passed
  Biome. The hook remains within the 300-line limit.
- The shared client previously dropped `goalId` when reading an existing savings
  funding account. It now preserves that explicit query field, with a regression
  observed failing before the fix. Merchant identifier construction is unchanged.
- Updated first-card SQL harness: seven disposable-database tests passed.
- The root diagnostic launcher passed its executable SSH argument-boundary and
  hash-before-execution checks; five Python metadata regressions also passed.
  The owner ran the permanent launcher and supplied the live metadata: physical
  database identity matches, but the prefunded schema, checkout functions,
  executor roles and prefunded services are all absent. This is an installation
  gap, not evidence of a phone failure. The earlier temporary wrapper is missing;
  use the maintained entrypoint rather than a `/private/tmp` command.
- Independent bounded Terra review found no critical or high issues in the new
  HTTP, readiness and mobile recovery paths. That review did not execute tests or
  prove deployment readiness.

The whole-workspace lint attempt was not clean; scoped checks are not a claim that
unrelated worktree lint failures have been resolved. The initial parallel mobile
typecheck was terminated with exit 137. After fixing the reported source and test
types, the sequential `pnpm turbo typecheck --filter=@baci/mobile-storefront
--filter=@baci/web --concurrency=1` rerun passed both tasks, including the web
restricted-worker typecheck. No build or deployment success is implied.

The diagnostic is maintained in the receiver worktree at
`tools/staging/prefunded-card/activation-preflight.sh`. It reports only allowlisted
database catalog, system service and file metadata. It checks the physical
database identity in both read-only transactions and never prints configuration
contents or credentials. It stages a checksum-verified root copy but does not
install database objects, activate a service, or modify payment state.

## Activation remains distinct

The next installation package installs only an inactive foundation. It creates no
treasury seed, card charge, customer credit or login credentials, and does not
restart services or open routes. Independent review also confirmed that foreground
checkout verification alone cannot recover first-card payments after the app
closes. Bounded recovery source over the existing durable checkout intents now
independently verifies the original Paystack reference and never initializes or
charges again. Parent review fixed sub-millisecond cursor starvation and incorrect
reporting of reconciliation as promotion, with regressions. Thirteen focused
TypeScript tests and the disposable recovery SQL suite pass. The scheduler and
durable next-cursor storage remain uninstalled. This is not a webhook-delivery claim.

The persistent receiver-worktree command is
`/bin/bash /Users/mac/.codex/worktrees/0d77/Baci-app/tools/staging/prefunded-card/foundation-install-reviewed.sh`.
It applies 36 hash-pinned SQL source files in one transaction, leaves executor
roles NOLOGIN, and requires the existing canonical ledger and public schema rather
than installing test stubs. The 7 source-builder, 10 root-runner and 4 launcher
tests pass. A full DDL rehearsal with explicitly synthetic prerequisite tables and
stub canonical functions passes; missing prerequisites, existing roles and repeat
installation refuse. This does not prove the real VPS prerequisite compatibility
or any financial operation. The package contains no test fixture SQL.

Sequential canonical web and mobile typechecks pass, along with scoped Biome.
The receiver-wide typecheck still fails in unrelated replay-signature reader/store
test mocks; its whole-tree lint also remains unclean. These are not a green
repository or deployment claim.
The requested CodeRabbit uncommitted review was attempted but refused by its
account rate/seat limit; it did not produce a review. Bounded Luna wrapper review
was completed, and its independent root SQL-pin finding was fixed and regressed.

New checkout capture must remain unavailable until restricted storage, live
readiness, worker recovery, registered receipt handling, reviewed build/config
and both public routing layers are verified together. Preserve the existing
expiry `2026-09-29T15:59:10Z` and physical staging database identity
`7685292944002592802`. No production environment or payment is in scope.

## Foundation refusal correction

The owner-run report confirmed a single false prerequisite:
`foundation_missing:piggyvest_staging.integrations.merchant_id`. Migration
`20260912090100_restrict_piggyvest_inbox_to_staging_registry.sql` defines the
provider-account registry with `id`, `expected_provider_account_id` and `enabled`;
merchant ownership lives in separate bindings/mappings. No shipped foundation SQL
uses a merchant column on that registry. The preflight and rehearsal fixture had
incorrectly invented it. Only that false precondition was removed; actual merchant
guards, physical identity, expiry, role and transaction guards remain unchanged.
No existing migration or live database schema was edited.

The corrected fixture is tied to the authoritative table declaration. Both the
unit regression and full DDL rehearsal reproduced the exact owner refusal before
the fix; afterward all nine builder tests and the full inactive DDL rehearsal pass.
The corrected package was subsequently executed by the owner. The saved VPS
report was read on 27 September 2026 at 09:14 UTC and confirms a committed
`foundation_installed_inactive` result for physical database
`7685292944002592802`: nine checkout functions, three executor roles, zero unsafe
roles, and zero operations, treasury bindings or checkout intents. The reported
SQL digest matches the reviewed corrected package. This is verification of the
saved installer postflight, not a new privileged database query from the agent.
The SSH service listing also shows no prefunded service started. Payments remain
disabled; the fixed deadline is still `2026-09-29T15:59:10Z`.

Bounded Luna review checked the 36 manifest sources and confirmed no runtime
dependency on that nonexistent registry column. The byte diff of the failed and
corrected generated SQL is exactly one removed preflight line; the 36 source SQL
bodies are unchanged. Root-runner and launcher regressions remain 10/10 and 4/4.
The full canonical typecheck passes all six tasks; workspace lint remains blocked
by unrelated existing mobile files. A CodeRabbit retry completed with four
findings in unrelated pre-existing dirty files. Its reviewed-file list excludes
the new installer files, so it does not count as installer review; Luna performed
that bounded review. The CodeRabbit output is retained in
`/tmp/baci-foundation-registry-coderabbit.log`.

The successfully executed bundle remains, checksum-verified, at
`/tmp/baci-prefunded-foundation.Uca9Ctc4` on the VPS, with the saved
`install-result.txt`. Do not rerun this fresh-install-only foundation. Its SQL pin
is `1e8ec01bc0d2bafaa720373cbba1c87c426b087659d6f657117d8068776413be`.
The previous failed bundle and report remain untouched.

Next activation prerequisites are restricted credentials/database transport,
independently verified PiggyVest treasury enrollment and customer/goal bindings,
background collection recovery plus transfer/evidence workers, and public-route
deployment with authenticated tests. No treasury amount or provider transfer is
authorized merely by this successful inactive foundation installation.

## Luna implementation and parent review: activation preparation

Three Luna agents completed independent recovery, configuration and routing
slices. These are source changes, not a live activation. Parent review reproduced
and corrected recovery-lock design defects, Nginx block/regex parsing defects,
and an exact-expiry routing gate error. No new recovery database schema or role
was retained; the recovery cursor uses a private file and an OS lock instead.

- Canonical `tools/staging/prefunded-card/recovery-runner.sh` runs a bounded
  recovery pass with a durable cursor scoped to database, merchant, integration,
  treasury and deadline. It verifies existing checkout references, never creates
  a new charge, and leaves financial promotion to the existing idempotent store.
  Its four-page limit is enforced in code; its 240-second time budget is
  cooperative. The eventual service must enforce `RuntimeMaxSec=240` or stricter.
- Canonical `tools/staging/prefunded-card/activation-config-preflight.ts` validates
  the public checkout, saved-card, recovery, transfer and receipt configurations
  together. It pins identity, transport, expiry and matching credentials without
  logging their values. The example template intentionally fails validation;
  it is not an activatable configuration or a credential provisioner.
- Receiver `tools/staging/prefunded-card/public-routing-cli.ts` renders an offline
  candidate for the four exact public paths from checksummed baselines. It
  preserves existing receiver routes, query forwarding and method rejection.
  Its report always states `activationAuthorized: false`. No live routing
  baseline has been transformed or deployed by this slice.

Parent validation: 36 configuration/recovery tests passed across eight suites;
19 routing/CLI tests passed across three suites; seven owner-diagnostic Python
tests and a real disposable PostgreSQL read-only rehearsal passed. The 34-test
existing composition/execution/public-runtime baseline also passed. Counts
overlap on recovery tests and must not be added into a unique-test total.
Scoped Biome passed for 17 canonical files and four receiver routing files.
The CLI import/redaction and two-process lock/crash-release smokes passed. The
lock smoke proves kernel semantics, not installed-wrapper end-to-end behavior.
Canonical full typecheck passed; whole-workspace lint and the receiver-wide
typecheck remain blocked by the previously reported unrelated dirty-tree issues.

Read-only live checks found no host-published port for the isolated app database;
an arbitrary localhost PostgreSQL port must not be treated as that database.
PiggyVest's main API-profile wallet reported 10,000 kobo. This observation is not
a pinned treasury enrollment or permission to use any customer/probe wallet.
No wallet was enrolled, funded, charged or transferred in this turn. The public
card-checkout route still returned 404; existing goals returned 401 and the
PiggyVest webhook GET probe returned 200. These are reachability observations,
not signed-delivery or settlement evidence.

The next owner action is a read-only VPS-native diagnostic, not another install:

```bash
bash /tmp/baci-prefunded-readiness.ztyTPbpk/activation-readiness-vps.sh
```

The staged launcher hashes the root-copied query and script before execution,
pins the physical database, runs a read-only transaction, and reports only
scoped mapping, role and transport metadata. It never prints credentials or
changes the database, services, payments or deadline. Its safe report is saved
beside the launcher as `readiness-result.txt`. Source, seven regression tests
and the disposable SQL rehearsal are maintained under the receiver worktree's
`tools/staging/prefunded-card/activation-readiness*` files. It was uploaded and
hash-verified, but no owner execution result was available for this review.

After that result, remaining work is concrete: provision restricted database
transport/LOGIN credentials and verified treasury/goal enrollment; integrate the
recovery pass with the existing transfer dispatcher and signed-receipt replay;
install the bounded service schedule; build and privately test the app; activate
the two routing layers; then prove an authenticated staging contribution through
provider settlement and customer-visible progress. The inactive foundation and
passing source tests alone do not make the phone card flow ready.
