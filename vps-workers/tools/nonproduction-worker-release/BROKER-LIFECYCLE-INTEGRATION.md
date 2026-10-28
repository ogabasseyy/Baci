# Offline Linux broker lifecycle integration

This harness exercises the broker's current stage/preflight/promote/health/
rollback flow on a disposable Linux VM or container. It uses the real
`SO_PEERCRED` socket gate, release broker dispatch, archive extraction, lease
manager, lifecycle pointer operations, and filesystem state checks.

The harness substitutes only the external trust boundaries: GitHub/OIDC
dispatch returns a fixed synthetic run identity and archive, the installed
health executable returns success, and the quiescence helper is a temporary
script that emits `READY` and confirms cleanup when its input pipe closes. It
does not call GitHub, Supabase, Vercel, or other network services. It does not
use `/srv/baci-workers`, install services, create accounts, or change host
configuration. All fixtures live in a private temporary directory under
`/run`, which is removed on exit.

Use two pre-existing disposable test accounts. The selected account names must
not be `baci-release` or `baci-worker`.

```sh
sudo python3 vps-workers/tools/nonproduction-worker-release/broker-lifecycle-integration.py \
  --release-uid 2101 --release-gid 2101 \
  --worker-uid 2102 --worker-gid 2102
```

The harness validates that the worker UID is rejected before dispatch, while
the release UID can stage and preflight synthetic source. Promotion switches
the current pointer and leaves the lease helper alive until health completes;
health confirms cleanup; rollback reacquires a lease and restores exactly the
recorded prior SHA. These results establish behavior of the checked-in Linux
broker code with synthetic trust-boundary results. They do not establish that
the production systemd service, installed helpers, account provisioning, OIDC
verification, GitHub archive retrieval, or production health check are correct.
