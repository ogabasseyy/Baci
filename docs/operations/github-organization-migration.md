# Baci organization and merge queue preparation

Prepared 2026-10-31. Preparation only: no repository transfer, organization creation,
app installation, deployment, queue enablement, or protection-rule change is authorized
by this document. The destination organization is awaiting owner selection.

## Verified baseline

- Repository: `ogabasseyy/Baci`, numeric ID `1100488586`, public, default branch `main`.
- Existing organization `Ogabassey-Services-Limited` reports plan `free`; this is an
  available candidate, not an approved destination.
- Classic protection requires `Build`, `Quality Gate`, `Semgrep SAST` from GitHub
  Actions (app ID `15368`), with strict/up-to-date checking and administrator enforcement.
- Active ruleset `10436556` requires one approval, stale-approval dismissal,
  designated CODEOWNERS approval, resolved review threads, linear history, no
  deletion/force push, and no bypass actors.
- Squash and rebase merging and auto-merge are enabled; merge commits are disabled.
- Repository runners `baci-deploy` and `baci-android` report online.
- One active repository webhook includes `merge_group`. Retaining a subscription
  does not prove its receiver supports the event or the new repository owner.
- Installed-app inventory could not be retrieved with the current CLI credential
  (403). Complete it in GitHub Settings > Integrations before transfer; do not
  interpret workflow job names as a complete app-installation inventory.

## Prepared workflow behavior

`security.yml` receives `merge_group` and runs the existing protected-branch scoped
Semgrep scan on the integration commit. Missing manifests, skipped targets,
scanner errors, and unscanned requested files fail closed, just as on push.
Scheduled/manual full scans keep their existing behavior. No new credentials or
scanner entitlement is introduced.

`ci.yml` already runs Build and the full Quality Gate on merge groups. This change
also runs Silent Revert Guard against `merge_group.base_sha` and `head_sha`, and
requires it to succeed for queue Quality Gate results. An intentional revert's existing `allow-silent-revert` label is honored only if
its current PR head, merged with the exact queue base, produces the entire queued
tree. A label cannot waive checks for unrelated grouped changes. Missing API
access, objects, conflicting merges or an unrecognized queue ref fail closed
(the normal detector still runs). Use one-PR groups for intentional reverts;
groups with extra changes remain blocked rather than receiving a blanket waiver.

The queue does not modify the source PR branch. It tests a temporary integration
of latest main plus queued changes, then merges using the configured method.
Keep current strict/up-to-date protection during preparation. Use **squash** for
any later queue activation to preserve linear history. A queue or rebase does not
prove semantic intent: regression tests, final-diff review and CODEOWNERS remain
necessary. Silent Revert Guard detects exact recent-blob restores/deletions, not
every possible semantic regression. PR-only AI review checks must still finish on
the reviewed PR head before enqueueing; do not blindly require them on queue SHAs.

## Integration work before transfer

| Integration | Required preparation and verification |
| --- | --- |
| GitHub applications | Inventory Vercel, CodeRabbit, Codex/assistant access, Jules and any other installed apps. Approve/install the needed apps in the destination with access scoped to Baci. Verify each required check's source app after transfer. Check vendor billing before accepting paid organization plans. |
| Vercel and VPS | Keep the existing Vercel project/team, project ID, domains, environment variables and approved VPS prebuilt deployment flow. Verify the Git connection and destination app access; reconnect the same project if necessary. Do not import a duplicate project or start cloud builds. Update VPS checkout remote and explicit canonical-repository guards together. |
| Self-hosted runners | Record runner registration scope/labels and organization runner policies. Verify both repository runners reconnect and can pick up approved jobs after transfer; re-registration may be needed. Do not run releases as migration smoke tests. |
| GitHub Actions | Verify org Actions policy permits existing pinned actions and reusable local actions, repository/environment secrets and deployment environments remain accessible, and required check contexts remain unchanged. |
| Credentials | Check PAT resource-owner/repository scope, GitHub App installation IDs, OAuth organization approvals, and any OIDC `repo:OWNER/Baci:...` trust subjects. Update only confirmed consumers; never expose or copy secret values into the plan. |
| Mobile releases | Keep Apple/Play/Expo project identities, signing assets and credentials. Verify repo/app linkage, Fastlane certificate-repo access, Android runner and release permissions before the next separately authorized release. |
| Supabase / monitoring | Keep existing database projects and runtime endpoints. Check any GitHub-linked branches, Sentry/PostHog source links and commit/release associations for the new slug. No database migration or project transfer is required solely for the GitHub move. |
| Other links | Update local/worktree/VPS remotes, automation repo selectors, package/container namespaces if used, badges and links. GitHub Pages URLs do not redirect. Do not create a replacement repo at the old path; that can remove redirects. |

## Canonical identity update points

Do not change these to an invented slug or add an arbitrary environment override.
Once the owner approves a destination, prepare an exact-slug patch coordinated with
host configuration. Retain the numeric repository ID check and fail-closed origin
validation. Revalidate the ID after transfer; regenerated CWV attestations must
bind the new name rather than reuse old receipts.

- `.github/scripts/release-remote-validation.mjs`: canonical release repository;
  `.github/scripts/release-production.mjs` consumes it.
- `infra/cwv-runner/owner-api-transport-primitives.mjs`: repository identity.
- `infra/cwv-runner/owner-api-transport-operation-evidence.mjs`: runner API path.
- `infra/cwv-runner/task9-pr-metadata.mjs`: PR/workflow API paths and base identity.
- `infra/cwv-runner/exact-run-contract.mjs`: exact-run identity contract.
- `infra/cwv-runner/runner-identity-contract.mjs` and `runner-identity-gate.mjs`:
  expected URL and repository name.
- `infra/cwv-runner/host-attestation.mjs`: expected GitHub URL.
- `infra/cwv-runner/verify-owner-cli.sh` and `exact-run-controller.sh`: shell
  repository identity assertions.
- Update corresponding regression fixtures and approved host-installed copies
  atomically; do not replace historical evidence or unrelated repositories such
  as a signing-assets repository.
- Audit release worker configuration and external automations outside this
  checkout; the source scan is not proof that remote configuration is ready.

## Later cutover sequence (requires separate authorization)

1. Select destination; confirm free plan, public visibility and owner/admin access.
   Complete app inventory and approve each necessary integration's access.
2. Land reviewed queue workflow preparation through existing CI/approval gates.
   Prepare the exact-slug identity patch and runner/VPS changes. Avoid an active
   deployment or store submission during the transfer window.
3. Snapshot effective rules, required checks/source apps, Actions policy,
   environment protections, runner labels, webhook metadata and secret **names**.
4. Transfer only after owner authorization. Retain visibility and verify numeric
   ID, branches, PRs, rulesets and classic protection on the new path immediately.
5. Apply coordinated exact-slug/remote changes and reconnect integrations. Leave
   merge queue disabled until required checks, reviewer approvals and runner
   access have been verified on the destination. Existing production remains
   hosted in the same projects; verify its health without publishing a release.
6. After separate queue authorization, require queue on `main` with squash,
   conservative build concurrency 1 and maximum merge group size 1 initially.
   Keep approval/CODEOWNERS and strict checks. Validate a harmless reviewed PR
   reaches queue CI, passes all three required checks on its integration SHA,
   then merges by squash. A merge may trigger existing release workflows, so
   schedule this validation within an authorized release window.
7. If checks stop reporting, pause merges and repair integrations. Do not weaken
   protection or immediately transfer back: GitHub can retire old namespaces.

## Cost and references

GitHub Free organizations cost $0 and public organization repositories qualify for
merge queue. Personal Pro stays separately billed and does not upgrade the org.
Standard hosted runners for public repositories are free; storage, larger runners,
third-party apps and self-hosted infrastructure can have their own charges. Keeping
Baci public is essential to this free merge-queue plan; a private org repository
requires Enterprise Cloud for native queue (Team alone is insufficient).

- [Merge queue eligibility and integration events](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [Repository transfer behavior and redirect caveats](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)
- [GitHub pricing](https://github.com/pricing)
- [Account-specific GitHub App installations](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)
- [Vercel Git deployment access](https://vercel.com/docs/git)
