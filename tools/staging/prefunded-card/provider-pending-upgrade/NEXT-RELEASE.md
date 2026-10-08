# Additive public Next release handoff

The deliverable is an isolated source/build kit, not a deployed release. Do not
run these parent-only commands from this sidecar. Mac free space measured on
October 2 is 3.3 GiB; no local Next build, installation or remote action was run.
The existing protocol is public-source.mjs -> Next standalone with --webpack ->
public-artifact.py -> public_artifact.validate_archive. The webpack configuration
retains runtime public configuration and the /savings/card-assets prefix; switching
to default Turbopack would bypass that reviewed configuration.

## Immutable installed predecessor

- Original local build: /private/tmp/baci-first-card-build-20261002.FUTQPHUB.
  Its installed source is source-readonly-r2/source-manifest.json, not source/.
  Its release is release-readonly/. That local build directory is now absent.
- Staged VPS artifact path recorded in the renewal protocol:
  /home/bassey/baci-first-card-artifact-20261002. Availability has not been checked.
- Installed tree: /opt/baci-prefunded-public/app; receipt:
  /opt/baci-prefunded-public/receipt.json. Parent must verify actual current bytes.
- Public archive SHA256: 882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2.
- Public manifest SHA256: 42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8.
- Installed source manifest SHA256: 4b066d0e957b4f029c1be1e5c71c1496e269600d1763414645882d832c5c07d7.
- Preserved launcher SHA256: d0d0a249a940f9783cc2d8784868ca776c65f2e060ca4095736e4fea70b61f03.
- Original r8 seal: c78ef2d125ad8019508cfced9e19d730848184c528b7a33c68d42c782418b086.
- Provider predecessor SHA256: 3965a85d8f2966a49e0df39fbc5019e96ab7e2514f47bf16a65dd7cd6afce785.
- Provider successor SHA256: 6acb4d8a5b69984224bf7754c97bcefa93c38cf78b6f5ea0c014d561c0ed22e8.
- Fixed deadline: 2026-10-06T15:59:10Z. No renewal is authorized here.

The exact original builder image and dependency-cache location are not retained
locally. Parent must obtain them from the original builder's provenance; never
guess them from the public runtime image or substitute current dependencies.
The local dependency cache currently reports Next 16.3.4 while AGENTS lists
16.2.9. Neither value proves the sealed installed framework version. Read the
actual Next package.json from the validated predecessor archive and preserve that
version. The finalizer rejects framework version changes independently.
The frozen candidate-snapshot in the kit is review material. It is not proof of
the installed predecessor and must not be built as the approved successor until
its complete delta is proven. source_delta.py instead verifies the exact installed
source manifest, every file, generated input and rewrite, and prepares that
predecessor with only the approved provider line added. No ambient worktree
change enters that source. Missing original source/cache provenance blocks build.

## Parent-only isolated builder commands

After transferring and independently verifying every next-kit.json file digest
and its externally supplied SHA256, set these task-specific variables to actual
reviewed paths. Do not use a live application checkout as PVB_WORK or as cache.
PVB_OLD_RELEASE contains the old archive/manifest and an exact launch-public.cjs.
PVB_OLD_SOURCE is the retained full source-readonly-r2 tree. PVB_DEPENDENCIES is
the original builder's complete Linux node_modules tree, with all symlinks inside
that tree. PVB_BUILDER_IMAGE is the original cached image's sha256 image ID.
PVB_PARENT_CHAIN is the independently approved current chain head, with r8 as its
immutable ancestor; it equals the r8 seal only when no additive parent exists.

```sh
PVB_KIT=/home/bassey/<verified-new-next-kit>
PVB_OLD_SOURCE=/home/bassey/<retained-exact-source-readonly-r2>
PVB_OLD_RELEASE=/home/bassey/baci-first-card-artifact-20261002
PVB_DEPENDENCIES=/home/bassey/<original-linux-cache>/node_modules
PVB_BUILDER_IMAGE=sha256:<original-approved-cached-builder-image-id>
PVB_PARENT_CHAIN=<approved-current-parent-chain-sha256>
PVB_WORK=/home/bassey/<unique-new-offline-next-build>
umask 077
test ! -e "$PVB_WORK"
test ! -L "$PVB_WORK"
mkdir -m 700 "$PVB_WORK"
PYTHONDONTWRITEBYTECODE=1 python3 "$PVB_KIT/source_delta.py" \
  --predecessor-source "$PVB_OLD_SOURCE" --provider "$PVB_KIT/provider.ts" \
  --output "$PVB_WORK/source-provider-only" > "$PVB_WORK/source-preflight.json"
sha256sum "$PVB_OLD_RELEASE/public-app.tar.gz" \
  "$PVB_OLD_RELEASE/public-app.manifest.json" "$PVB_OLD_RELEASE/launch-public.cjs"
df -B1 "$PVB_WORK"
du -sb "$PVB_DEPENDENCIES"
docker image inspect --format '{{.Id}}' "$PVB_BUILDER_IMAGE"
```

Verify those three old hashes against the immutable list above. Independently
validate the old archive with public_artifact.validate_archive before the build.
Refuse unless the approved cache is at most 1 GiB and free space exceeds cache
size plus 5 GiB. Verify the complete cache's file/link manifest against its
original independent pin, architecture, Node 22, the installed archive's Next
version and the original builder's TypeScript version. No download, pnpm install,
image pull, checkout or cloud build is permitted.
If the cache cannot be attested or free space is insufficient, stop at the kit.

```sh
mkdir -m 700 "$PVB_WORK/build"
cp -a "$PVB_WORK/source-provider-only/." "$PVB_WORK/build/"
cp -a --reflink=auto "$PVB_DEPENDENCIES" "$PVB_WORK/build/node_modules"
PVB_BUILD_NAME=pvb-provider-next-<unique-reviewed-id>
PVB_BUILD_CID=$(docker create --pull=never --name "$PVB_BUILD_NAME" \
  --label com.baci.provider-next.parent="$PVB_PARENT_CHAIN" \
  --network=none --read-only --cap-drop=ALL \
  --security-opt=no-new-privileges --user="$(id -u):$(id -g)" \
  --memory=4g --cpus=2 --pids-limit=256 --ulimit=core=0:0 \
  --tmpfs=/tmp:rw,nosuid,noexec,size=256m,mode=1777 \
  --env NODE_ENV=production --env NEXT_TELEMETRY_DISABLED=1 \
  --env NODE_OPTIONS=--max-old-space-size=3072 --env HOME=/tmp \
  --mount "type=bind,src=$PVB_WORK/build,dst=/build" --workdir=/build \
  "$PVB_BUILDER_IMAGE" /usr/local/bin/node \
  node_modules/next/dist/bin/next build apps/web --webpack)
timeout --signal=TERM --kill-after=30s 900s \
  docker start --attach "$PVB_BUILD_CID" > "$PVB_WORK/next-build.log" 2>&1
docker inspect "$PVB_BUILD_CID" > "$PVB_WORK/builder-container.json"
```

Only run with an image attested to contain no credentials and the reviewed
baseline environment. No application/provider variables, credential mounts,
Docker socket or service networks enter the builder. On timeout/interruption,
parent inspects and stops only PVB_BUILD_CID after matching its exact ID, name,
image and parent-chain label. CLI timeout alone does not prove container exit.
Retain it stopped for provenance; do not remove unrelated containers.

Verify State.ExitCode is zero, actual NetworkMode is none and all recorded
limits/mounts match. Compare every copied source and rewrite against the immutable
source-provider-only manifest before and after compilation; record any compiler
changes to generated TS/config files separately. Next creates next-env.d.ts and
may update tsconfig.json; unexplained runtime source drift refuses the result.
Verify traced package bytes came from the attested copied cache. Read the actual
Next route manifest and require exactly the five public-artifact.py ROUTES.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 "$PVB_KIT/tooling/public-artifact.py" \
  --web "$PVB_WORK/build/apps/web" \
  --launcher "$PVB_OLD_RELEASE/launch-public.cjs" --output "$PVB_WORK/release"
sha256sum "$PVB_WORK/release/public-app.tar.gz" \
  "$PVB_WORK/release/public-app.manifest.json"
```

Parent records actual independently collected builder evidence in
builder-attestation.json: network="none", exitCode=0, nodeMajor=22,
nextVersion equal to the validated predecessor's package version,
flags=["--webpack"], actual imageId, original attested
dependencyTreeSha256, candidate sourceManifestSha256, routesVerified=true and
sourceInputsVerified=true. These are real evidence, not a generated pass template.
After reviewing and independently pinning its bytes:

```sh
PVB_ATTESTATION_SHA=<independently-reviewed-builder-attestation-sha256>
PYTHONDONTWRITEBYTECODE=1 python3 "$PVB_KIT/seal_release.py" \
  --old-release "$PVB_OLD_RELEASE" --new-release "$PVB_WORK/release" \
  --source "$PVB_WORK/source-provider-only" --parent-chain "$PVB_PARENT_CHAIN" \
  --attestation "$PVB_WORK/builder-attestation.json" \
  --attestation-sha256 "$PVB_ATTESTATION_SHA" > "$PVB_WORK/chain-report.json"
sha256sum "$PVB_WORK/release/additive-public-chain.json"
```

The finalizer validates both actual archives/manifests, retains the exact old
launcher and source delta, and generates an additive old/new pin chain with every
changed archive file for parent review. New archive/manifest/chain pins do not
exist before a successful actual build; none are invented in this source kit.
Review all changes, including generated build IDs/assets and dependency files.
The seal reports compiled-only and still requires the actual runtime baseline.
Never edit an original r8 seal, receipt, source pin or permanent SQL to accept it.

## Root staged upgrade and recovery plan

Parent captures a new root-private 0700 audit directory on the isolated host,
pins the exact retained r8 bundle and current additive chain, and copies verified
old/new archives/manifests/source reports and builder evidence into it. Capture
the current receipt, complete installed tree with ownership/modes/link counts,
mounted digest, container ID/image/label/environment/mounts/networks, effective
units/drop-ins/timers, config hashes and mutation-gate state. Current container
labels may reference an older original manifest; preserve that observed identity
and validate it against its reviewed history rather than assuming it equals r8.
All current bytes must match the approved exact predecessor under the upgrade lock.

The new parent-reported TEST payment of 10000 was collected once and r3 promoted
without transfer. Establish the protected baseline after that state, including
that collection, promotion, operation/intent, receipts and immutable history.
Do not use an old zero-operation assertion, retired-intent assertion, stale
protected snapshot or fixed current-wallet amount. Historical original principal
and company budget remain 10000 bounds; actual current rows require fresh reads.
Read back independently in a repeatable-read read-only transaction.

With one exclusive lock, close public mutations and stop background dispatch and
its schedule; settle inflight requests. Stage the validated archive in an immutable
private sibling on the same filesystem. Write/fsync a phase journal before each
rename or container operation. Retain the predecessor tree, container, receipt,
unit/config bytes and schedule state; do not delete them or overwrite unknown states.
Stop public, verify the exact stopped predecessor again, rename old app aside and
new app into place. The additive receipt references old/new archive/manifest and
chain pins while retaining the original receipt separately. Recreate the public
container with a reviewed successor label and the same image/isolation/mounts;
retain the old stopped container by rename. The runtime flag stays read-only.
The original launcher bytes and deadline timer remain unchanged.

Before declaring staged upgrade successful, prove mounted successor bytes,
container isolation/deadline, unauthenticated GET/POST/PATCH 401, authenticated
capability GET 200 enabled=false/max zero, authenticated POST/PATCH 503, callback
and CSRF/assets. Verify complete protected fingerprints equal the fresh baseline.
Do not verify a provider transaction, run recovery/background/provider --check,
retry the completed collection or transfer funds as a post-check.

On failure/interruption, keep mutations closed and dispatch stopped. Classify
trees/receipts/containers by exact old/new hashes and the journal; stop only the
verified owned successor, retain it and failed artifacts, restore predecessor
tree/receipt/container identity, fsync and re-prove mounted bytes and denials.
Never roll back SQL, money, completed payment history or r3 promotion. Parent
reviews any restoration of the original mutation state separately; default stays
read-only. Ambiguous inflight financial outcomes require the parent's recovery.

## Franklin dependency and activation gate

The public composition and background recovery both import the shared postgres
executor. Franklin's generic-claim fence can therefore affect either full static
closure even if Next tree-shakes its runtime branch. source_delta.py intentionally
includes only the provider line; it never copies Franklin's changing worktree.
Keep the existing background candidate separate and do not resume its financial
schedule from this public-only chain. Parent either seals Franklin as a subsequent
exact-predecessor artifact chain or explicitly reviews a combined source-delta
manifest and rebuilds both consumers from that frozen approved closure. This is
coordination of dependency scope, not permission to change his files or SQL.
Parent owns fresh baselines, staged execution, recovery and eventual activation.
