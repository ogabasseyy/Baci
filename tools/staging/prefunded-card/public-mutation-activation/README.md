# Parent-owned public mutation gate

Local implementation only. No financial activation, public enablement, payment,
transfer, settlement or provider outcome has been observed by this sidecar.
The actual report from `/root/baci-financial-owner.2ynkl9kc` is still required.
Never substitute a prepared/inactive receipt or a boolean readiness assertion.

**Only r8 is accepted:** financial source seal
`c78ef2d125ad8019508cfced9e19d730848184c528b7a33c68d42c782418b086`.
Both the constructor and final gate reject earlier seals even if their evidence
is internally consistent. The parent's reported parser-repair predecessor
provenance is `/root/baci-interest-parser-repair.yzgOduMP/provenance/manifest.json`,
SHA256 `1445e1b2a7f9e7e28801c8bd036b833fdbe8ec02facb5bc4d5e00c0c71e7de42`.
That report describes unchanged compiled outputs/isolation with the exact daemon
alias repair and corrected installation predecessor label. This sidecar has not
read that remote file or observed r8 installation/financial activation. Consume
the r8 bundle and its actual successful owner gate result; r7 is insufficient.

The fixed deadline is October 6, 2026 at 15:59:10 UTC. Enablement stops ten
minutes earlier. Company prefunding is **10,000 kobo TOTAL**, including any
replenishment, separate from the unchanged old goal principal of 10,000 kobo.
The old intent `d8bcf921-61b3-4647-90e2-5648e4d6967d` stays retired at its original
September expiry. Saved-card contributions and auto-debit remain disabled by
the pinned launcher's existing environment projection. Save-card consent on
first-card checkout does not enable either later flow.

## Inputs still required from the parent

After actual `owner_gates.activate_financial` execution, retain its exact result
in a root-private file under the financial audit directory. Pin its SHA256.
Capture an independent `protected_snapshot.snapshot_sql()` result **after**
the authorized snapshot/background operations. Capture `mutation_chain.sql()`
through the existing isolated local-postgres boundary; retain its raw JSON in
a separate root-private file. Both queries are read-only and roll back. Review
the full chain baseline against the approved scopes, retired history, runtime
source seal, function ACLs, RLS, triggers, constraints and indexes. Its digest
is an approval of concrete observed bytes, not a generated readiness flag.
This sidecar does not automatically approve a freshly collected baseline.

The parent must review this sidecar and seal these eight files by exact SHA256:
`mutation_contract.py`, `mutation_chain.py`, `mutation_runtime.py`,
`mutation_gate.py`, `mutation_owner.py`, `mutation_runtime_bounds.py`,
`systemd_deadline_reader.py`, and this `README.md`.
Retain the source-verified financial preparation bundle unchanged. Supply the
actual renewed readiness request, pinned installed/private artifacts and
signing keys; recheck their correspondence to the reviewed installed runtime.
Do not invoke expired public/worker installers, their old unit constructors,
or the old public DB baseline requiring zero intents. No compiled patching,
deadline monkeypatching, role/password/ACL changes or budget replenishment.

Create a new root-owned 0700 `/root/baci-public-mutation.<unique>` audit directory
and a reviewed root-private request file with these fields:

- `financialBundle`: source-sealed preparation directory on the owner host.
- `financialSealSha256`: the exact r8 preparation digest above.
- `financialReport`, `protectedBaseline`, `chainBaseline`: each a pinned record
  `{path, sha256, owner: 0, mode: 384}` directly under the financial audit root.
- `runtimeRequest`: `{path, sha256}` for the reviewed root-private readiness request.
- `publicService`: pinned `{path, sha256, owner: 0, mode: 420}` for the unchanged
  `/etc/systemd/system/baci-prefunded-public.service`; review its complete bytes.
- `audit`: the new root-private mutation audit directory.
- `reviewedSidecarSha256`: exact filename-to-digest map for the eight files above.

## Separately reviewed systemd compatibility reader

Ubuntu 26 serializes oneshot commands as repeated `ExecStart=` properties.
`systemd_deadline_reader.wrapper(arguments, run=originalcommand, **kwargs)` accepts only
the three sealed `readiness_evidence_timers.STOPS` deadline service names and
the exact `FragmentPath,DropInPaths,NeedDaemonReload,LoadState,ExecStart` show
request, with or without `--no-pager`. All other commands/results pass through.
It refuses missing/extra/duplicate non-command properties, changed loaded-unit
identity, command count/order/path/argv drift, duplicate command fields, junk,
and any `ignore_errors` value other than `no`. Only validated original command
records are joined into one property; their bytes/metadata remain unchanged.
All command keywords (including `timeout` and `input_text`) pass unchanged to
the underlying runner for both targeted and unrelated calls. This updated
source is for the next separately reviewed sidecar stage, not replacement of
the parent's existing staged financial collector bytes. Its separate adapter
may use `def compatible(arguments, **kwargs): return wrapper(arguments,
run=lambda originalargs: originalcommand(originalargs, **kwargs))` with the
previous staged reader. No validator is bypassed in either form.
Sealed fragment pinning and timer/target validation still run unchanged.

The parent may supply this separately pinned reader as `run=wrapper` to sealed
financial evidence collection; record its helper SHA and provenance separately.
Public mutation collection uses it only for deadline timer collection, not
active worker/service proofs. No r8 bundle, installed byte, label, constructor
or global function is changed or monkeypatched. Compatibility alone never
authorizes public enablement; the runtime bounds below must also pass.

## Executing source and runtime bounds

Stage the separately reviewed sidecar in an isolated directory and execute its
shared dependencies directly from the retained r8 bundle's `tooling` and
`contracts` paths. Do not invoke it with sibling worktree dependencies, even
if those currently have identical bytes. `RuntimeBounds.verify_sources()`
independently hashes the exact r8 manifest, traverses the loaded import closure
from all seven sidecar modules, and matches each dependency's actual absolute
`module.__file__` path and current bytes to its sealed bundle entry. Missing,
off-root, symlinked, unsealed or drifted dependencies refuse; stdlib dependencies
are allowed only from the interpreter's stdlib tree, excluding site packages.
The sidecar modules themselves must originate from the single reviewed sidecar
directory, and the request pins their exact bytes separately. Source path/hash
provenance is retained with the preflight evidence.

The source-bound `runtime_scheduler.background_wrapper()` renders the expected
installed wrapper from the separately sealed `tooling/background-runner.sh`.
The installed `/opt/baci-prefunded-workers/code/background.sh` must match that
render exactly, remain root-owned mode 0444, and pass the existing safe file
reader. A substitute that prints a successful report cannot pass this check.

All five containers (background, snapshot, readiness, replay and replay-check)
must satisfy their unchanged sealed isolation validators and have `Config.Env`
exactly equal to the inspected immutable image's inherited environment. The
mutation flag is forbidden in both the image and container environment, even
with a false value. Container IDs must be actual 64-digit hexadecimal identities.
Source, installed wrapper and environment checks run on each active runtime
proof, before each restricted check-container start, and again after collection.
The runtime collector requires a bounds object; it has no unbounded default.

## Bounded owner entry point

After parent review, use `PublicMutationOwner(request_path, request_sha256)` with
`mutation_gate.enable(owner)`. There is intentionally no automatic CLI or import
side effect. Never call the adapter's transition methods independently.
This code is intended for execution only on the isolated staging owner host;
it was not executed against that host by this lane.

The gate requires the actual financial result, source-sealed files, fresh replay
completed heartbeat, actual successful scheduled oneshot logs and armed schedules.
Worker start and finish timestamps must be within 120 seconds; stale evidence
requires a separately authorized parent refresh, never a rewritten timestamp.
It reruns restricted TLS/replay `--check`, independent snapshot TLS, JWT signature
checks and effective fixed stop-target checks. It compares the complete current
DB chain and protected state with the reviewed post-financial baseline and
rechecks renewal/password/ACL/membership evidence. The authenticated public
probe must still show GET 200/false/max0 and POST/PATCH 503. The launcher `--check`
must return its exact restricted private-ready result; it does not contact a
payment provider. Evidence must remain fresh before any replacement.

The retained read-only predecessor container is stopped and renamed aside.
A candidate uses the reviewed public isolation constructor with exactly one
additional Docker environment entry:
`PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED=true`. Configs, receipts, files,
systemd units, database rows and the deadline timer are preserved. The existing
container validator is applied to a copy after removing only that exact known
entry; every other isolation property must still match. No old installer runs.
The unchanged public service fragment is separately pinned and must have its
exact October ExecCondition and Docker start command, no environment injection
or start hooks, no drop-ins, and no reload pending.

After start, the gate rechecks installed files, isolation, TLS/runtime/deadlines,
authenticated GET enabled/max10,000, protected DB state and chain digests.
It sends no enabled POST/PATCH or payment probe. Public access is now mutable;
a real concurrent customer action can change protected state and will cause
withdrawal, not an invented assertion that no payment started. A returned enable
receipt is not a collection, wallet-credit, payout, notification or settlement
receipt. These remain separate parent tests within the same total budget.

## Failure and interruption

The exclusive root-owned public lock is held throughout. The durable
`enable-intent.json` records the predecessor ID, retained name, request/seal
digests and deadline before stopping anything. A prior attempt refuses normal
enablement. Any exception, including partial create, journal-write failure or
KeyboardInterrupt after the attempt starts, stops public service and restores
the exact retained predecessor. Recovery verifies authenticated mutation denials
before reporting read-only restored. It leaves financial/interest/notification
services and database state alone.

For a process interruption, reconstruct with
`PublicMutationOwner(request_path, request_sha256, recovery_only=True)` and call
`recover_interrupted()`. This path verifies the private journal, reconciles
actual container names/IDs, and never calls an expired installer. Recovery-only
objects cannot enable mutations. At or beyond the cutoff, keep the public
container stopped and prove that state; never restart an expired service.
Any uncertain recovery returns/raises unconfirmed, requiring parent readback.
The parent must preserve candidate/predecessor and journal evidence and inspect
payment/intent state independently before any retry. No SQL rollback can undo
an externally started payment. No historical intent is deleted or replayed here.

## Focused local checks

```sh
for test_file in tools/staging/prefunded-card/public-mutation-activation/*.test.py; do
  PYTHONDONTWRITEBYTECODE=1 python3 "$test_file" || exit 1
done
```

All tests mock commands and runtime evidence; none contacts a browser, provider,
live endpoint or database. Full-chain SQL still requires parent staging
execution/review. Global lint/typecheck failures outside this directory remain
outside this lane. No heavy build, installation, commit or production action.

The runtime collector uses the source-pinned r8 `readiness_evidence_io.command`
runner, retaining its fixed environment, freshness and bounded-output guards.
Snapshot TLS probes pass their exact `input_text` and `extra_env` through this
runner; denied, unsafe or unavailable sessions refuse admission. Stage this
change as a separately reviewed r2 sidecar; do not overwrite staged r1 bytes.
