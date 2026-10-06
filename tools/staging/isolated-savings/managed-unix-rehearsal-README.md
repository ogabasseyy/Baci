# Non-root Linux Unix ingress rehearsal

## Recorded run — 2026-09-15

Executed via BatchMode SSH as `bassey@82.29.190.219`, UID 1001.
Runtime: Node v24.18.0, nginx 1.30.3, Python 3.12.3, OpenSSL 3.0.13.
Read-only version check returned **systemd 255 (255.4-1ubuntu8.17)**, not 249.

The disposable source snapshot was `/tmp/baci-unix-source-QZrZ8u`; it was
removed after copying the run output and hashes locally.
Command within that directory:

```sh
BACI_MANAGED_UNIX_REHEARSAL=1 /usr/bin/node --test managed-unix-rehearsal.test.mjs
```

Result: exit 0; **1 passed, 0 failed, 0 skipped**. Test duration 450.298492 ms;
Node suite duration 567.071292 ms. Full output and copied-source SHA-256 hashes
are recorded locally in `/tmp/baci-managed-unix-vps-rehearsal.log`.

Test source SHA-256:
`d159409656130173b19b46e0277e35926618acde3915c1da282bfe373ae68855`

Test-support SHA-256:
`73f41c844f17fc2dc5e65553596d66b3fca0a40d284b4a41f47bc87e61b8fa4a`

## What actually ran

- Generated private and public managed configs; both parsed by real nginx using
  the existing unprivileged Python parent-death launcher.
- Real private nginx Unix listener and a separate real nginx loopback TLS
  listener; only test config socket paths, TLS port/certificate paths and mock
  backend addresses were substituted. No production generator was relaxed.
- A synthetic HTTP backend on an ephemeral loopback port; the public gateway
  reached it through the private Unix socket. Socket mode 0666 was observed and
  restricted by the real `secureManagedSocket` helper to 0660. Runtime directory
  was 0750 inside a private disposable 0700 test directory.
- A freshly generated self-signed certificate was trusted only by the test
  HTTPS client; TLS peer/name verification remained enabled.
- Originless native draft POST preserved the synthetic bearer header and exact
  RPC path, stripped cookies and redacted the synthetic backend's 401 body.
  Exact-origin preflight returned 204; originless OPTIONS and null Origin were
  denied. Admin/signup returned 403 and unknown paths 404.
- The real `startManagedGateway` core, using injected synthetic inventory,
  detected unhealthy Auth and terminated its owned private nginx process.
  The socket disappeared; the still-running test TLS gateway returned generic
  503 without contacting the backend again.
- An independently running synthetic decoy held `127.0.0.1:15440` throughout.
  It remained live after withdrawal and received **zero requests**.
- Owned nginx children exited; the test asserted removal of its disposable
  certificates, configuration and socket directory.

Shared public TLS `/auth/v1/user`, checked read-only through its existing port
443 with real host/SNI and certificate verification, returned 503 before and
after the test. Post-run checks found no 15440 listener, owned rehearsal nginx
process or rehearsal runtime directory. No shared nginx, service, DNS, environment file, root configuration or
Docker resource was changed. No Docker command or privileged helper was run.

## Limits and rerun gate

This validates the generated Unix routing, actual nginx behavior and supervisor
withdrawal core, **not** the root-owned file reader, installed CLI's fixed `/run`
path, dedicated UID/group isolation, live Docker inspection, sudo policy or
systemd sandbox. Exact-unit smoke testing remains a prerequisite on the actual
systemd 255 host, including effective NoNewPrivileges and helper execution.
Planck's independent inventory-validation fix is not covered by this snapshot.

The test defaults to skipped outside explicitly opted-in Linux execution. It
fails rather than displacing an existing listener on 15440. Run directly with
Node, not through Turbo cache; the dedicated opt-in variable is intentionally
not added to shared Turbo/environment configuration. Biome reports that single
undeclared-Turbo-variable warning, with no errors.
