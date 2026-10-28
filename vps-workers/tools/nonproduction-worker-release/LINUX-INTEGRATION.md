# Disposable Linux broker integration check

`linux-integration.py` exercises the broker's real Linux `SO_PEERCRED` gate
using two pre-existing, disposable test accounts, then runs the actual archive
stager and worker-UID extraction path. It proves that the release UID reaches
dispatch, the worker UID is refused before dispatch, and staged files are
published root-owned with worker-write access removed.

Run only in a disposable Linux VM or container with root and two non-root test
accounts. The harness does not create accounts, install systemd units, access
fixed production paths, read credentials, or call external services. All
sockets and files live below a temporary directory that is removed at exit.

```sh
sudo python3 vps-workers/tools/nonproduction-worker-release/linux-integration.py \
  --release-uid 2101 --release-gid 2101 \
  --worker-uid 2102 --worker-gid 2102
```

The selected IDs must exist and must not be named `baci-release` or
`baci-worker`. The release and worker UID/GID pairs must be distinct. This
checks Linux kernel peer credentials and filesystem ownership using synthetic
data; it does not install or validate the production broker service, systemd
unit, host dispatcher, or production secret delivery.
