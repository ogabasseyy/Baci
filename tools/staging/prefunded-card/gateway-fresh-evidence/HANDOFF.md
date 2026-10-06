# One-shot fresh gateway startup evidence

## October 3 endpoint-only reboot transition (source only)

`endpoint_refresh.py` is the separate entry point when restarting the same
Auth/REST containers rotates their database EndpointIDs. Existing `owner.py`,
`constants.py` and the five-file `SHA256SUMS` remain unchanged. Parent must seal
a new seven-runtime-file manifest: the existing five files plus
`endpoint_refresh.py` and `endpoint_probe.mjs`. Do not invoke this entry point
with the old five-file manifest. It authenticates the exact protected seven-file
closure before importing existing runtime modules, then extends only the
existing owner's source-file allowlist to that closed seven-file generation.
The four local Python modules are compiled/executed only from authenticated
bytes, with fixed filenames; any preloaded local module refuses before loading.
No disk import or bytecode cache supplies these modules. Every target rename
rechecks gateway-stopped state and both owned target fingerprints after the final
preserved-source guard, not merely before that guard.
The separate canonical `endpoint.SHA256SUMS` records this seven-file closure.
Parent stages those exact bytes as `SHA256SUMS` in the new endpoint owner bundle;
the canonical historical five-file `SHA256SUMS` is not replaced.

Only the authenticated old binding/evidence pins in current constants are
accepted. Candidate binding changes are limited to the two database endpoint
IDs, fixed to the independently observed October 3 values in endpoint_probe.
The existing collector obtains actual attachments, and installed routing and
startup validators enforce container/network membership, IPs, images, health,
routes and lease. A second actual inventory plus fresh health/firewall checks
must pass; preliminary inventory is not reused as startup evidence. No clock
override, profile selector, arbitrary rebaseline or deadline extension exists.

Parent must independently retain/prove the restored full configuration/profile
hashes for Auth/REST/database/mail: routing inventory checks selected security
fields and image reference, not the complete Docker profile or resolved image
ID. Parent also proves existing application deadline timers and upstream
loopback readiness before apply. Restore only the exact existing Auth/REST
containers; do not recreate containers or reconnect networks. Keep every
financial/replay/background worker stopped and serialize all gateway writers.

Stage the seven runtime files and their new manifest under the same root-private
metadata rules below. Parent first runs `/usr/bin/python3 -I -B
endpoint_refresh.py REVIEWED_SEVEN_FILE_MANIFEST_SHA` (preflight), then the same
command with `--apply` only after independent approval. Preflight replaces no
files and starts nothing. Apply durably saves both originals, both candidates
and a hash proof before guarded atomic replacement of binding then evidence.
Gateway remains stopped until both installed candidates pass the actual startup
protocol. It then uses the unchanged gateway-only start and six unauthenticated
401 checks. Every source/graph/unit guard remains active.

On failure, stop only the owned gateway invocation and restore originals only
while BOTH target bytes and fingerprints still match tracked owned states.
Any foreign target drift blocks all initial rollback writes; any ambiguous
replacement/cleanup failure requires parent review with retained private audit.
There is no retry or restart with old evidence. Two-file replacement is not
atomic as a pair; the stopped gateway and parent writer serialization are
mandatory. Historical root bundles and the five-file seal remain untouched.

Offline regressions: `python3 endpoint_refresh.test.py` and
`node --test endpoint_probe.test.mjs`. These do not prove live recovery or an
authenticated customer journey. Parent owns the seven-file seal and execution.

Source-only; no root actions have been performed by this sidecar. Parent owns staging, review and execution. The old startup receipt is 44390 seconds old against a 300-second startup gate; the binding's Oct 6 lease does not make that receipt reusable.

October 3 post-reboot manifest: `32848d397e875c6ba5f40e704f399aec01e1a3c894c11e46cf5d6275bb91ef02`.
Only the authenticated installed-evidence predecessor changed; the current
`constants.py` pin is `94d6ea52a93c04677b6b626de05b0cd358fc9970720d3677d6a7654a84276baf`.
All 23 focused recovery tests pass for this generation. The following October 2
refreeze record remains historical, not this generation's execution pin.

Source refreeze: `SHA256SUMS` SHA256 `30665e690fe14f05386cd0b7afa1487b4a6bcccb066356ede041a8132a5ae545`; `owner.py` SHA256 `a3f293ded9ac50f3ddc469cbe569ed37f66b6da98d4dee6e96d57dee28b17fd8`; `constants.py` SHA256 `a48cbef5812d568f9351d7b1ee3178d3c095a0d7400a1e8562198ce024b925e4`; `gateway_probe.mjs` SHA256 `f37c952ae9e9f6469edbca871cb6f6da0fb50777c5e9092b9087e82ebd6ef417`. Supersedes the previous source-manifest pin. The only latest runtime change fsyncs the owner directory after creating the attempt child, before backup writes; the two developer-specific test paths are now derived from the colocated test file. Existing systemctl/unit/identity guards remain unchanged.

Parent reports read-only root preflight PASS for the preceding `a29d253e659219b89e51792348480ab671128b5d4e9863168b3b16d355e4af73` manifest; no apply has occurred. That result does not validate this refrozen source. Parent must restage the reviewed new runtime closure/manifest and repeat default read-only preflight before any separately authorized apply. This sidecar performed no root action.

## Exact gates

- Binding SHA256 `9a917935bf088ee20cddc0179f680c9afc62349bae736f48e6a5d48c85a62ae5`, 23 unchanged routes, lease `2026-10-06T15:59:10.442Z`.
- Evidence predecessor SHA256 `c1ad9ba021842fc876094af62f9dd6f463de2d7aeb83337eaa821c3ae59f5ae4`.
- Both inputs must be regular, root UID0/GID984, mode0440, link count1, bounded, with trusted nonsymlinked ancestors and stable descriptor/path metadata.
- All eleven parent-observed installed graph pins are fixed in `constants.py`: root UID0/GID984, link count1, mode0440 except inventory helper0550. No fallback to local canonical hashes. The unused installed smoke runner differs from current canonical; its parent-supplied installed pin is deliberately retained. Neither smoke nor renewal wrapper is executed.
- The seven existing gateway/drafts/funding service/deadline unit files and gateway sudoers are captured afresh, hash/metadata checked unchanged throughout. Only gateway gets a start/stop command. No stale connectivity owner's financial or preparation snapshot is imported.
- Existing gateway unit must resolve to the exact non-root CLI, service account/group, Restart=no, no drop-ins, no pending reload and no environment injection. Existing gateway must be inactive/failed with MainPID0; this helper never restarts an active gateway.
- Parent reports that actual root `systemctl show --all` exposes only `Environment` among Environment-prefixed properties, even when `EnvironmentFiles` is requested. Missing `EnvironmentFiles` is accepted only alongside the exact expected remaining property keys, empty `Environment`, no drop-ins, NeedDaemonReload=no, loaded state and the exact fragment/account/group/launcher. Present nonempty `EnvironmentFiles`, missing `Environment`, and any unknown EnvironmentFile/PassEnvironment/UnsetEnvironment fields refuse.
- Gateway unit is explicitly pinned to parent-observed SHA256 `8539934f7d9a499e93158388843097cda7c31a398c22df4d8e9a0400170a0bf3`, `/etc/systemd/system/baci-savings-gateway.service`, root UID0/GID0, mode0644, link count1. Protected byte/hash/metadata validation runs at capture and every effective-state check; no omission is accepted without this proof. Matching canonical unit bytes contain no Environment, EnvironmentFile, PassEnvironment or UnsetEnvironment directives. Parent independently reports the same absence in effective systemctl cat. The immutable captured fingerprint is also preserved throughout. No new root probe is required for this source change; parent still owns fresh execution validation.

## Root bundle and execution

### October 3 endpoint recovery executed

The authorized reboot stopped all four `restart=no` base containers. Parent
restored the same database, mail, Auth and REST container IDs with their complete
Config/HostConfig fingerprints unchanged. Docker rotated only the two bound
database attachment endpoint IDs; their container IDs, private IPs and network
IDs remained unchanged. The original evidence-only owner correctly refused.

The separate endpoint transition preserves all other binding fields and uses
the installed routing/startup validators with fresh health, firewall and actual
inventory checks. Its seven-file manifest is
`b92ac2d817cb3eba21ce8630db1bc13ee02388d2489cbcf582d854767a7a3358`.
Parent authenticated the archive
`e827486b7ceab7d99b4b1b4de90b6168933ae1769504283e24a99e41f9214980`
and protected it at `/root/baci-endpoint-complete.9pgoeego` before execution.
Default preflight passed; the separately reviewed apply then reported
`endpoint-refresh-applied`. Both original files, candidates and continuity proof
are retained in its protected `attempt-endpoint-*` directory.

Parent independently confirmed nine public Auth/customer-route GETs return
401 JSON, the four complete container profiles remain unchanged, no prefunded
containers are running and the October 6 deadline is unchanged. The preserved
old plan still has 10,000 kobo; the pending new plan still has zero. No new
payment, transfer, SQL application or balance credit occurred. These checks
prove fail-closed service availability, not a completed authenticated payment.

There are 52 focused recovery tests; the endpoint JavaScript Biome check passes.
CodeRabbit's remaining trivial repeated-validation suggestion is intentionally
not applied: retain the extra proof boundary. Its earlier portability finding
is fixed. Independent review's metadata-atime and authenticated-import issues
are also fixed and regression-tested. The five-file owner and its old binding
pin are historical after this apply; do not rerun either owner against changed
predecessor bytes or retimestamp old evidence.

The financial diagnostic baseline includes Auth table rows. A fresh password
grant would change protected session data, so this recovery did not run one or
silently rebaseline the pending ledger repair. Authenticated acceptance still
needs the separately reviewed existing-payment continuation and evidence gates.

The owner-authorized October 3 reboot left the application services stopped. A
fresh read-only root inspection authenticated the installed evidence against
`/root/baci-gateway-fresh.2526066cd3f24866832fcd2c46436768/attempt-1790977128685401716/proof.json`
(SHA256 `eaa655fc5e7b6da1e8c8b63903cc209c40e42023167fdea3e9d82a41b56511cd`).
That retained audit binds the unchanged binding and the October 2 installed
candidate `c1ad9ba...` to the preceding `835f8efd...` evidence. The recovery source
now pins that exact installed predecessor; it does not accept arbitrary evidence
or retimestamp old receipts. Existing root bundles and their backups stay intact.
The binding, source graph, deadline and verification requirements are unchanged.
Application upstream services must pass their existing deadline and loopback
checks before gateway verification. No financial worker is started by this helper.

Stage only the five runtime files listed in `SHA256SUMS` plus `SHA256SUMS` into a new **direct child** of `/root`, root:root directory0700, each source/manifest root:root0600, link count1, no symlinks. Do not modify installed graph or existing seals. Independently review/check the source manifest SHA256 before first execution. No installs or package dependencies are needed.

From that protected directory, verify the source manifest externally and run:

```sh
/usr/bin/sha256sum --check SHA256SUMS
/usr/bin/python3 -I -B owner.py 32848d397e875c6ba5f40e704f399aec01e1a3c894c11e46cf5d6275bb91ef02
```

Default is preflight: actual read-only health/firewall/Docker inventory and installed proof validation, with no evidence replacement or gateway start. A private lock file may be created in this new owner bundle. Preflight only returns sanitized hashes/status; it does not save or self-approve a rehearsal receipt.

After independent review, use the **same reviewed source-manifest pin**:

```sh
/usr/bin/python3 -I -B owner.py 32848d397e875c6ba5f40e704f399aec01e1a3c894c11e46cf5d6275bb91ef02 --apply
```

Apply repeats all fresh checks; it does not consume a stale preflight receipt or override the clock. The helper refuses at integer `2026-10-06T15:59:10Z`, preserving the existing binding's .442 suffix without extending any financial deadline. Parent must serialize other gateway/evidence writers while executing; the private lock cannot coordinate unrelated owner tools. Binding and all preserved-file fingerprints must remain unchanged.

## Actual proof and target-only mutation

1. Reuse the sealed installed `validateManagedBinding`, `collectSupervisorInventory`, `validateManagedStartup` and `generateManagedGateway` implementations. No copied/relaxed schema or constructor guard.
2. Perform exact unauthenticated GET health checks for bound Auth/REST private IPs (HTTP200). Require the existing `iptables -C INPUT` NEW-connection DROP rule on both `baci-stg-db` and `baci-stg-mail`; missing rules refuse, never install rules.
3. Only after those checks succeed, collect actual bound Docker container/network inventory and build a new receipt from the byte-pinned binding identity. Validate exact live IDs, endpoints, health/membership and five-minute startup/five-second inventory freshness with the installed proof protocol. The old receipt is backed up, not retimestamped.
4. Before mutation, create a fresh private `attempt-*` backup directory under this new owner bundle, fsync the owner directory to persist that new child entry before writing any backups, then retain original/candidate evidence and the preserved-file hash report as root0600 files, fsync. Parent-directory sync failure refuses before backup writes or evidence replacement. Revalidate evidence freshness and exact predecessor hash plus fingerprint. Atomically rename a same-directory root0/GID984/mode0440 candidate over **startup-evidence.json only**, then fsync and verify its hash/metadata. This compare-and-rename is not a filesystem compare-and-swap against a concurrent root writer; parent serialization is mandatory.
5. Start **only** `baci-savings-gateway.service`, check its invocation, service/runtime/socket identity, then demand HTTP401 for the Unix Auth user route, public Auth user route, and public storefront wallet/goals/drafts/funding GETs. Curl sends no bearer/API key/body and never follows redirects. These are unauthenticated fail-closed availability checks, not proof of an authenticated customer journey.
6. Recheck preserved file/evidence fingerprints and gateway invocation. On start/postcheck failure, stop only the owned gateway invocation and restore the original evidence bytes only if the installed candidate hash still matches. Never restart using stale original evidence. If concurrent drift or rollback failure occurs, retain backups and require parent review; do not overwrite foreign bytes or claim recovery.

No binding, source, roles, profiles, timer definitions/schedules, Nginx, SQL, financial rows, provider/payment/transfer, budget or interest-payout routing changes. No daemon-reload, reset-failed, enable, automatic retry or deadline extension. Re-running after successful application refuses the changed evidence predecessor rather than rewriting a fresh receipt.

## Local validation

Only colocated mocked/pure tests were run. The 44390-second case is checked against the real canonical gateway proof functions with synthetic identity/inventory, then fresh mocked health/firewall/inventory checks pass without changing binding or overriding time. Root metadata, transaction order, default preflight, backup-before-replace, compare refusal, no active-gateway restart, drift refusal, failure restore and exact unauthenticated GETs are covered.

Refreeze validation: all 23 focused tests pass (5 Node + 7 transaction + 4 protected-I/O + 7 owner). The new durability regression was RED with mkdir followed directly by backup writes, then GREEN with mkdir -> owner-directory sync -> three backup writes; sync failure also blocks every backup write. The existing absent-EnvironmentFiles ABI regression, exact unit pin/metadata checks and injection/drift refusals remain passing. These are local mocked regressions, not independent live root execution evidence. Focused Biome check of `gateway_probe.mjs` and `gateway_probe.test.mjs` passes with zero errors; all five runtime checksum entries verify. Every source/test remains under 300 lines. No broad checks or root actions were run.

```sh
node --test gateway_probe.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 transaction.test.py
PYTHONDONTWRITEBYTECODE=1 python3 owner_io.test.py
PYTHONDONTWRITEBYTECODE=1 python3 owner.test.py
```

Live root/service/filesystem behavior remains parent validation; no local test is represented as live recovery proof.
