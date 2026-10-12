# Guarded financial activation preparation

This lane produces a sealed, source-verified review bundle. It never installs
files, runs SQL, contacts providers, starts a service, or enables mutations.
The source-built replay is required: a missing release returns
`financial_replay_release_missing_rebuild_from_source_required`.
Its daemon and prefunded factory remain byte-identical to their reviewed pins.
Both worktree source closures and all compiled worker inputs are independently
verified against the current files, not just the build manifest's output hashes.

The parent owns all root/private/live operations below. Keep public GET at 200,
enabled false and max zero, and POST/PATCH at 503 throughout this procedure.
Do not rerun the September installers: they have expired deadlines, old
zero-intent assumptions and enrollment writes. Preserve the existing retired
intent, original receipt/history, passwords, privileges and membership.

## Local source seal

```sh
python3 tools/staging/prefunded-card/financial-activation/prepare.py \
  --replay-root /private/tmp/baci-financial-replay-source-20261002-r2 \
  --replay-manifest-sha256 06957f1972dc677da9191b0164953d7f29333f6b619a02f24f6d80b89220a8f3 \
  --worker-root /private/tmp/prefunded-card-worker-renewal-20261002-r4 \
  --worker-manifest-sha256 fccc5fe11de7a7e18c5a0c38309fb57e9013729e76d31d609bc652dab77f8d6a \
  --receiver-root /Users/mac/.codex/worktrees/0d77/Baci-app \
  --repository-root /Users/mac/Baci-worktrees/cursor-savings-phase1 \
  --public-root /private/tmp/baci-first-card-build-20261002.FUTQPHUB/release-readonly \
  --output /private/tmp/baci-financial-activation-preparation-20261002-lane1-r5
```

`financial-preparation.json` seals copied outputs, both build manifests, the
protected snapshot SQL, gate/configuration helpers and the procedure. Installation
contract hashes pin the existing replay/worker isolation, scheduler and verifier
contracts. The output is prepared inactive, never an activation receipt.
The exact public source manifest is read from the build root's sibling
`source-readonly-r2/source-manifest.json` and sealed at SHA256
`4b066d0e957b4f029c1be1e5c71c1496e269600d1763414645882d832c5c07d7`.
The earlier isolated source manifest is not a readonly-release predecessor.

## Parent-only live steps, in order

1. Verify the seal digest and every file digest on the isolated staging host.
   Recheck local source closure immediately before staging; rebuild on any drift.
   Collect a fresh root renewal baseline and private artifacts using
   `card-week-renewal/root-collect.py`; rebuild within five minutes. Current public
   config/unit deadlines are preserved byte-for-byte. Renew only known expiry
   slots in old inputs; compiled blobs are never patched.
2. Independently capture `protected-snapshot.sql` before rehearsal. The query
   uses one repeatable-read, read-only transaction, fixed database identity and
   complete row digests for the protected tables and target financial state.
   It returns digests/counts, never provider bodies. Rehearse the exact generated
   renewal SQL with final COMMIT replaced by ROLLBACK. Record its digest and
   rollback confirmation; compare complete protected snapshots independently.
3. Resolve the additional independent-verifier fence: the
   `prefunded_snapshot_verifier` login and its immutable
   `prefunded_card.treasury_verifier_bindings.expires_at` are separate expiry
   fences. The existing three-role SQL does not renew either. After the separate
   financial SQL commit in step 4, use the packaged executable collector and
   candidate renderer below. Rehearse that exact candidate before its commit;
   any intervening routine/ACL/role/history drift requires recollection.
4. Commit only the rehearsed guarded renewal after confirming the old constraint
   fingerprint, function OIDs/ACLs, role password/metadata/membership fingerprints,
   retired old expiry and financial history. Read back independently. Treat
   interrupted commit as unknown and stop; never infer rollback or retry blindly.
5. In root-private storage, call `replay_configuration.prepare_configuration`
   with the pinned current financial base and factory config plus the existing
   signing keys. This reuses existing signature verification/token issuance.
   It preserves only prefunded replay mode; `financialDatabase` is forbidden.
   It renews the two signed JWT expiries while preserving the exact six-field
   factory scope and every factory-config byte. Pin the resulting private base
   configuration hash in `prefundedReplay`. Check the output with the actual source-built replay
   `--check` path after installation. Never print configs, JWTs, keys or DB passwords.
6. Retain predecessor trees/containers by rename-aside. `installation_runtime`
   implements the stopped-runtime installation adapter, and `owner_adapter`
   implements the ordered financial activation interface. Both require fresh
   owner evidence and review before live execution. Only isolation constructors and
   validators in the sealed contracts are reusable. `runtime_scheduler.units()`
   still renders Sep 29; `runtime_worker_installation.WorkerInstaller` pins old
   ACTIVATION_SHA/SNAPSHOT_SHA; `replay_cutover_runtime.runtime_files` checks the
   old imported DEADLINE_EPOCH. Do not invoke these old installation paths,
   monkeypatch constants or weaken their checks. The adapter must consume the
   reviewed renewal renderer's Oct 6 artifacts and exact renewed private hashes,
   preserve isolation and separate snapshot credentials, keep schedules disabled,
   and reject unknown installed metadata. Never start expired predecessor code.
7. Run compiled `readiness.cjs --connect` against the renewed private activation
   config. Require exact `restricted-tls-ready` report for worker/authorizer/evidence.
   Independently prove snapshot verifier TLS identity and least privilege without
   recording a snapshot yet. Run replay daemon `--check` in its check container;
   require exact `replay-runtime-ready`, readOnly true. Verify JWT signatures,
   audiences, roles and exact Oct 6 expiry with actual signing keys.
8. Install/arm exact public, workers and replay deadline units before financial
   start. Verify effective OnCalendar Oct 6 15:59:10 UTC, active next elapse,
   no drop-ins/reload pending, and exact stopper targets. Independently compare
   complete protected snapshots before and after this installation/check phase.
9. Pass fresh root evidence to `owner_gates.validate_prestart` bound to the seal.
   `owner_gates.activate_financial` supplies the ordered owner-adapter procedure:
   verify seal/gates, start replay and prove fresh completed-pass heartbeat, run
   the separate snapshot verifier then background as actual scheduled oneshots,
   verify completion and unchanged payment state, recheck fresh evidence/deadlines,
   then schedule workers. Its new adapter must implement the reviewed renewed installation and
   gather actual evidence; the helper never manufactures a passed receipt.
   Failure withdraws only these financial services/schedules. Existing interest,
   notification and read-only public services remain under the parent owner.

The root-private binding collector, candidate renderer and installation/activation
adapters are implemented with regression coverage. The parent still needs fresh
private baselines, their rehearsed SQL artifacts and actual adapter execution;
this source seal does not assert
that those live gates passed. The gate helper
is an evidence validator, not an independent TLS/JWT collector. Before scheduling,
use another independent protected snapshot pair surrounding the preschedule check
phase; the treasury verifier's explicitly authorized snapshot recording is a
separate operation, not evidence that all database bytes stayed unchanged.

## Snapshot binding owner candidate

With `BUNDLE` set to the reviewed private preparation directory and `AUDIT` to
a new root-owned 0700 audit directory on the isolated host:

```sh
python3 "$BUNDLE/tooling/financial-activation/snapshot_binding_owner.py" collect \
  --output "$AUDIT/snapshot-baseline.json"
python3 "$BUNDLE/tooling/financial-activation/snapshot_binding_owner.py" candidate \
  --baseline "$AUDIT/snapshot-baseline.json" \
  --repository-root "$BUNDLE/source" --output "$AUDIT/snapshot-renewal"
```

The collector executes only a repeatable-read/read-only query inside the exact
isolated app DB container, as local postgres with its exact system identifier.
It writes metadata hashes and expiry timestamps into a private file, never role
passwords or provider bodies. The builder requires root-private ancestors, a
baseline at most five minutes old and an unexpired approval window. It writes
`rehearsal.sql`, `commit.sql` and their exact SHA256 pins in `candidate.json`;
it never executes them. Both SQLs are identical except their final transaction
outcome. Run the rehearsal via the existing owner `runtime_owner_support.database`
boundary, compare independent protected snapshots, then execute only the pinned
commit through that same boundary after parent review. No TCP/admin shortcut.

The SQL obtains ACCESS EXCLUSIVE on the binding table before any exception,
then locks financial history and role/routine/schema metadata. It validates
the exact binding identity, known guard source hash/body, postgres owner,
plpgsql/trigger return type, owner-only EXECUTE ACL, enabled trigger, safe login
and exact verifier membership. Under that lock only the named update/delete
trigger is disabled, only the expired binding deadline changes, and that trigger
is restored before the expired login deadline changes. The truncate trigger is
never disabled. Full table/RLS/trigger/index/function/ACL/role/password/membership
and protected-financial fingerprints must match afterward, excluding only the
two authorized expiry fields. Every exception aborts the transaction, including
failure between disable and restore. Independent postcommit readback remains
mandatory; an interrupted commit is unknown until verified.

All results retain mutations false. Enabling public mutations requires a
separate parent-reviewed complete-chain gate. A successful empty worker pass
proves no genuine payout, card collection, transfer, push or settlement.

## Runtime adapters

`RuntimeInstallation` verifies the source seal and renewed private configuration
pins and the separately approved candidate JSON digest. Its `capture` validates the exact stopped predecessor containers, image
environment, file set, ownership and modes. `install` refuses stale or changed
captures, retains every predecessor container and tree by rename-aside, installs
only from the exact parser-repaired replay predecessor manifest
`1445e1b2a7f9e7e28801c8bd036b833fdbe8ec02facb5bc4d5e00c0c71e7de42`,
retained at `/root/baci-interest-parser-repair.yzgOduMP/provenance/manifest.json`.
Its daemon pin matches the independently verified exact category-alias repair;
the original pre-repair container label is not accepted. It installs
the pinned compiled artifacts with separate verifier credentials, and arms the
reviewed effective October deadline timers before any financial start. It never
starts a financial runtime or replaces public/interest/notification services.

`FinancialOwnerAdapter` plugs the actual collectors and scheduled oneshots into
`owner_gates.activate_financial`. It verifies fresh completed replay heartbeat,
actual container exit/output and scheduled-unit state, complete protected-state
readback, renewal/password/ACL/membership fingerprints, and authenticated
public mutation denials before scheduling. Failure withdraws only financial
containers and schedules. The parent remains responsible for sealing the exact
collector request and source closure, and for the separate public-mutation gate.
