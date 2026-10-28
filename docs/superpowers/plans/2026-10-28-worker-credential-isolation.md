# GIGL worker release credential isolation

## Status

Design only. No host, account, service, credential, or workflow changes have
been made by this document. Automatic release remains blocked until the
separate identities and checks below are in place. The current runner and the
existing workers both run as `bassey` (UID 1001); `bassey` can read
`/home/bassey/.config/gh/hosts.yml` and belongs to the Docker group. Environment
clearing, a temporary `GH_CONFIG_DIR`, and a job-scoped token do not prevent
same-UID code from opening that persisted credential file.

## Proposed boundary

Use three distinct identities on `ogabassey`:

| Identity | Responsibility | Must not access |
| --- | --- | --- |
| `bassey` | Existing administration and unrelated jobs | No automatic release or worker lifecycle code after cutover |
| `baci-release` | Dedicated GitHub Actions runner and coordinator | `/home/bassey`, worker secrets, Docker socket/group, worker service files |
| `baci-worker` | Worker checkouts, runtime secrets, cron and system services | Runner workspace, `/home/bassey`, GitHub credentials, Docker socket/group |

The release runner uses only its per-job `GITHUB_TOKEN` and OIDC identity. It
must have no persisted `gh` credential. Keep its permissions limited to the
coordinator's required repository/workflow operations. Worker code runs as
`baci-worker`, which has no GitHub token, no GitHub CLI config, no sudo access,
and no Docker membership. Do not put `GH_TOKEN`, `GITHUB_TOKEN`, the OIDC
request token, or runner workspace paths in a worker service environment.

The coordinator transfers a validated source bundle and exact SHA through a
root-owned, fixed-operation broker. The broker accepts requests only from the
`baci-release` UID, validates the coordinator identity and SHA, constrains all
paths to a dedicated worker root, and invokes a fixed release entry point as
`baci-worker`. It must never accept arbitrary shell text, arbitrary executable
paths, caller-selected service names, or caller-selected environment files.
The root broker itself must not execute repository code. Prefer a small,
auditable request format and bounded bundle size; reject archive path traversal,
device nodes, hard links, and symlinks escaping the release root.

Keep worker data outside `bassey`'s home, for example under `/srv/baci-workers`
with directories owned by `baci-worker` and mode `0750`. Store provider/runtime
secrets in a worker-owned file with mode `0600`; do not copy the GitHub CLI
credential there. Update path assumptions explicitly rather than making
`/home/bassey` traversable. Convert release-managed user units to system units
with `User=baci-worker`, `Group=baci-worker`, a dedicated working directory,
and systemd filesystem protections. Install cron entries for the worker
identity only. Review every unit and scheduled job, including GIGL tracking,
event-pipeline, quiz finalization, AI/import triggers, drain receiver, and
remediation workers; the current helpers install several with `systemctl
--user` and write the caller's crontab.

The broker should own only narrowly scoped service transitions and release
directory operations. It must not give `baci-release` general `sudo`, shell,
or `systemctl` access. The `baci-release` runner must not be in `docker`,
`sudo`, or any group that can read worker secrets or control worker services.
The `baci-worker` user must not be in `docker` or `sudo` either.

## Provisioning and migration sequence

### 1. Inventory and freeze

1. Disable automatic release dispatch while the credential boundary is absent.
2. Record the runner service identity, supplementary groups, runner work
   directory, worker unit names, cron entries, live checkout SHA, current
   worker symlink, `.env` ownership/mode, GIGL capability latch, and current
   release-lock state. Record metadata only; never copy secrets into notes or
   logs.
3. Save the current worker tree, user-unit definitions, crontab, and symlink
   targets in a root-readable rollback location. Keep the backup outside any
   path exposed to either new identity.
4. Inventory every use of the existing persisted GitHub credential. Do not
   remove or rotate it until its other consumers are known and the replacement
   workflow-token path is verified.

### 2. Provision identities and access rules

1. Create dedicated non-overlapping UIDs for `baci-release` and `baci-worker`.
   Give `baci-release` only the groups needed to run the GitHub runner and
   connect to the broker. Give `baci-worker` no supplementary groups unless a
   specific worker dependency requires one and that access is reviewed.
2. Install the GitHub Actions runner under a dedicated `baci-release` home and
   work directory. Do not copy `.config/gh`, shell startup files, or credentials
   from `/home/bassey`. Pin the runner to the coordinator workflow's label and
   restrict which repositories/workflows can use it.
3. Create `/srv/baci-workers` and its release, shared, lock, log, and runtime
   secret paths owned by `baci-worker`; use `0750` for directories and `0600`
   for secret files. The parent path must not be writable by `baci-release` or
   `bassey`.
4. Install the broker and service units from reviewed, root-owned files. The
   broker socket must be inaccessible to all users except the release runner
   identity; peer credentials must be checked on every request. The broker
   service account can be root only for fixed filesystem/service operations;
   all repository-sourced worker scripts execute after dropping to
   `baci-worker`.
5. Ensure the worker identity cannot traverse/read `/home/bassey` or the
   `baci-release` workspace. Ensure the runner cannot read worker secret files
   or change worker-owned files outside the broker protocol.

### 3. Migrate worker execution without cutover

1. Update the deploy tooling to submit a pinned SHA and source bundle to the
   broker. Keep GitHub API calls in the coordinator process; run all install,
   preflight, promotion, rollback, cron, and service operations as
   `baci-worker`.
2. Replace `systemctl --user` worker units with system units running as
   `baci-worker`. Move each worker's config and runtime files into the new
   worker root, and make scheduled jobs execute under the same identity.
3. Keep the old units, crontab, worker tree, and GIGL latch intact during
   shadow validation. Do not run a second live poller; use a non-production
   host or isolated fixture for behavioral validation.
4. Validate all required worker profiles and secret projections under the
   `baci-worker` identity. Do not run the service-role or provider preflight
   as `baci-release`.

### 4. Validate and cut over

1. On a staging host with the same account/group/unit layout, run the complete
   coordinator flow and verify exact SHA staging, preflight failure behavior,
   promote, health checks, service restart, rollback, cron installation, and
   retained-lock recovery.
2. Verify that worker child processes have the `baci-worker` UID, that the
   `baci-release` identity has no worker-secret or worker-tree read/write
   access, and that `baci-worker` has no access to the runner workspace or old
   GitHub credential file.
3. Verify negative cases: malformed OIDC identity, wrong repository/ref/SHA,
   stale main, arbitrary shell text, path traversal, escaping symlink, unknown
   service, oversized bundle, invalid archive entry, and failed health check
   all refuse without changing the active worker release.
4. Review the live process list and service properties before cutover. Stop
   old `bassey` worker units and jobs only after the new set is ready to become
   active. Confirm there is exactly one GIGL poller before enabling it under
   `baci-worker`.
5. Enable automatic release only after the checks below are recorded and the
   coordinator/app release workflow has passed an isolated integration run.

## Required acceptance checks

Run these as part of provisioning and after each account/unit change, adapting
paths to the approved configuration:

```bash
id baci-release
id baci-worker
sudo -u baci-release test ! -r /home/bassey/.config/gh/hosts.yml
sudo -u baci-worker test ! -r /home/bassey/.config/gh/hosts.yml
sudo -u baci-worker test ! -r /home/baci-release/actions-runner/_work
sudo -u baci-release test ! -r /srv/baci-workers/runtime/worker.env
sudo -u baci-release test ! -w /srv/baci-workers
sudo -u baci-worker test -r /srv/baci-workers/runtime/worker.env
sudo -u baci-worker test ! -w /home/bassey/.config/gh/hosts.yml
```

Also verify, without printing values:

- Neither dedicated account belongs to `docker` or `sudo`.
- `gh auth status` is unauthenticated for `baci-release` unless the CLI is
  explicitly given the current job's `GH_TOKEN`; there is no credential file
  in its home or runner workspace.
- Worker systemd units report `User=baci-worker`; cron jobs run as
  `baci-worker`; no release-managed unit or scheduled job remains under
  `bassey` after cutover.
- A worker probe cannot read `/home/bassey`, the runner's environment/workspace,
  or the persisted `gh` credential. A coordinator probe cannot read the worker
  secret file or mutate the worker tree outside the broker.
- The broker rejects unknown operations and paths and does not accept a shell
  string. Its log contains request IDs, SHA, outcome, and caller UID only;
  never tokens, provider credentials, bundle contents, or environment values.
- GIGL worker identity/capability, installed SHA, smoke, promotion record,
  active service count, and production release lock all match the expected
  release before proceeding to application publication.

## Rollback

If staging or pre-cutover validation fails, leave the old worker set untouched,
disable the new runner label, remove only the newly created staging data, and
keep automatic release disabled. Do not weaken account permissions to make a
failed check pass.

After cutover, if a new worker fails health checks, have the broker stop the
new worker units and restore the recorded worker symlink, unit files, and
crontab snapshot; then restart the previous worker set and verify one healthy
GIGL poller and its recorded SHA. Retain the release lock whenever publication
or worker state is ambiguous. A rollback to the old `bassey`-owned execution
model restores service, but it also restores the credential exposure; keep
automatic release disabled until isolation is re-established.

Do not delete the existing GitHub credential as part of rollback. Once all
consumers have been migrated, revoke/rotate it as a separate reviewed action
and verify the dedicated runner uses only job-scoped credentials.

## Current disposition

The current draft's local worker adapter validates the host as `bassey` UID
1001 and runs lifecycle commands under that same identity. Its `env -i` block
prevents environment inheritance but cannot hide the home-directory GitHub
credential. The current production-release workflow therefore must not be
enabled for unattended synchronization until the identities, broker, worker
unit migration, and negative access tests above are implemented and verified.
