# Isolated staging savings engagement activation

This directory contains the reviewed 25 September 2026 staging deployment helpers. It does not authorize production access, new financial transactions, a lease extension, or a change to PiggyVest's interest split.

## Current state

- Four savings engagement migrations are applied to isolated database `postgres`, cluster `7685292944002592802`. Authenticated SQL checks pass with their temporary preference changes rolled back.
- The staging-only Vercel proxy deployment is `dpl_CDYwFLFQVCJvHKfWpXkijeQvGuHR`; previous routes and webhook receiver bytes are preserved.
- Funding build tarball SHA-256: `9955bd82dfb3cac46caaf034ff13b90fb229e67ee957c507c1c2b6842fe7dcc5`.
- Restricted worker bundle SHA-256: `b15d631ccc8c39de8568589eaa930febcd234b17e4b403d6c9c96c42983b2c5a`.
- The resumed owner run completed with `SAVINGS_ENGAGEMENT_STAGING_ACTIVE` in `/root/baci-savings-engagement.ujana_sv`. Independent live checks confirm gateway, drafts, and funding remain active; notification GET/PATCH return 401 and unsupported POST returns 405 through both staging origins. The webhook receiver still returns 200.
- Both notification timers are enabled and active. The restricted database check and first worker run exited successfully; the one-shot services being inactive afterward is expected. The fixed deadline remains 29 September 2026 at 15:59:10 UTC.
- Post-activation authenticated-role SQL verification passes, including earnings, inbox, preference rollback, and cross-merchant rejection. This is database verification, not a fresh logged-in HTTP or physical-device test. The isolated database has one notification event, zero active push tokens, and zero push deliveries. Metro 8082 serves the intended `cursor-savings-phase1` mobile worktree. Phone registration and delivery remain unverified.

## Activation recovery

The original Nginx check sampled immediately after `systemctl reload` returned. That command only signals the master; a separate unprivileged rehearsal using the VPS Nginx binary reproduced the previous 404 until the new workers settled (184 ms). The corrected installer waits for two complete matching route snapshots, bounded by an eight-second wall-clock budget per activation/rollback readiness check. Persistent failure still restores the original configuration and verifies its routes. Safe failure reports include phase, expected/actual HTTP codes, and whether rollback was verified, never credentials or response bodies.

The corrected owner entry supports `--resume`. It verifies the installed artifact against the pinned archive/manifest and exact filesystem entry set, checks the service unit and existing gateway receipt, then resumes Nginx/worker activation. It does not replace the working artifact or reapply the gateway transition. The final capability flag still requires a funding-service restart with health verification. The lease is unchanged.

## Owner activation

Run on the Mac:

```sh
/bin/sh /private/tmp/baci-savings-engagement-20260925-resume.sh
```

The command handles SSH and requests sudo interactively. Never paste passwords or tokens into a task. It verifies the bootstrap and all 19 payload files before executing a root-private copy. The resume command carries the new archive checksum; the original reviewed command is superseded and must not be rerun. The initial archive (`dfbe7824354ac630c4d8f38a6ff617e4f9776e0a095d404835a78f34c9b5ce4a`) and root-private failed-run bundle remain available for audit.

Resume archive SHA-256: `d381beb98933e6e9190e07d269216032b29d26aa8405db738df6de62d8017a7a`. Resume bootstrap SHA-256: `bf9db3d81f069e9fb7d079b1ac19fe5568e90c3811bbbd43e59980d3141605b9`. The staged archive is private and single-link; all 19 internal hashes and the command's nested shell/Python arguments were verified without executing root activation. Read-only live verification matched all 11,390 manifest entries and all 13,323 filesystem entries. Recovery helper tests: 68 pass; independent Terra review has no remaining blocking findings. CodeRabbit was attempted but could not review this untracked Python scope; broad lint/typecheck still fail on unrelated existing mobile files.

The fixed deadline remains **29 September 2026, 15:59:10 UTC**. Candidate validation happens before stopping the funding service. Artifact and Nginx swaps retain rollback copies. The gateway adds exactly six routes to the existing sixteen. Credentials are provisioned for a non-superuser, non-inheriting notification role with only the reviewed application function access; no service-role key enters the worker.

The check service validates the real sandboxed database connection without queueing or delivering notifications. The API capability and timers are activated separately afterward. If scheduling fails, both timers are disabled/stopped, workers are stopped, and the capability snapshot is restored. Earlier healthy additive route/service upgrades may remain installed; the entire multi-service operation is not claimed to be atomic. Already-dispatched pushes cannot be recalled.

Expected final marker: `SAVINGS_ENGAGEMENT_STAGING_ACTIVE`. Preserve any safe failure-stage output rather than retrying old installation scripts.

## Follow-up verification

After the marker, verify authenticated wallet earnings, inbox/preferences/read actions, staging phone registration, actual push receipt, and tap navigation. An empty successful worker run, a 401 auth-boundary probe, or Expo ticket acceptance alone is not device-delivery proof. Do not fabricate a real interest credit to produce a test notification.

Focused checks currently pass: 58 Python deployment-helper tests, 32 final API/worker tests, and 166 mobile transport/push tests. The role provisioning SQL was exercised against the pinned database with a synthetic password and a transaction rollback; the role remains `NOLOGIN` before activation. Broad repository lint/typecheck retain unrelated mobile failures. CodeRabbit findings about rollback cleanup, SQL syntax, null-safe assertions, and conflicting Docker overrides were fixed and verified.
