# Managed isolated savings gateway — review candidate, not deployed

The existing public TLS all-503 shell stays unchanged. This candidate replaces
only the private rehearsal listener/supervision when explicitly installed and
started by the owner. It adds no routes, database permissions, canonical
activation, funding, provider operations, production upstream, or dependencies.

## Authority and lifetime

- `binding.json` is an independently reviewed, root-owned immutable identity and
  explicit operator lease, not a renewed receipt. It has exactly `version: 1`,
  `identity`, `reviewedAt`, `leaseNotBefore`, and `leaseExpiresAt`.
- `identity` has exactly `host`, `containers`, `networks`, and `restRoutes`, with
  the same shapes as the existing private receipt. The host must be exactly
  `staging-auth.ogabassey.com`; full container/network/endpoint IDs, IPs, pinned
  image names, compose labels and approved exact routes are validated. An
  operator must independently compare these with the isolated runtime; copying
  an old receipt is not review. No tool here creates approval evidence.
- Times are canonical UTC ISO strings. Review precedes lease start; lease start
  must be reached, expiry must be future, and the total lease is at most 24 hours.
- Separate `startup-evidence.json` contains exactly `{receipt, inventory}`.
  Every start requires the original firewall/reachability receipt and inventory
  to pass the existing five-minute checks and match the reviewed identity. The
  receipt is never retimestamped, written, renewed, or fabricated by this code.
- While running, each poll reads the unchanged binding file and freshly inspects
  the four bound Docker objects. It checks health, identity, membership, routing,
  and inventory age (maximum five seconds). Binding replacement, even identical
  content with a new inode, withdraws the listener. Changed content, failed
  inspection, child exit, cancellation, backwards clocks or lease expiry also
  withdraw. Wall and monotonic elapsed time both bound the lease.
- Normal poll interval is one second; inventory subprocess timeout is 2.5 seconds,
  followed by up to one second graceful child termination before SIGKILL. This is
  polling, not atomic per-request attestation or a real-time deadline guarantee.
  Scheduler stalls can delay detection. Systemd independently caps each run at
  24 hours and kills the control group on stop. Python's existing parent-death
  guard kills the foreground nginx child if its supervisor dies.
- `Restart=no`, no timer, no `[Install]` boot target. Renewal requires explicit
  stop, fresh independent review and startup evidence, and an explicit start.
  A still-fresh receipt can be reused within its original five-minute window;
  receipts are not one-time tokens. Stale evidence never permits a restart.

## Socket boundary

The private listener is only `/run/baci-savings-gateway/ingress.sock`.
`managed-public-ingress.mjs` preserves the existing public generator's exact
routes, originless native non-OPTIONS support, strict browser CORS, bearer
forwarding, cookie stripping and error redaction, replacing only the TCP
upstream with this Unix path. It remains disabled by default. CORS is not auth;
Supabase bearer validation and RLS remain authoritative.

Systemd creates a dedicated-user-owned 0750 RuntimeDirectory. Only that user can
create/remove its socket; the ingress group can traverse/connect, not replace
it. nginx 1.30.3 explicitly chmods new Unix sockets to 0666, overriding umask;
the supervisor waits for that step then changes the same owned inode to 0660
before reporting startup success. The 0750 directory restricts access throughout.
This behavior is visible in [nginx's socket implementation](https://raw.githubusercontent.com/nginx/nginx/release-1.30.3/src/core/ngx_connection.c).
The parser may briefly bind and remove the socket without listening. Existing
paths are refused, never blindly unlinked. Cleanup removes only the recorded
inode; systemd removes the RuntimeDirectory on stop.

No public fallback to port 15440 is permitted. After withdrawal, another local
TCP listener cannot become the public upstream. Root and the dedicated gateway
UID are trusted: this does not protect against their compromise, Docker-daemon
compromise, or malicious same-UID code. Never share this service account.

## Exact root installation prerequisites (owner only; not executed)

1. Keep public all-503 active until all checks below pass. Review this source and
   its complete import closure independently and record SHA-256 hashes. Do not
   run root code from a writable checkout or `/tmp` snapshot.
2. Verify Linux systemd, `/usr/bin/node` (Node 24), `/usr/bin/python3`,
   `/usr/sbin/nginx` (reviewed 1.30.3), `/usr/bin/docker`, `/usr/bin/sudo`, and
   `/var/run/docker.sock`. Binaries and resolved paths must be root-owned and
   non-group/world-writable; nginx must have no setuid bits/file capabilities.
   Verify the existing isolated Docker runtime and firewall independently.
3. Check account/group collisions first. Provision a dedicated locked, no-login,
   no-home static `baci-savings-gateway` account and `baci-savings-ingress` group.
   Service primary group is the latter. No Docker group, general sudo grant,
   shell login, reused UID or unrelated supplementary groups. Identify the real
   public nginx worker user before granting that user ingress-group membership;
   verify effective worker groups after the owner's controlled process refresh.
4. Root creates `/opt/baci-savings-gateway` and `/etc/baci-savings-gateway`,
   owner `root:baci-savings-ingress`, mode 0750. All ancestor paths must be real,
   trusted directories, not writable by either service user. Stage these exact
   runtime files under `/opt/baci-savings-gateway`, root-owned, mode 0440:

   ```text
   managed-gateway-cli.mjs
   managed-gateway.mjs
   managed-files.mjs
   private-routing.mjs
   private-routing-inventory.mjs
   private-routing-supervisor-inventory.mjs
   private-routing-supervisor-child.py
   compose.mjs
   ```

   Also install `managed-inventory-helper.mjs` there, root-owned, mode 0550.
   These are plain files, not symlinks/hardlinks. Do not overwrite code during a
   run. Public configuration generation additionally imports
   `managed-public-ingress.mjs` and `public-ingress.mjs`; review their hashes too.
5. Install individually reviewed `binding.json` and `startup-evidence.json` at
   their fixed `/etc/baci-savings-gateway/` paths, `root:baci-savings-ingress`,
   mode 0440, single-link regular files. No secrets belong in either file. Do not
   use `chmod` to bless unreviewed receipt content or extend stale timestamps.
6. Review `managed-gateway.sudoers` and validate with
   `visudo -cf /ROOT_OWNED_REVIEW_DIR/managed-gateway.sudoers` before installation
   as `/etc/sudoers.d/baci-savings-gateway`, root:root 0440. The only permitted
   elevation is the fixed no-argument inventory helper, not node, Docker, a
   shell or an arbitrary script. The sudoers `""` argument restriction means
   no arguments, per [sudo's command matching contract](https://raw.githubusercontent.com/sudo-project/sudo/main/docs/sudoers.man.in).
   Root helper reads only the fixed binding, executes four fixed read-only
   inspect operations against the local Docker socket, strips unrelated labels,
   and emits only validated inventory. Environment injection is excluded by the
   sudo policy; inspect errors and subprocess output are not logged as payloads.
7. Review the unit and run
   `systemd-analyze verify /ROOT_OWNED_REVIEW_DIR/managed-gateway.service`.
   Install it as `/etc/systemd/system/baci-savings-gateway.service`, root:root
   0644, only after validation. Owner's subsequent control commands are
   `systemctl daemon-reload`, `systemctl start baci-savings-gateway.service`
   and `systemctl stop baci-savings-gateway.service`. Do not enable a boot target
   or configure restart/renewal. No command in this document has been executed.
8. Test the exact installed unit's sandbox and sudo/PAM behavior. This minimal
   design deliberately uses a restricted sudo helper instead of giving the
   gateway Docker access. `NoNewPrivileges=yes`/DynamicUser are incompatible with
   that elevation design; see [systemd's execution contract](https://raw.githubusercontent.com/systemd/systemd/main/man/systemd.exec.xml).
   No production claim is made for the unit before this Linux test. If local
   policy or sandbox restrictions prevent the exact helper from operating,
   leave public 503 and redesign/review the boundary; do not grant broader sudo,
   Docker membership or silently disable installed security controls.

## Readiness gates still required

- Actual Linux unit/helper/sudo validation (including extra-argument and injected
  environment denial), socket 0660 and parent 0750, no TCP listener; verify an
  unrelated UID cannot create/connect and nginx workers can connect only.
- Actual nginx parser plus isolated loopback TLS runtime tests of the managed
  Unix upstream. Use a disposable unprivileged self-signed certificate trusted
  only by that test client; no shared reload or production certificate changes.
  The prior TCP-loopback rehearsal does not validate this managed change.
- Fault-inject stale startup evidence, binding-file replacement, stopped or
  recreated Auth/REST, inventory failure, short lease expiry and supervisor
  death. Verify socket withdrawal and public 503, including while a different
  process holds 127.0.0.1:15440. Confirm no restart/lease extension occurs.
- Public configuration must still use exact host/cert paths:
  `/etc/letsencrypt/live/staging-auth.ogabassey.com/fullchain.pem` and
  `/etc/letsencrypt/live/staging-auth.ogabassey.com/privkey.pem`.
  Generate only with current startup evidence and explicit enabled=true, review
  the resulting route/hash receipt, then parser-test before any owner-approved
  public change. Keep unknown/admin/signup denials, originless native POST,
  allowed-origin preflight, foreign-origin denial, cookie stripping and generic
  failures. Do not turn expected backend 401 into 403 to hide unavailability.

## Local validation

```sh
node --test tools/staging/isolated-savings/managed-*.test.mjs tools/staging/isolated-savings/private-routing*.test.mjs tools/staging/isolated-savings/public-ingress*.test.mjs
python3 -B tools/staging/isolated-savings/private-routing-supervisor-child.test.py
pnpm exec biome check tools/staging/isolated-savings/managed-*.mjs tools/staging/isolated-savings/private-routing.mjs tools/staging/isolated-savings/private-routing-inventory.mjs
pnpm turbo lint
pnpm turbo typecheck
```

Tests use synthetic identity and injected inventory/process actions. They prove
the policy and regression behavior, not installed Linux/systemd enforcement or
real hosted readiness. Existing private rehearsal APIs retain their five-minute
limit and TCP behavior; only the explicit managed entry point selects the Unix
listener. Neither old nor new tools authorize financial activation.
