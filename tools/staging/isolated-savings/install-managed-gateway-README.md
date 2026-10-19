# Managed gateway installer candidate — NOT RUN / NOT APPROVED FOR DEPLOYMENT

This candidate installs the reviewed dedicated account, code, unit and narrow
sudoers prerequisite only. It never starts, enables, restarts or stops a service;
never edits nginx/DNS/firewall/Docker/environment files; and never installs a
binding, startup evidence, secrets or ingress-group membership for public nginx.
The existing public all-503 shell remains untouched. `daemon-reload` registers
unit metadata only. Independent owner approval is still required before running.

## Sealed review bundle and bootstrap trust

The bundle consists of exactly the files listed in
`managed-install-manifest.json`, plus that manifest. The manifest pins the nine
runtime files (including the Python child launcher), three installer modules,
service and sudoers. It excludes tests and public ingress generation: neither is
needed to run this private service. `compose.mjs` computes a bootstrap SQL path
as template data but does not read/execute SQL; no SQL file is needed or staged.

Each file has a SHA-256 digest. An **independently recorded manifest SHA-256** is
required on the command line; reading a digest supplied alongside an unreviewed
bundle is not independent review. The manifest hash is the trust anchor, not a
signature or remote attestation. The installer uses an in-memory verified copy
of each source; its two Python modules execute only after checksum verification.

The manifest records first-line versions captured read-only through BatchMode
SSH as non-root `bassey` on 2026-09-15: Node v24.18.0, Python 3.12.3, nginx 1.30.3,
Docker client 29.6.1 build 8900f1d, sudo/visudo 1.9.15p5, and systemd/systemd-analyze
255.4-1ubuntu8.17. These observations are not installation approval. Parent/owner
must independently review them and the final manifest hash. The commands were:

```text
/usr/bin/node --version
/usr/bin/python3 --version
/usr/sbin/nginx -v                  (version is on stderr)
/usr/bin/docker --version          (client only; no daemon request)
/usr/bin/sudo --version
/usr/sbin/visudo --version
/usr/bin/systemctl --version
/usr/bin/systemd-analyze --version
```

Policy requires Node 24, nginx 1.30.3 and systemd 255 (the actual host previously
reported 255.4-1ubuntu8.17). Every recorded version must match exactly. Account
utilities and `passwd`/`nologin` have no uniform version interface: the installer
checks their resolved executable ownership/modes; the owner must review their
installed distribution package provenance separately.

**Do not run the installer as root from the worktree or a writable `/tmp` copy.**
The owner must bootstrap a new root-owned review directory beneath a trusted
real parent such as `/root`, using trusted OS tools, no existing path/symlink,
mode 0700. Copy each allowlisted regular file without symlinks/hardlinks, verify
the independently reviewed hashes *after copying*, and seal files mode 0400.
All ancestors must be root-owned real directories, not group/world writable.
Verify the distro Python executable and resolved path before the first root
invocation; a script cannot retroactively authenticate its own interpreter.

No bootstrap copy command is automatically executed or downloaded. Root must
review the installer itself before its initial Python execution; self-checking
cannot authenticate malicious bootstrap code. Re-seal/review all hashes after
any source change, including Planck's helper changes. Keep this bundle for rollback.

## Owner command candidate — placeholders intentionally not runnable

After complete source/version review and owner approval, substitute the absolute
sealed root directory and its independently recorded 64-hex manifest digest:

```text
/usr/bin/python3 -I /ROOT_REVIEW_DIR/install-managed-gateway.py --check /ROOT_REVIEW_DIR MANIFEST_SHA256
/usr/bin/python3 -I /ROOT_REVIEW_DIR/install-managed-gateway.py --install /ROOT_REVIEW_DIR MANIFEST_SHA256
```

No arguments/default invocation is refused. `--check` is read-only and creates
nothing. `--install` is explicit; there is no start/enable flag. Both require
Linux, root, isolated Python (`-I`), exact checksums, trusted source ancestry,
resolved root-owned nonwritable executables without file capabilities (only
`/usr/bin/sudo` and `/usr/bin/passwd` may be setuid; setgid is always refused),
and reviewed exact versions. Binary directory symlinks are
conservatively refused; final root-owned binary symlinks are resolved and checked.

Installation refuses existing names, directories/files, dangling symlinks,
loaded units, unit/drop-in overrides, activation links, global service drop-ins,
or a runtime socket directory. It does not adopt existing resources. The private
installer lock is `/run/baci-savings-gateway-installer.lock`; an existing lock
refuses the operation rather than being removed. Owner administrative activity
must be serialized; the lock is not protection against another root operator.

New resources:

| Resource | Ownership / permissions |
| --- | --- |
| `baci-savings-ingress` | New system group, no supplementary members |
| `baci-savings-gateway` | New non-root system UID, primary ingress group, locked password, `/usr/sbin/nologin`, no home/mail spool/log initialization |
| `/opt/baci-savings-gateway` | root:ingress 0750, nine runtime files 0440; inventory helper 0550 |
| `/etc/baci-savings-gateway` | root:ingress 0750, **empty** |
| `/etc/systemd/system/baci-savings-gateway.service` | root:root 0444 |
| `/etc/sudoers.d/baci-savings-gateway` | root:root 0440, fixed no-argument helper only |
| `/var/lib/baci-savings-gateway-install` | root:root 0700, private 0600 rollback receipt |

The code directory also retains root-only 0400 unit/sudoers validation copies.
The installer validates staged sudoers using `visudo -cf`, validates the exact
unit using `systemd-analyze verify`, then checks aggregate sudoers with `visudo
-c` after installing the narrow fragment. No general sudo/Docker group grant is
made. No copied code is writable by its service UID or public nginx workers.

## Precise rollback and failure limits

### Confirmed user-create exit 3 (2026-09-18)

Read-only SSH as `bassey` on `82.29.190.219` identified the account tools package
as `passwd 1:4.13+dfsg1-4ubuntu3.2`. Running `useradd -D -K CREATE_MAIL_SPOOL=no`
without elevation reproduced `configuration error - unknown item
'CREATE_MAIL_SPOOL' (notify administrator)` and exit 3. This defaults-only probe
did not request account creation. The installed useradd manual assigns
`CREATE_MAIL_SPOOL` to `/etc/default/useradd`, not `/etc/login.defs`, and documents
exit 3 as an invalid option argument. Plain `useradd -D` succeeded and reported
`CREATE_MAIL_SPOOL=no` (the file contains only a commented example).

The transaction removes only the invalid `-K CREATE_MAIL_SPOOL=no` pair, relying
on that verified host default. All system-account, no-home, no-log-init, locked
password, primary-group and nologin options remain. Recheck the effective
mail-spool default before an owner retry if host defaults have changed.
The local regression models the observed exit 3 and fails before the fix, then
passes with the corrected command and reversible synthetic installation.
The manifest is resealed for the changed transaction bytes only. No root retry,
remote writes, Docker bypass, or changes to previous sealed directories occurred.
The historical root failure is supplied by the owner; the non-root reproduction
confirms its cause but does not establish a successful root installation.

### Sanitized retry diagnostics

The 2026-09-16 diagnostic revision prints one fixed-stage failure line, for example:
`Managed installer failure: stage=systemd-unit-verify type=CalledProcessError exit=1`.
This is an illustrative format, **not a diagnosis of the earlier root failure**.
The previous generic output cannot establish which stage failed. A successful
standalone parser check does not prove that the install transaction reached it.

Stage names are allowlisted constants. Reports contain only stage, allowlisted
exception type, integer errno and command exit status when available. No exception
message, traceback, command arguments, stdout/stderr, file content or input path
is printed. Command failure objects do not retain captured output or arguments.
An original install failure remains primary even if rollback fails; secondary
details appear as `; rollback stage=rollback-verify type=PermissionError errno=13`.
Lock-cleanup failures similarly append `; cleanup ...` without masking the cause.

For a retry, supply the **new sealed trio and manifest**, not just a changed
entry script. Owner should return the single sanitized failure line and whether
the fixed receipt path remains. `sudoers-candidate-validate`,
`sudoers-global-validate`, `systemd-unit-verify`, `daemon-reload` and
`inactive-confirm` identify distinct gates. Account creation, staging, preflight
and rollback have separate fixed labels. Do not bypass the reported gate or
weaken the sandbox. No remote/root retry was performed for this revision.

On ordinary install failure, rollback checks the recorded newly-created
resources before removing them in reverse order. For a later explicit rollback:

```text
/usr/bin/python3 -I /ROOT_REVIEW_DIR/install-managed-gateway.py --rollback /ROOT_REVIEW_DIR MANIFEST_SHA256
```

Rollback requires the same sealed bundle/hash and binary versions, inactive
unenabled service with no drop-ins, no RuntimeDirectory, matching recorded
device/inode/mode/group/hash, unchanged locked account UID/GID/home/shell, no
process owned by that UID, no ingress-group supplementary members or other
primary users, and no unrecorded files in created directories. Later binding or
startup-evidence files cause refusal, not deletion. So does membership added for
public nginx. It never stops another process, follows a replacement symlink,
recursively deletes a directory, uses `userdel -r`, or restores unrelated files.
Only recorded files are unlinked; directories must be empty. Dedicated account
and group are removed after files; daemon metadata is reloaded last. Existing
public nginx state is never changed.

Keep the root-only receipt for owner inspection on any refusal. An interrupted
account-tool operation, SIGKILL/power loss, failed filesystem write, external
root edits or later binary upgrade can prevent automatic rollback. Account
creation and receipt persistence are **not an atomic OS transaction**. Do not
blindly rerun or remove collisions: inspect whether an account/path was newly
created, compare IDs/inodes/hashes with the receipt and sealed bundle, and obtain
owner authorization for any unrecorded residue. The lock may also need manual
inspection after a killed installer. This candidate does not claim crash-proof
rollback or protection against privileged host compromise.

## Exact-unit / sudo smoke plan — separately approved, not part of install

1. Keep the public all-503 shell. Verify installed hashes/modes, locked account,
   empty config directory and `systemctl show` inactive/static state. There must
   be no runtime listener. Confirm no group membership was added to public nginx.
2. Inspect the **actual installed unit** with `systemctl cat` and `systemctl show`
   for effective restrictions and drop-ins. `systemd-analyze verify` only parses;
   it does not prove sudo/PAM or sandbox compatibility. NoNewPrivileges can be
   implied by other restrictions on the installed systemd release. Never remove
   sandbox settings or add privileges just to make this smoke pass.
3. Under separate operator approval, independently review the exact isolated
   identity and bounded lease and provision fresh startup evidence using the
   existing controlled procedure. These files are outside installer ownership.
   Confirm a second reviewer approves the exact four inspect targets. Never
   renew timestamps on stale evidence. No production identity is allowed.
4. Owner explicitly starts the installed unit (not a looser transient copy),
   leaving public nginx unchanged. Examine the actual supervisor PID's
   `/proc/PID/status` `NoNewPrivs` and effective unit properties. Require the
   fixed helper to obtain fresh validated inventory within that unit, the owned
   Unix socket to become 0660 under a 0750 RuntimeDirectory, and no TCP listener.
   If sandbox/NNP/PAM blocks it, the expected safe result is withdrawal, not a
   permission workaround. Record a blocked smoke and redesign/re-review.
5. Owner separately validates the exact sudo policy as the dedicated UID: only
   the fixed helper with **zero arguments** may execute; an extra argument,
   `node` invocation, shell command, direct Docker command, and `NODE_OPTIONS`
   environment injection must be denied. Check installed policy and execution
   behavior; `sudo -l` alone does not prove runtime confinement. Use only
   synthetic environment markers, never tokens or real credentials.
6. Through a separately disposable non-root TLS test listener, verify native
   POST/CORS/redaction and Unix upstream behavior. Trigger bounded lease expiry,
   stale restart evidence, binding replacement and supervised child death;
   confirm listener withdrawal, no restart, generic 503 and TCP15440 decoy
   isolation. Do not stop real Auth/REST without separate approval. The earlier
   non-root Unix rehearsal validates routing, not this installed service/helper.
7. Stop the smoke explicitly under its separate authorization. Inspect removal
   of the owned RuntimeDirectory and children. Only then consider a distinct
   public ingress review; installation or smoke never authorizes financial or
   canonical activation. Remove separately provisioned smoke evidence through
   its owner before using installer rollback.

## Local-only tests

```sh
python3 -B tools/staging/isolated-savings/install-managed-gateway.test.py
python3 -B tools/staging/isolated-savings/managed-install-policy.test.py
python3 -B tools/staging/isolated-savings/managed-install-transaction.test.py
```

Tests use disposable local directories, synthetic account/binary metadata and
mocked administrative commands. No root installer, sudo elevation or service
mutation has been executed for this candidate; only the non-root remote version
queries above ran. All Python files stay under 300 lines.
