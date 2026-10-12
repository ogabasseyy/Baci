# Bounded root replay factory upgrade

Source-only helper; not run remotely by its author. Parent reviews, packages,
transports, extracts and runs. No Next build, provider POST, SQL authority edit,
payment, lease clearing, principal projection or original receipt rewrite.
The only connection check is the exact original daemon's read-only `--check`.
Readiness does not prove receipt evidence, goal completion or customer credit.

## Fixed gates

- Original container: `pvb-staging-replay-prefunded`, ID
  `b9b35efd2ffb15f7f814903a7da0eedc1b5e277cd93badd0f156afab2eb9be1d`.
- Original label/r8 seal:
  `c78ef2d125ad8019508cfced9e19d730848184c528b7a33c68d42c782418b086`.
- Reviewed artifact:
  `/private/tmp/pvb-replay-native.aE98Ku/artifact`.
- Manifest: `b0ac46778810cf5769dbd6c56c52df30ca845dc6a90e4245f1949b5826fc5e11`.
- Factory: `b73f5ed97441b8e1941badc340eefee787c43d300bdf033c46174e4e79bab9c4`.
- Deadline: Oct 6 2026, 15:59:10 UTC. All four actual predecessor byte pins
  are fixed in `owner.py` and Franklin's `prepareUpgrade`; daemon/private
  bytes remain identical. Only activation bundle hash changes semantically.
- Root reads require regular, single-link files, approved UID/mode/size and
  unchanged before/opened/after identity, timestamps and link count. Ancestors
  must be root-owned, non-writable by group/others and non-symlink directories.
- The reviewed manifest pins the five consumed Franklin modules. Package also
  pins the existing isolation validator and its contract module. The obsolete
  Sept 29 configuration/expiry helpers are never invoked.

## Parent packing command (Mac only; no live secrets)

This packages only the five owner production modules, docs, five Franklin
runtime contract modules, two isolation modules and already reviewed artifact.
Never add installed daemon/configuration or credential files to this archive.
Review the source pins before using its output as a root command pin.

```sh
umask 077
python3 -B - <<'PY'
import hashlib, io, json, os
from pathlib import Path
import sys, tarfile, tempfile
repository = Path('/Users/mac/Baci-worktrees/cursor-savings-phase1')
source = repository / 'tools/staging/prefunded-card'
sys.path.insert(0, str(source / 'replay-native-upgrade-owner'))
from owner import OWNER, KIT, MANIFEST, RUNTIME_PINS
artifact = Path('/private/tmp/pvb-replay-native.aE98Ku/artifact')
entries = {}
for name in (*OWNER, 'README.md', 'INTERFACE.md'):
    entries['owner/' + name] = (source / 'replay-native-upgrade-owner' / name).read_bytes()
for name in KIT:
    entries['kit/' + name] = (source / 'replay-native-upgrade' / name).read_bytes()
for name in RUNTIME_PINS:
    entries[name] = (source / Path(name).name).read_bytes()
for filename in artifact.rglob('*'):
    if filename.is_file():
        if filename.is_symlink() or filename.stat().st_nlink != 1:
            raise SystemExit('Artifact alias refused')
        entries['artifact/' + str(filename.relative_to(artifact))] = filename.read_bytes()
sha = lambda value: hashlib.sha256(value).hexdigest()
if sha(entries['artifact/manifest.json']) != MANIFEST:
    raise SystemExit('Reviewed manifest refused')
release = json.dumps({'schemaVersion': 1, 'artifactManifestSha256': MANIFEST,
    'files': {name: sha(value) for name, value in sorted(entries.items())}},
    sort_keys=True, separators=(',', ':')).encode()
entries['release.json'] = release
output = Path(tempfile.mkdtemp(prefix='pvb-replay-native-owner.', dir='/private/tmp'))
archive = output / 'owner.tar'
with tarfile.open(archive, 'x') as handle:
    for name, value in sorted(entries.items()):
        member = tarfile.TarInfo(name)
        member.size, member.mode, member.uid, member.gid = len(value), 0o600, 0, 0
        handle.addfile(member, io.BytesIO(value))
archive.chmod(0o600)
print(json.dumps({'archive': str(archive), 'archiveSha256': sha(archive.read_bytes()),
    'releaseSha256': sha(release), 'fileCount': len(entries)}))
PY
```

Parent transports `owner.tar` as SSH UID 1001 to a private staging directory,
then uses a separately reviewed root command. Before extraction root must:

1. Open the upload with `O_NOFOLLOW`, require UID 1001, mode 0600, one link,
   regular file, bounded size, stable metadata before/opened/after, then check
   the independently reviewed **whole archive SHA256**. Do not execute an
   uploaded bootstrap before this check.
2. Create `mktemp -d /root/baci-replay-native-owner.XXXXXXXX` with umask 077.
   Inspect every tar member before extraction. Permit only the packing command's
   regular-file names plus their directories; reject duplicate names, absolute
   paths, `..`, aliases, hardlinks, symlinks, devices and non-regular members.
   Bound each file to 16 MB, total payload to 64 MB and at most 4116 files.
3. Extract manually with exclusive `O_NOFOLLOW` writes, root ownership,
   directory mode 0700 and file mode 0600; never honor archive ownership or
   extract over an existing path. No `rm -rf` or original-container deletion.
4. Recheck every extracted file against `release.json`, and its independently
   reviewed release hash. Root helper repeats source/artifact pin checks.

## Root invocation and checklist

In the sanitized root terminal, set `directory` to that actual newly extracted
directory and `release_sha` to the reviewed packing result. Those are not
artifact/predecessor/role/expiry overrides.

```sh
/usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C \
  /usr/bin/python3 -B "$directory/owner/owner.py" --release-sha "$release_sha"
```

Default is preflight, additive generation staging and read-only check only.
It never stops/renames the original or starts a live replay daemon. Generation
is root-owned under `/opt/baci-prefunded-replay-generations/native-*`, with
code/config directories 0750 and GID 65532, code 0644 and private config 0440.
The original four files/root, r8 seal, daemon and deadline units are not edited.
The new generation seal binds original identity/state, old/new byte pins,
reviewed artifact and helper release; its hash becomes the new runtime label.

Review the redacted staged result, then explicitly:

```sh
/usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C \
  /usr/bin/python3 -B "$directory/owner/owner.py" --release-sha "$release_sha" --apply
```

Apply stages/checks a fresh generation again. It fences changes to the observed
original ID/running state. A running original must stop gracefully before
rename-aside; a stopped original is retained without starting it or its
replacement. The replacement keeps original name, immutable image, user,
mount layout, all three networks, extra host, restrictions and current ABI.
For the parent-reported stopped original, success is **swapped-stopped**.
Paused timers are permitted only for a non-starting path; before any running
replacement the unchanged effective timer must be active and expire Oct 6,
and its unchanged service must stop the exact original container name.

On failure, the helper restores the original only after any replacement has
the expected identity/isolation and is stopped; that failed replacement is
renamed aside, never force-removed. Original stays retained if replacement
identity/isolation is unproved or deadline expired: `manual_recovery_required`.
Do not blindly restart either container after that result.
Deadline is rechecked after predecessor verification, immediately before every
container start including recovery, and immediately after start/identity reads.
If it elapses during start, the verified started container is stopped and the
helper never restarts an expired predecessor.

Parent separately arms the existing fixed timer, authorizes any replay start,
rechecks original receipt/HMAC/AEAD/fingerprint and fresh empty/nonconflicted
evidence precondition, and proves evidence/completion/one-time credit through
existing restricted paths. Claim-boundary SQL review and source-baseline proof
remain parent-owned; this helper neither applies nor queries those functions.

## Targeted tests

```sh
for module in owner_io owner_deadline owner_runtime owner; do
  python3 -B tools/staging/prefunded-card/replay-native-upgrade-owner/$module.test.py || exit
done
node tools/staging/prefunded-card/replay-native-upgrade-owner/bridge.test.mjs \
  --artifact /private/tmp/pvb-replay-native.aE98Ku/artifact
```

The bridge regression verifies the actual local artifact's raw
`productionDelta`, 151-source graph and 190 captures without invoking its
factory. Positive installed-secret derivation/root Docker execution is not
run locally and remains a parent-only review/check gate.
The test requires an explicitly injected absolute artifact directory and fails
if it is missing; copying the same reviewed artifact elsewhere is supported.
Verified stopped disposable check containers are removed without force on
success/failure so the same generation can retry. Unverified checks and partial
generation directories are retained for owner review; original is never removed.

## Parent-reported root audit (2026-10-02)

Parent reports full targeted validation: **26 Python + 2 Node PASS**; not rerun
by this author. Final owner source explicitly restores child directory mode
0750 after creation under umask 077, with an exact regression. Production
source pins are recorded in `FROZEN.json`; no further production edits.
The first bootstrap path refusal was resolved using an alphanumeric UUID-hex
path, without a guard waiver. The second attempt refused directory metadata;
failed generation `/opt/baci-prefunded-replay-generations/native-mlct_i1a`
remains preserved for audit, with no live change from that failed attempt.
Parent reports **r3 root read-only PASS**, then **swapped-stopped PASS**, followed
by a separately authorized bounded start of replacement container
`5426aa344490d93dac4f6f777ef31a5ce49ec3f889a8e9cb1e99ae708a4ca111`.
The exact original container remains retained and stopped; original r8 seal
and Oct 6 deadline remain unchanged. Successful generation:
`/opt/baci-prefunded-replay-generations/native-m_xv_71j`; generation seal:
`42966bb33ae5c84223cb56a4de17da442f8ce22c38f003fbcc447e39e0a85068`.
Parent release pin:
`768ce2a340aa9f50802c453f3c85f92020e5df835795df0caecf0be888137df7`.
The owner-root identifier was reported only as `6b589...`; no full path/hash
is inferred. These audit notes postdate that release and do not rewrite its
archive, release manifest or generation seal; repacking changed docs would
produce a different release pin. No new factory build or remote actions by
this author. **Actual financial credit remains unproven.**
