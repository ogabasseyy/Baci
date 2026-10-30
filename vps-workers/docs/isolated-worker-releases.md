# Isolated worker releases

Production workers (GIGL tracking and every other `baci-workers` cron job and
user service) run as the unprivileged `baci-worker` user. Every push to `main`
installs the exact commit automatically; nobody runs `vps-workers/deploy.sh`
for a migrated host, and that script refuses to.

## Why a separate user

The deploy runner runs as `bassey`, which holds the GitHub CLI login, the
Actions runner credentials and docker/sudo membership. Clearing environment
variables cannot stop code running as the same user from reading those files.
Worker dependency lifecycle scripts and worker runtime therefore run as
`baci-worker`, which has no sudo or docker access and cannot read `bassey`'s
private files. `bassey` may switch to `baci-worker` (never the reverse) and has
read-only ACL access to `/srv/baci-worker` for status checks.

The worker environment omits deployment and administration credentials that no
scheduled worker reads (GitHub PAT, Supabase management token, Vercel OIDC
token, Sentry auth tokens and remediation settings). Docker-based Codex
remediation jobs are not scheduled for `baci-worker`.

## Release flow (`.github/workflows/deploy.yml`)

1. `vps-worker-sync` runs `vps-workers/release/sync-from-runner.sh <sha>` on the
   `baci-deploy` runner. It checks host readiness, then runs
   `worker-release.sh` as `baci-worker` with an empty environment.
2. `worker-release.sh build` fetches `main` from the public GitHub origin over
   HTTPS, refuses a commit that is not on `origin/main`, checks it out to
   `/srv/baci-worker/releases/<sha>/app`, installs dependencies with the frozen
   lockfiles and stages the worker tree.
3. `worker-release.sh activate` re-verifies the commit is on `main`, waits for
   the GIGL tick, switches the single `current` symlink, runs the environment
   preflight (switching back on failure), then installs the crontab and user
   services. The current and previous releases are kept.
4. The readiness, latch and capability steps run the installed release's
   verifiers through `run-as-worker.sh`, so verifier code also never runs as
   the deployment user.

Layout under `/srv/baci-worker`: `baci-workers/` keeps `.env`, `logs`, `locks`,
`state` and the GIGL latch across releases; its code entries are symlinks
through `current`. `app-live` points at `current/app`.

## One-time host provisioning

Run as root on the VPS from a checkout of `main`:

```bash
sudo bash vps-workers/release/provision-host.sh --check
sudo bash vps-workers/release/provision-host.sh
```

It creates `baci-worker`, enables lingering, writes
`/etc/sudoers.d/baci-worker` (`bassey ALL=(baci-worker) NOPASSWD: ALL`),
grants `bassey` read ACLs, and migrates `/home/bassey/baci-workers/.env`
(paths rewritten, credentials above removed). It refuses a kept setting that
still points into `/home/bassey`. The next `main` deployment then retires the
legacy `bassey` schedule and services and starts them as `baci-worker`.

## Rollback

- Previous release: `sudo -u baci-worker -H bash /srv/baci-worker/app-live/vps-workers/release/worker-release.sh rollback`
  (with `XDG_RUNTIME_DIR=/run/user/$(id -u baci-worker)`).
- Back to the legacy layout: remove the `baci-workers` block from
  `baci-worker`'s crontab, stop its `baci-*` user services, restore the saved
  crontab from `/home/bassey/.local/state/baci/legacy-worker-crontab.*` with
  `crontab <file>` as `bassey`, and re-enable the six legacy user services.
  The legacy tree in `/home/bassey/baci-workers` is left untouched by the
  migration.
  Also move `/srv/baci-worker/current` aside so `deploy.sh` accepts the host
  again, and pause `main` deployments: the next `vps-worker-sync` would
  otherwise migrate the host forward again.
