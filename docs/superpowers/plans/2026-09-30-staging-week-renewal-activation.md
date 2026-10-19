# Staging Week Renewal Activation Plan

> **For agentic workers:** Use disjoint bounded workers; the parent reviews all integration and live-action gates.

**Goal:** Renew isolated staging to 6 October 2026 without changing production, principal, treasury authority or the retired checkout.

**Architecture:** Separate validated owner preparation, read-only activation evidence, connectivity activation and financial replay activation. Each owner bundle is sealed and refuses drift; source readiness is never represented as customer-facing readiness.

**Tech Stack:** Python, shell, systemd, Docker read-only inventory, isolated PostgreSQL and the existing gateway.

**Spec:** `docs/superpowers/specs/2026-09-26-bank-transfer-interest-verification.md`.

## Constraints

- Service deadline: `2026-10-06T15:59:10Z`; gateway deadline: `2026-10-06T15:59:10.442Z`.
- Preserve all 23 routes, exact predecessor pins and sandbox-only identities.
- Preserve 10000-kobo principal and approved treasury budget; reservation/consumption remain zero and the checkout stays retired.
- Preparation `/root/baci-week-renewal-a.8fbbHHlB/lane-a-preparation` has receipt SHA256 `152cca796e433b5f1067333a95122a1ad9f50d61697d7935ea11b32931592ace`.
- Never copy old startup evidence into a new active lease. Obtain fresh inventory/firewall/upstream evidence.
- Do not start financial workers, issue provider mutations, mint broader roles, reset counters or revive historical checkout operations.
- Pending daily accrual is observation-only. Paid-interest provisioning is a separate deployment gate.

## Tasks

- [x] Repair the stale 22-route check using the byte-identical 23-route binding; 42 focused tests pass.
- [x] Owner preparation succeeds with sealed private originals and candidates; preparation itself does not activate renewal.
- [x] Add pure receipt/original/candidate validation with red-first tests. Luna's validator passes five focused tests; the parent collector additionally recomputes the original inventory digest and financial summary.
- [x] Collect read-only, redacted activation evidence: cryptographically verified existing public JWTs, funding environment identity, restricted database role metadata, current financial invariants, current route/container identity and firewall/upstream health.
- [x] Review the collected role expiries, authorities and runtime/artifact pins before constructing a guarded connectivity activator.
- [x] Implement pinned compare-and-swap, stop expired funding first, arm and verify deadline targets before start, generate fresh startup evidence, bounded HTTP/socket/listener probes and fail-stopped recovery. Add rehearsal and failure-path tests. Connectivity activation succeeds through the user-authorized browser root console.
- [ ] Separately rebuild deadline-bound financial runtimes, renew only approved restricted credentials/functions and retain all financial fences before enabling replay.
- [ ] Verify authenticated staging and then the existing Metro phone flow; do not declare readiness based on unauthenticated 401 probes alone.

## Validation

Focused tests must prove duplicate JSON rejection, exact receipt/source/candidate correlation, physical database identity, refusal of unsafe role authority, invalid JWT signatures/audiences/issuers and no mutation during evidence collection. Run shell syntax, scoped tests and required repository lint/typecheck. Report unrelated baseline failures and unavailable external review honestly.

## Evidence Collector Source

The parent has implemented a separate read-only collector and SSH owner launcher.
This source is not evidence that the owner collector ran or that renewal occurred.
The installed funding profile uses `piggyvest_staging_provisioner` over PostgreSQL
TLS; its actual login expiry must be checked rather than assuming a provisioner JWT.
Existing public anon JWTs require signature/issuer/audience/expiry proof.
Luna's static review found unapproved predefined role memberships, curl config
loading and extra prepared-directory entries. All three have red-first regression
coverage; source fixes reject them without changing any installed security check.
The SQL tests use a disposable local PostgreSQL fixture with a private Unix socket
and no TCP listener, not either staging database.

The 77 focused tests pass, including five real PostgreSQL metadata cases and
the three review regressions. The scoped CodeRabbit review completed across
25 files and found one minor test portability issue; the fixture now falls back
to `/tmp` on hosts without `/private/tmp`. The initial direct review skipped
untracked sources, so it is not counted as an approval. The scoped review uses
an isolated clone with intent-to-add source copies, without changing the source
worktree's index, committing or creating a development branch.

Required repository lint/typecheck still fail on existing unrelated mobile
format/configuration and checkout-test typing issues. No full-repository green
claim is made. The evidence source manifest is
`5455f4aecf9fc7ce55b856a6582ac9ac698fafd23d490beeb17fccc18382a89c`.
The owner command is `stage-evidence.sh --collect`; a successful report remains
`review-required`, not renewed or phone-ready.

The 14-file unprivileged VPS source upload is now hash- and metadata-verified at
`/home/bassey/baci-week-activation-evidence-20260930-5455f4aecf9f`.
The owner ran the collector successfully: report
`/root/baci-activation-evidence.S88Q16M1/activation-evidence.json`, SHA256
`21bf0adf89c122c11353b53e17f90cdfc815484367e9ce3e228fce90729a1236`.
No live renewal, configuration, database, service, replay or payment change
occurred during collection. The funding role has an unbounded login expiry,
not an expired provisioner JWT. Connectivity activation must separately bound
that same password/login and stop the still-running expired funding service.
The public anon JWTs are signed and already cover the requested deadline.

## Connectivity activation source

The guarded connectivity activator and Mac SSH launcher are implemented.
The current source manifest is
`c9070cc7d01a316a72f2392c61394ba2fd6320bebabbda20508b1757bf3ec1cf`.
The owner action is `stage-connectivity.sh --activate`; success reports
`STAGING_CONNECTIVITY_RENEWED`, never phone or paid-interest readiness.

The full focused suite passes 123 Python tests plus one Node integration test.
The provisioner SQL has twelve real PostgreSQL cases on a private Unix socket,
covering rollback, unchanged passwords/grants/financial fences, repeat apply,
physical system, definition/authority/expiry drift and advisory locking.
New JS source/test pass scoped Biome checks. Required root lint and typecheck
still fail on existing unrelated mobile formatting and checkout-test types.

Independent Luna review identified a missing direct socket liveness probe;
red-first coverage now requires a live JSON 401 through the fixed Unix socket.
Parent review found Type=simple startup races: bounded HTTP startup polling now
precedes socket/listener assertions, with a red-first regression.
Ruling: the later ownership proof is intentional, not a weakened readiness gate;
every ownership/socket/HTTP/financial check must still pass before success.
CodeRabbit's scoped 21-file source review completed with zero issues; follow-up
source/tests add the direct socket and startup-race regressions and formatting.
No existing migrations, environment files, production configuration or source
worktree index were changed by this development. Root audit retains ambiguity
on refused activation rather than claiming no changes after a possible commit.

The user authorized executing the reviewed command in the Hostinger browser
terminal. The console identifies root on ogabassey, IP 82.29.190.219. The first
bundle refused before live preflight because the filename parser excluded the
digits in the whitelisted `ACTIVATION_SHA256SUMS` name. A real-manifest regression
reproduced the exact refusal before the fix. The corrected parser permits digits
but retains exact path whitelisting, duplicate rejection, closed membership and
all ownership, mode and hash checks; unknown numeric names remain rejected.

The corrected 25-file source upload is hash- and metadata-verified at
`/home/bassey/baci-week-connectivity-20260930-c9070cc7d01a`.
The Mac launcher passes all four tests and shell syntax validation. Independent
Luna review confirms the parser correction preserves the safety contract.
The initial command returned exit 1 before renewal. Corrected activation returned
exit 0 with `STAGING_CONNECTIVITY_RENEWED` and deadline `2026-10-06T15:59:10Z`.
The follow-up CodeRabbit review completed across 21 files with zero issues.

Independent console checks confirm all three services active/running and both
deadline timers active/waiting with next elapse 6 October 2026 at 15:59:10 UTC.
Public goals/wallet/auth return JSON 401; wrong-method goals and webhook GET
remain 405. The activator confirmed unchanged principal and approved budget
at 10000 kobo each, no payment started, financial replay disabled and the paid
interest bridge disabled. No authenticated phone, payment or paid-interest
completion is claimed. Visual proof is retained at
`/Users/mac/.codex/visualizations/2026/09/11/01a09002-424a-7832-bd7f-a592fe712ac9/staging-connectivity-renewed-20260930.png`.
