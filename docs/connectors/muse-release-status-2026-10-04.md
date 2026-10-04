# Muse connector release status — 4 October 2026

## Verified locally

- Connector runtime, route, page and helper suite: 165 tests / 22 files passed.
- Connector schema suite: 8 tests / 1 file passed.
- Privacy disclosure and integration status suites: 9 tests / 2 files passed.
- Total selected coverage: 182 tests / 25 files, no skips.
- Biome: 57 touched web TypeScript/JSON files clean.
- Web typecheck: 21 pre-existing Google Ads errors; no connector errors.
- Frozen dependency install succeeds with the repaired esbuild lockfile importer.
- `git diff --check` passes.
- The earlier full-monorepo run did not finish; it is not a clean full-suite result.

The stable-ID retry correction includes a new request fingerprint migration;
this and the constraint guard migration were subsequently applied as recorded below.
Historical migration files were not rewritten for these corrections.

## VPS packaging

A gateway-only Node bundle replaces the monorepo dependency installation in
the production image. The VPS built image
`baci-connector-gateway:review-295878cdfbfb02cd` successfully. An isolated
container with no production network/credentials returned discovery 200 and
missing-credential 401, then was removed. This is packaging evidence, not a
production database or merchant-access proof.

## Review override and live runtime update

The owner explicitly instructed that CodeRabbit be skipped when unavailable.
The failed final review is therefore recorded as skipped, not a release blocker
and not a clean review. Prior local review fixes and checks remain as recorded.

The VPS gateway is now running and healthy using the dedicated least-privilege
role over the session pooler on port 5432. Its credential was generated without
printing it, installed in a mode-0600 file under a private service-user directory,
and was not added to source control. Main database password recovery was not
needed. Discovery and docs return 200; an unauthenticated order call returns
401 GRANT_REVOKED. Health, credential-management and unknown public paths return
404. These checks establish transport/authentication denial, not an authenticated
merchant proof. No merchant grants were created.

The request fingerprint migration was applied as provider version
20261004184006 and the constraint guards as 20261004184016. Existing production
constraints were inspected first. No production regression fixtures were added.

## Remaining release gates (earlier observations below are historical)

The final CodeRabbit run failed with a rate limit before reviewing the latest
changes. It reported that all three included reviews were used and the Git
provider account has no assigned seat for usage-based reviews. Its reported
retry window was 45 minutes; account seat assignment or an Agentic API key is
another documented recovery path. Do not describe this as a clean final review.
Evidence: `/Users/mac/Downloads/Baci-Muse-Submission/coderabbit-final.log`.

At the last live check, `https://muse-api.usebaci.com/openapi.json` returned 502.
The production gateway still needs secure role/runtime provisioning, deployment,
and live verification after review. The updated dashboard/privacy also needs
the approved current-main VPS prebuilt release flow. Do not deploy the entire
legacy worktree as a substitute for that reconciliation.

The Muse submission is a prepared review draft, not submitted. Verify the live
URLs, merchant setup, reviewer access and disclosures before accepting its terms
and submitting. No production store writes are authorized by this read-only
connector scope.


## Current-main release checkout

The release changes are isolated in
`/Users/mac/.codex/worktrees/baci-muse-production/Baci-app`, based on
`5cde09ff96a9695ae172503df5d1493a03eb32e6`. The original R0 worktree is preserved.
The six production migration files use the actual provider ledger versions and
SQL. The original colliding R0 migration is stored only as
`apps/web/tools/connector-harness/grants-r0-fixture.sql` for local regression tests.

Current-main validation: 188 targeted tests / 27 files passed; web typecheck
completed with zero errors. Full web lint passed over 11,174 files after correcting the moved fixture
reference formatting; 10 warnings remain in untouched code. The full web test run is pending and must not be represented as passed.

The Muse form reset to empty; the overview, logo, technical URLs, and honest
release-status notes were restored to the Review step. Terms are unchecked and
nothing has been submitted. A screenshot is saved in Downloads as
`Baci-Muse-Submission/live-gateway-review-draft.png`.


## Current-main integration corrections

The broad web run exposed missing migration-manifest entries and the repository's
colocated-test/300-line runtime checks. The six production migrations are now
hash-bound in the replay manifest and its independent expected-source fixture.
The replay verification/materialization tests passed 34/34 after that correction.
Large gateway, harness and management-route modules were split into focused
handlers; new direct boundary/UI tests complement the existing HTTP/DB suites.
The resulting connector selection passed 214 tests in 43 files. Web typecheck is
clean, and the changed-runtime contract analysis returns no findings.

The initial broad web run was stopped after module/test paths changed during
repairs, so it has no valid completion summary. Two Cloudflare evidence tests
were independently diagnosed: they require a clean committed worktree and a
lockfile matching HEAD. Their refusal on this uncommitted release checkout is
recorded; no evidence-protection checks were weakened. A clean committed-head
run remains required before the web release. CodeRabbit remains owner-waived
when unavailable; this does not label an unrun review or unfinished suite as passed.


Final local evidence for the prepared release: 214 connector tests passed;
37 affected replay tests passed; web typecheck passed; all 80 changed connector
TypeScript files pass Biome; full analytics delivery authority verification
passed. No commit, PR merge, web deployment or Muse submission was performed.
The live gateway remains the separately verified image in the deployment receipt.
The next release decision is approval of the existing GitHub-hosted prebuilt
workflow versus retaining the VPS-only deployment requirement.

## Deployment authorization

The owner explicitly approved the existing GitHub-hosted prebuilt dashboard/privacy
release workflow on 2026-10-04. This authorizes that deployment fallback; Muse
submission and Terms acceptance remain separately recorded actions. CodeRabbit
is skipped when unavailable under the owner's explicit instruction.

## PR review follow-up

PR #3629 found missing pg_cron provisioning in the isolated replay, now handled
by a loopback-only runner prerequisite with cron execution disabled and source
hash verification. The original six applied migration files remain unchanged.

Current fixes enforce owner-only grant creation and tool-time authority in a
new append-only migration; cap active grants at the 50 connections exposed by
the management list under a merchant advisory lock; authenticate management
requests before CSRF/body parsing; retain a stable browser connection ID across
indeterminate retries; remount all merchant state on merchant/owner changes and
ignore unmounted async completions; and reject duplicate or over-200 branch
selectors before database access. The new SQL regression is in the CI replay.

The suggestion to expose production-local refresh is declined: the current
production contract deliberately disables all staging credential endpoints,
including refresh, at both application and public proxy boundaries. Owners
reissue through the authenticated, request-bound management API. Automatic Muse
refresh is not claimed; an expired connection requires a new owner-authorized
connection. The staging refresh proof does not establish a production refresh
endpoint. No public access boundary was expanded as part of review fixes.
