# Operator shutdown for automated remediation

The release-independent marker `/home/bassey/.config/baci/remediation.disabled` keeps automated remediation disabled across deployments that include this change. The operator owns this file; it is outside the worker release tree and is not removed by release promotion or rollback.

When the marker exists, deployment skips the Codex remediator image build and launch-barrier installation. The locked cron-transition step checks the marker again, covering shutdown requests made after deployment starts. The final locked cron merge also checks the marker and removes the Vercel, Sentry, PostHog, canary and remediation-storage-cleanup jobs from the generated fragment. Other workers and Vercel log collection remain unchanged.

Create the marker and disable the existing remediation schedules while holding `/tmp/baci-workers-deploy.lock`. Creating the marker alone does not remove existing cron entries or stop an already-running job. Do not delete worktrees or terminate unrelated workers as part of shutdown.

Re-enabling requires explicit owner approval: remove the marker and deploy the reviewed worker release to rebuild its image and restore its schedules. Do not remove the marker during routine cleanup.

If the marker is removed after a deployment skipped preparation, the final locked cron install refuses to enable remediation and requires a fresh deployment instead of installing jobs without their prepared image.

## Current rollout boundary

On 23 October 2026, the marker was installed and the existing five remediation schedules were disabled. The code change remains local and unreleased. Older deployment scripts do not honor this marker and can still recreate schedules until this change is released. No complete worker deployment, application reload, recording-account mutation or live payment activation was performed.

## Verification

`node --test vps-workers/jobs/deploy-remediator-crontab.test.mjs` covers persistent shutdown during cron merge and shutdown requested after deployment started, alongside existing rollback and stale-release guards. The deployment source guards and 32 cron-transition tests also pass. Repository lint and typecheck pass.

The disabled PostHog entrypoint explicitly requests quiet dotenv loading so dependency informational output does not break its silent-exit contract. Its regression test clears inherited quiet configuration to exercise the actual default behavior. The full VPS worker suite passes: 880 passed, four skipped, zero failures (884 tests).

CodeRabbit's final review of the six modified worker files completed with zero findings after the re-enable race was fixed. These checks cover the local candidate, not a deployed worker release or the full monorepo test suite.
