# Funding connection checkpoint — 22 September 2026

This is not a deployment receipt. The new goals/funding flow is not phone-ready.

## Build continuation

- The reconciled cursor snapshot contains 22,498 files; every manifest hash was verified after VPS extraction. Archive SHA256: `434cbd9d2cee9d78e05e8e67da3ae00823b0f2087970f49c9664eb46e5a90172`.
- Dependencies installed successfully in `/home/bassey/baci-funding-build-20260922-1822`. The first build exposed 30 omitted, untracked shared contract/schema files. The snapshot inclusion regression failed before the fix and all seven preparation tests pass afterward. The corrected snapshot contains 22,528 files; the delta is applied to the candidate only. The replacement low-priority standalone build re-verifies every manifest hash before building with public staging configuration and offline reads. Log: `/home/bassey/baci-funding-build-20260922-shared-fixed.log`. Build completion is not yet proven.
- Fresh public checks still return webhook GET 200, drafts GET 401, goals GET 404. No traffic cutover has happened.
- The exact dedicated staging Vercel project has `PVB_SECRET_KEY`, but it is marked sensitive and the documented retrieval endpoint returns no value (`decrypted=false`). Do not assume its presence makes it available for VPS provisioning, weaken its visibility, or expose it through a deployment. A separately approved secure source/input is needed.
- Actual disposable PostgreSQL SQL-grant and TLS rehearsals passed locally. Installer review added error-statement password logging guards before credential interpolation. Static and mocked failure suites pass in the parent session; read-only VPS installer preflight also passes. No root installation has run.
- The corrected VPS build compiled successfully, but its native TypeScript checker grew to roughly 11 GB RSS and substantial swap use. The parent verified the exact owned checker executable/PID and stopped it to protect the shared VPS. No application service was stopped. A replacement build uses `GOMEMLIMIT=3GiB`, two Go workers, and a descendant-only 6 GB RSS watchdog. Log: `/home/bassey/baci-funding-build-20260922-bounded.log`. This is still not a completed artifact or deployment.
- The cursor private-smoke runner now supports an explicit exact `hosted-funding` route contract and requires an absolute deadline for that mode. Existing product-only/draft modes remain narrow. The shared lease helper preserves that timestamp after preflight rather than extending it. Focused package/runner/lease/contract/renewal tests pass 33 checks; web lint/typecheck pass (five existing lint warnings). These files are not installed on the VPS.
- The broader gateway suite found two existing candidate inconsistencies: the inventory-helper oversized-lease test still uses a one-day bound, and the install manifest's gateway hash differs from the current gateway source. Do not reuse the old sealed installation bundle for the funding cutover. Fresh reviewed pins and owner-controlled activation are required.
- Current dedicated Vercel staging deployment `dpl_GDeAL9EC4edWUL1asZrxE563GSeL` was read back through the deployment files API. Its three source artifact files are preserved, with content hashes verified, under `/private/tmp/baci-staging-live-preserved-20260922`. The receiver hash is `37e9b485a83345d0e7b6cdc17b541fbd76a783cc23b597f9b57b1af971a6073a`. A tested artifact transformer preserves both receiver and function metadata pins, refuses an unexpected route baseline, and adds only goals/funding paths with wrong-method fallthrough rejection (four tests pass). No Vercel deployment has been performed.

## Verified this session

- The final snapshot/proxy regression run passes 12 tests. Scoped CodeRabbit review found leaked synthetic Git `PATH` state in the snapshot test; a new regression failed before cleanup was added and passes afterward. The changed TypeScript tooling files pass Biome. A full infra-worktree web lint run still reports 10 errors in other files; this is not a clean whole-worktree quality gate.
- The inactive funding-service candidate passes 15 local tests. Draft-upgrade review caught unsupported `systemctl --json=short` and an empty `Timers` property on the actual VPS; the installer must use verified supported properties before owner execution. No new installer has run.
- Draft-upgrade corrections now pass 18 tests, including unknown smoke ownership refusing rollback rather than exchanging an artifact under a potentially live process. The standalone CLI imports successfully. Final scoped review is pending. The infra web typecheck, including tools-workers, passes; this does not replace the in-progress VPS build typecheck.
- The corrected draft-unit, smoke-unit, and fixed-deadline preflights now pass read-only against the actual VPS. Scoped CodeRabbit invocation returned without a current scoped finding count; its cached findings belong to another scope and are not a clean-review claim.
- The bounded full build is terminal and incomplete (no `BUILD_ID`). A separate full-project single-checker diagnostic is running against the same candidate with Next's exact typecheck options and cache path, plus `--checkers 1 --extendedDiagnostics`; no checks or files are excluded. It has a ten-minute timeout and an exact-process 6 GiB guard. Log: `/home/bassey/baci-funding-typecheck-single.log`. This tests the upstream-reported checker-pool memory amplification hypothesis, not a proven root cause yet. An incidental pnpm exec auto-install completed; lockfile and tsconfig hashes still match the source snapshot. Do not run another install/build concurrently.
- That first single-checker diagnostic exceeded ten minutes. Its timeout parent exited but left the verified native compiler descendant alive; the parent explicitly killed only that owned PID after confirming its executable and process group. A new diagnostic increases the soft Go heap budget from 3 to 5 GiB, retains one checker and all checks, and uses a 30-minute SIGKILL timeout plus an independent 7 GiB RSS / 1.5 GiB host-available-memory guard. Log: `/home/bassey/baci-funding-typecheck-single-5g.log`; initial PID `3518627`. Completion remains unproven. Do not start a competing compiler or build.
- The 5 GiB single-checker run subsequently **passed with exit 0**: 14,248 files, 783.484 seconds compiler time, maximum RSS 5,704,656 KiB. Its verified incremental cache is in Next's actual `.next/cache/.tsbuildinfo` path. A fresh full Next standalone build is now running with that cache and all checks still enabled; `/home/bassey/baci-funding-build-20260922-final.log`. This is not yet a deployment or a completed standalone artifact.
- The normal build then passed compilation and its own TypeScript stage (9.2 seconds), but offline blog prerender failed. The repository's existing offline `build:ci` intentionally uses compile mode. Using that established mode produced a standalone artifact with exit 0; public/static assets are copied, and no `.env` files were found in the artifact. Log: `/home/bassey/baci-funding-build-20260922-ci-mode.log`. No blog source change was made.
- A private startup probe on temporary loopback port 4796 returned 500: `SUPABASE_SERVICE_ROLE_KEY is not defined`. The test process was cleaned up. Source comparison found that the latest cursor tree lacks the already-deployed hosted draft gate and domain-cache fixes from `/home/bassey/baci-drafts-build-20260920`; deploying it would regress existing drafts. Terra is reconciling those exact fixes with regression tests, without adding privileged credentials. The artifact is therefore NOT ready for cutover despite its successful build.
- Packaged artifact structural validation passes (11,425 entries), and all 22,528 original source-manifest hashes remain unchanged after the build. The current public-client key hash matches the old deployed gate. The existing public `/savings/drafts/catalogue` route is also absent from the cursor tree and must be preserved in reconciliation, not dropped as unused.
- Read-only isolated-database checks confirm authenticated execute grants for goal creation, draft command, feature-settings and Paystack-subaccount RPCs. The synthetic merchant's savings, automatic-debit, and Paystack flags are all false. Activating manual savings for that synthetic merchant is a remaining staging setup action; automatic debit and Paystack must remain disabled. No database mutation was performed by these checks.
- Reconciliation is implemented, including the existing catalogue route, shared pinned request gate, catalogue query/response validation, and missing-service-role cache handling. Parent validation: 117 tests across nine suites, web lint (five existing warnings), and full web/tools typecheck pass. Additional wildcard-search and scope assertions pass in the 11-test catalogue suite. Independent Terra review found no actionable issues. CodeRabbit was attempted but refused the 353-file library scope against its 150-file limit; no clean automated-review claim is made.
- The 13-file reconciliation delta is applied only to the user-owned build candidate, with all 22,536 source hashes verified. Archive SHA256: `be279bdfe1879a25a433783a8a71052c498cb7fe389061a9aa2a6f5ee46e52a0`. Reconciled compile-mode build passed. Its post-build full typecheck remains running (initial native PID `3653293`); log `/home/bassey/baci-funding-build-20260922-reconciled.log`.
- Private startup now returns the expected **401** for goals, drafts, and drafts/catalogue using only the public staging profile on loopback port 4796. The prior missing-service-role 500 is resolved in this candidate. The temporary server was stopped. This does not prove authenticated persistence or public activation; no root service, gateway, Nginx or Vercel cutover has occurred.
- Existing VPS gateway and drafts services both report `active`.
- The isolated database `baci-isolated-savings-db-1`, database `postgres`, has zero rows in `piggyvest_staging.integrations`, `piggyvest_staging.provisioning_integrations`, and `public.customer_savings_goals`. Do not treat the separate provider probe wallet as an application binding.
- In `cursor-savings-phase1`, the real funding error class exposed a mocked-test defect: the handler compared its formatted message with error codes. The handler now uses `.code`; the real-class regression failed before the fix. Goal/funding/ensure suites pass 30 tests.
- The separate `hosted-savings-funding` profile validates staging configuration and keeps credentials out of the exported environment object. Existing draft restrictions remain unchanged. Four environment suites pass 42 tests.
- Exact goals/funding route rendering passes two tests; snapshot preparation passes seven tests. These candidate routes have NOT been installed.

## Remaining activation gates

Latest compiler verification: the reconciled build driver completed with
`reconciled-stage-exit=0`. The full post-build TypeScript check completed in
256.111 seconds. The build and typecheck gates are now passed; public activation
and authenticated end-to-end verification remain outstanding. Two existing Terra
agents are preparing the artifact-upgrade package and fixed-deadline gateway
transition respectively; neither is authorized to run root activation itself.

Fresh runtime regression discovered at 20:36 UTC: `baci-savings-gateway.service`
is failed (exit 1 since 19:01:24 UTC), while drafts remain active. Public auth
health returns 503, drafts return 401, and webhook GET returns 200. This supersedes
the earlier both-services-active observation. The failure cause is not yet proven;
root-protected evidence and a fresh startup attestation are required before any
restart. Existing containers remain healthy. Do not infer wallet readiness from
the unauthenticated draft response. The full artifact manifest now has 11,435
entries, pinned SHA-256
`eac6de971822cf89fc8af5df7c220ec51446e4ba82c0106b8553a7b03a8bed29`.
Local PostgreSQL grants and TLS rehearsals were rerun successfully after the
compiler finished. No root install or service restart has been performed.

Owner handoff is staged at `/home/bassey/reviewed-draft-upgrade-L3L2PWeX`.
The local entrypoint is `/private/tmp/baci-reviewed-draft-upgrade-20260922.sh`.
It copies exact files into a fresh root-owned directory, verifies the separately
pinned package seal and diagnostic hash, runs redacted read-only gateway
attestation, then upgrades only the existing drafts artifact with rollback and
unchanged deadline checks. It does not activate funding, change routes, restart
the failed gateway, or claim authenticated success. Wrapper regressions pass
seven checks; artifact-upgrader regressions pass 18; diagnostic checks pass five.
The owner must enter sudo. No privileged portion has run.
Final full-artifact comparison caught differing Path-versus-string sort order,
not changed files. A regression reproduces `package/index.js` versus `package.js`;
canonical string ordering fixes it (19 upgrader tests pass). The corrected package
seal is `f32c0029421085b3f6139fd2fae9d73df288998713fc781dd5b4c47d4368eb4b`,
and the owner entrypoint pins that replacement seal. Earlier seal values are
superseded; no earlier package was installed.

The corrected final artifact now compares exactly against all 11,435 manifest
entries on the VPS. Independent scoped Terra review of the TLS/restricted-role
installer found no high or critical issue; parent local SQL/TLS rehearsals and
static/mocked failure tests also pass. The unrelated hosted migration installer
was mistakenly reviewed first and its findings do not describe this installer.
Owner sudo remains unavailable noninteractively, and both privileged activation
and the funding secret input are still pending. Do not infer activation from
review completion.

Owner execution reached the old-service stop on 22 September at 20:57:23 UTC.
Next exited 143, which systemd represents as failed/exit-code with MainPID and
ControlPID zero. The installer required inactive and therefore refused before
setting its stopped flag or exchanging artifacts. This left the old drafts
service stopped, not upgraded. The stop check now accepts only the exact captured
invocation with no processes and this specific exit 143; unrelated failure,
changed invocation, and live process cases still refuse. Regression red/green
proven; 21 identity/upgrade tests and three recovery tests pass. The bounded
recovery pins observed invocation `90ad284d65a94d3eaeb2c84eeda4b9d9` and preserves
the existing timer and unit checks before requesting a start.

Use `/private/tmp/baci-reviewed-draft-recovery-20260922.sh`, not the superseded
upgrade command. New package seal:
`76ac039225f3fb9b2dde182d2f1986f9ac165289536dcc7b3bacd27e1a4c8d8c`.
It collects the same redacted gateway diagnostic, recovers the exact stopped
draft invocation, and runs the corrected upgrade. The gateway itself remains
failed and requires fresh startup attestation; this command does not restart it.

Owner recovery/upgrade completed successfully: rollback backup
`/opt/baci-savings-drafts.rollback-1790111043`. Fresh parent checks show drafts
active with PID 3752220, private goals 401, public drafts 401, and webhook GET 200.
Gateway remains failed and public auth health remains 503; authenticated savings
and phone readiness are NOT proven. Terra is preparing a narrowly scoped gateway
recovery that preserves the existing five routes and absolute lease, rather than
mixing new funding routes into incident recovery.

Gateway recovery is reviewed and staged at
`/home/bassey/baci-gateway-recovery-GgGSd3cI`; owner entrypoint:
`/private/tmp/baci-gateway-recovery-20260922-reviewed.sh`.
It verifies installed code/receipt/binding pins, retains the exact five routes
and existing deadline, refreshes startup evidence only after current firewall,
reachability and inventory checks, then starts the stopped gateway. Parent review
fixed its helper mode pin to the actually installed executable 0550 (regression
red/green). Six runner and five wrapper tests pass. Fresh unprivileged inventory
reproduction validated in 174 ms; it does not establish why the earlier gateway
withdrew. Owner execution and public auth recovery remain unverified.

The first recovery attempt passed Python preflight but refused in the runner.
Parent reproduced a timestamp-ordering defect: receipt verifiedAt was recorded
after inventory observedAt, contrary to validatePrivateRouting's ordering rule.
The clock-advancing regression fails before the fix and passes after it. A
synthetic end-to-end runner rehearsal with the real shared startup/routing
validators also passes. The corrected runner logs only fixed stage labels for
further diagnosis, never raw errors or payloads. The same local owner command
now pins wrapper `057141c68513d14c065b806d6f71893b59ec406dc92561aa443f9fb564afd1ff`
and runner `1b668e2d533c1437fa6288a8343a850decb60eeb0e6915d960402b4cd7f19d7e`.
No successful gateway recovery is claimed until the owner retries and public
health is verified.

1. Finish and independently rehearse the `funding-setup` TLS/restricted-role installer, including failure rollback. Owner sudo is necessary for installation. Do not run an unreviewed candidate.
2. Configure a server-only funding service on loopback port 4795, with credentials readable only by its dedicated service account. Do not add secrets to the draft service on 4792. Preserve the existing lease deadline.
3. Resolve and verify the staging provider business identity and synthetic customer/merchant identity before creating the integration binding. Do not copy rehearsal fixture IDs or confuse provider customer IDs with wallet API customer IDs.
4. Add the exact caller-authorized gateway dependencies from `tools/staging/isolated-savings/managed-funding-route-contract.mjs` in the cursor worktree. The new contract is a candidate only; it is not wired into the running gateway or renewal runner. Keep privileged provisioning RPCs off the public gateway.
5. Reconcile the source snapshot with the hosted environment profile and standalone configuration without overwriting either dirty worktree. The cursor typecheck blocker is fixed: `evaluate-savings-policy.ts` now composes the shared policy primitives behind the existing validated decision contract. The status component's downstream type error is resolved without a cast. Consent, reservation, maturity review and explicit purchase confirmation remain enforced; no automatic collection or provider dispatch is enabled. Include the new evaluator and its types in the snapshot; do not disable build checks.
6. Build and review the isolated artifact. Install exact Nginx routes and prebuilt staging Vercel routes only after authenticated private checks pass. Preserve the webhook artifact and routes.
7. Verify public synthetic plan creation, persisted amount/frequency and variant, funding-account provisioning/recovery, tenant rejection, retries, and then the actual Metro phone flow. A funding sheet alone does not prove settlement, webhook processing, or interest accounting.

No production changes, provider money-movement requests, credential disclosure, or staging activation were performed in this session.
