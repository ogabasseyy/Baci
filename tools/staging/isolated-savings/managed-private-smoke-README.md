# Owner-run private smoke candidate

The revised candidate is prepared for nonroot staging, not root execution. Parent
review and an owner root session are prerequisites. No installed source is changed. The parent
supplied `managed-private-smoke-identity.json`; its pinned identity is independently
validated again against freshly collected runtime inventory. Routes must be exactly
products GET/HEAD. No credentials, POSTs, draft RPCs, database/provider mutations,
public enablement, nginx configuration, DNS, group additions, or other service
changes are performed.

## Exact prerequisites

- Owner has reviewed both scripts, identity, installed manifest, and hashes below.
- Linux root session; trusted `/usr/bin/node` matching the installed reviewed Node
  v24.18.0 and trusted system binaries (`systemctl`, `sudo`, `visudo`, `docker`,
  `iptables`, `id`, `getent`, `flock`, `sha256sum`). No injected loader environment.
- Parent independently approves current actual container/network/endpoint identity.
  The supplied identity's digest below binds that approval; never regenerate it
  automatically on a failed check.
- Existing root-owned installed runtime matches every source hash and exact mode;
  unit and sudoers plus saved copies match the manifest. The install receipt must
  match manifest `9d2cbe1cbff31644c7de503ab92f195cebcd44fb6661c91a343e38ce788d2ccc`.
- Existing `/opt/baci-savings-gateway` and `/etc/baci-savings-gateway` are
  root:ingress 0750. Config directory is empty; runtime directory absent; dedicated
  account has no running process, no supplementary groups, and ingress has no
  explicit members. In particular no www-data membership is introduced.
- Exact installed unit is loaded, inactive/failed, disabled/static, Restart=no,
  NRestarts=0, no drop-ins, and NeedDaemonReload=no. The candidate does not repair
  or reload any of these prerequisites.
- Both existing firewall rules must pass root `iptables -w 5 -C INPUT -i BRIDGE
  -m conntrack --ctstate NEW -m comment --comment baci-isolated-savings -j DROP`
  for `baci-stg-db` and `baci-stg-mail`. It never inserts firewall rules.
- Auth private-IP GET :9999/health and REST private-IP GET :3000/ must return 200.
  Inventory collected afterward must validate. No earlier receipt timestamp is used.
- Exclusive owner maintenance window: no other operator starts/stops/reconfigures
  this unit during the run. Use the shared administrator lock in the command below.
- Owner separately places only the two scripts, identity, manifest, and checksum
  file into `/root/baci-private-smoke`, directory root:root 0700, files root:root
  0400. All ancestors must be root-owned and not group/world writable. This task
  must not overwrite earlier root-sealed artifacts; use a fresh directory per revision.

## Owner command after review and sealing

Run in a root shell on the intended host, with the prerequisite directory already
prepared. Verify the checksum list itself against this reviewed document first.

```sh
cd /root/baci-private-smoke
/usr/bin/sha256sum --strict --check managed-private-smoke.SHA256SUMS
```

Only if that succeeds, execute:

```sh
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C HOME=/ \
  /usr/bin/flock --nonblock /run/lock/baci-isolated-savings-admin.lock \
  /usr/bin/node /root/baci-private-smoke/managed-private-smoke.mjs \
  4283c805a0acb5eb8b86fd6074209ddbb9f875c5bbeae1d30b6b02ed91009479 \
  9f20a73f5bbfa5d30d74dba66d950a938c59a5fbdfbe1e4d329f998c57a6f33b \
  /root/baci-private-smoke/managed-private-smoke-identity.json \
  2681c4befbe401304afdde5fb96a823f10b911cd2b9509e67d9aca10530e594b \
  /root/baci-private-smoke/managed-install-manifest.json \
  9d2cbe1cbff31644c7de503ab92f195cebcd44fb6661c91a343e38ce788d2ccc
```

The entry has only built-in static imports. It verifies its own bytes, the runner
helper hash, sealed identity/manifest, install receipt, every installed runtime
file, and both unit/sudoers copies before any dynamic import. External checksum
verification is mandatory because self-verification alone cannot authenticate code
that has already begun execution. Preserve the installed source unchanged.

## What execution proves and does not prove

Fresh root firewall and GET checks precede new validated inventory and exclusive
creation of binding/startup-evidence as root:ingress 0440. The lease is exactly
60 seconds from evidence preparation, including startup time, without renewal.
The exact installed unit starts once; a 10-second socket readiness poll requires
socket 0660 and parent 0750. Private GET /auth/v1/user must be 401 and GET
/auth/v1/admin/users must be 403. A successful running gateway exercises the real
inventory sudo path. MainPID and actual `/proc/PID/status` NoNewPrivs are reported;
NoNewPrivs=0 is reported accurately, not presented as a hardening pass.

Extra arguments, direct node/docker, and env-wrapper use
`sudo -n -l -U baci-savings-gateway` policy queries only and must each exit 1
without a signal or timeout. The no-argument helper listing must succeed.
Environment-assignment listings appear without `--` and are informational:
only clean exits 0 or 1 are accepted. Their ordered exit codes (NODE_OPTIONS,
NODE_PATH, LD_PRELOAD) are reported with `executionFilterProven: false`.
Unexpected errors, timeouts, or signals still fail closed. No forbidden candidate
is executed. Listing success is explicitly not execution-filter proof.

The owner's diagnostic on sudo 1.9.15p5 returned 0 for all three assignment
listings, while all four forbidden command listings returned 1. The original
harness incorrectly treated assignment listing success as a policy failure.
The entry still verifies the exact reviewed installed sudoers hash, including
`env_reset`, `!setenv`, `NOSETENV`, and `env_delete`; this revision changes
neither sudoers nor the service. These static checks and informational listings
do not claim a runtime environment-injection test.

After the 60-second lease, withdrawal is required within a 70-second monotonic
window: absent socket, inactive/failed unit, no restart. Command timeouts can add
up to eight seconds to the final poll; there is no unbounded wait or automatic retry.
An early exit fails the lease test. Failed state after withdrawal is acceptable;
the candidate does not reset-failed, restart, enable, or change the unit.

Finally, it stops only its started invocation if still running. If stop fails,
invocation changes, or shutdown cannot be confirmed, evidence is preserved and an
explicit redacted cleanup failure is emitted. Otherwise only files it exclusively
created with unchanged inode/metadata/content are removed. No directory is deleted.
SIGINT/TERM/HUP trigger bounded checks and cleanup; SIGKILL/host failure can leave
evidence, requiring owner inspection. Do not rerun over remaining files.

## Local validation and limits

```sh
node --test tools/staging/isolated-savings/managed-private-smoke.test.mjs tools/staging/isolated-savings/managed-private-smoke-runner.test.mjs
node --check tools/staging/isolated-savings/managed-private-smoke.mjs
node --check tools/staging/isolated-savings/managed-private-smoke-runner.mjs
```

Scoped tests cover changed hashes/permissions/config collision,
fresh-evidence ordering, sudo listing shape, private auth failure, expiry timeout,
changed invocation, evidence preservation on stop failure, observed assignment
listing success, informational denial, and fail-closed abnormal listing results.
Full repository tests are deliberately not run for this revision. Service startup,
socket permissions, actual NoNewPrivs and withdrawal remain unverified until the
owner runs this candidate. Final parent review is pending.
