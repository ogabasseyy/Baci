# Foreground private routing supervisor

The supervisor owns one unprivileged nginx process at `127.0.0.1:15440`.
It never starts/restarts Docker containers, changes networks/firewall/DNS, installs
services, invokes sudo or reloads the shared nginx. Frozen bootstrap files are
unchanged. Currently maintenance-stopped Auth/REST must fail closed before startup.

Prerequisites: Linux, Node 22+, existing unprivileged Docker socket access,
`/usr/bin/python3`, and root-owned, non-setuid `/usr/sbin/nginx` without file
capabilities. No permissions are
granted by this program. The operator must supply fresh reviewed `{receipt,inventory}`
in the existing private-routing input format, in a regular owner-only file (0600,
owned by the calling user, not a symlink). No secrets belong in this file.

```sh
node tools/staging/isolated-savings/private-routing-supervisor-cli.mjs --foreground /absolute/private/evidence.json
```

The command stays foreground. It fetches only whitelisted Docker inspect fields
from the fixed local Unix socket, using the exact approved container/network IDs.
It reuses `generatePrivateRouting` and its inventory validation on every poll.
It parses the generated standalone nginx config in a new private temporary directory,
rechecks inventory after parsing, and starts only its own child. No external config,
PID file or existing nginx process is adopted. If port 15440 is occupied the child
fails; the other listener is never killed. Treat occupied ports as an operator blocker.

Four inventory inspections run concurrently, each limited to 1.5 seconds. After
each successful snapshot the supervisor waits at most one second. Any unhealthy,
stopped, recreated, disconnected, wrongly owned or changed endpoint/network, invalid
snapshot, Docker error or timeout withdraws the child and exits. There is no retry,
automatic restart, automatic receipt renewal or update to the original identity.
The generator's five-minute receipt lease remains in force; re-run explicitly with
fresh reviewed evidence after expiry. The parent's lifecycle lock is still required
for planned recreation; stop supervision before making lifecycle changes.

Withdrawal sends SIGTERM to the retained child handle, then SIGKILL after one second
if needed. Generated nginx uses `master_process off`, so it does not leave a worker
tree behind. SIGINT/SIGTERM/SIGHUP initiate cleanup. Parent-shell loss is detected
on the next loop. A small Python exec launcher sets Linux `PR_SET_PDEATHSIG=SIGKILL`
and checks the parent PID before/after registration: loss of the Node supervisor,
including SIGKILL, kills its direct nginx child in the kernel. No shared PID lookup,
process-group kill, `nginx -s`, systemd or hidden elevation is used. File capability
rejection preserves the parent-death guarantee across exec, as required by the
[Linux contract](https://man7.org/linux/man-pages/man2/PR_SET_PDEATHSIG.2const.html).

Polling is not atomic with Docker changes: exposure may persist for roughly the
one-second poll interval plus a 1.5-second inspection timeout and one-second forced
termination allowance (scheduler/kernel delays can extend this). Host firewall
attestation is inherited from the reviewed receipt; this unprivileged supervisor
cannot independently attest root firewall state. It does not make public routing
safe to install automatically. The future public reverse proxy remains separately
reviewed and owner-installed, and must target this loopback child only.

All nginx stdout/stderr is discarded; the generated access/error payload logs stay
off. Docker error output is captured but never printed. Supervisor messages are
fixed status strings. Health monitoring uses Docker's health state, not HTTP payload
probes. The child receives only fixed PATH/LANG, never the parent's secret environment.

```sh
node --test tools/staging/isolated-savings/private-routing-supervisor*.test.mjs
python3 -B tools/staging/isolated-savings/private-routing-supervisor-child.test.py
```

Tests use synthetic inventories/process adapters and mocked Linux calls. They do
not connect to Docker, bind ports or start nginx. Actual Linux parent-death behavior,
parser support, occupied-port refusal and bounded withdrawal need parent-controlled
private runtime validation. This task performs no remote changes.
