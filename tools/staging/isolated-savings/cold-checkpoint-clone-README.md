# Cold checkpoint clone — parent execution only

No execution has been performed by the author. Run on the VPS only after parent review:

```sh
python3 cold-checkpoint-clone.py --execute-reviewed-local \
  --checkpoint-receipt /home/bassey/baci-isolated-savings/replay2-clean-checkpoint.json \
  --output-receipt /home/bassey/baci-isolated-savings/replay3-clone-receipt.json
```

Requires cached `supabase/postgres:17.6.1.136` with the exact reviewed image ID
embedded in the helper. Never pulls an image. The image entrypoint is overridden:
only `pg_controldata` and `cp -a` run, never PostgreSQL. The data volume must hold
PGDATA at its root; otherwise control-data validation fails before creation.
The pinned image uses `/usr/lib/postgresql/bin/pg_controldata`, as identified by
the parent's runtime inspection, not the distribution-style versioned path.

Checkpoint sources are the two exact replay2 checkpoint names. New destinations
are `baci-isolated-savings_db-data-replay3` and `baci-isolated-savings_db-config-replay3`.
Any existing destination, even empty, is refused. Source volumes are read-only;
destinations have exact Compose project and logical `db-data`/`db-config` labels.
Ordinary local volumes only: driver options, bind/NFS-backed volumes are refused.

Parent must hold exclusive staging lifecycle control for the entire operation:
Docker does not provide atomic reserve-if-absent volume creation. Nobody may create
these names or start/mount source or destination volumes concurrently. Checks detect
current running/paused mounts but cannot prevent a separate Docker administrator
from racing them. Stopped retained containers and old volumes are not removed.

The supplied checkpoint receipt lacks daemon identity, volume fingerprints and
content hashes. Source provenance therefore remains the parent's attestation;
the helper validates current local volume identities and clean PostgreSQL control
state/system ID, not historical checkpoint authenticity. Receipts contain metadata
only; copy output and Docker errors are not logged. Copies preserve numeric owners,
permissions and symlinks using the pinned image's `cp -a`. No ports, network,
host-path mounts, Compose changes, secrets generation or database startup occur.

On failure, retain all partial destinations and the failure receipt. No cleanup or
automatic retry. Parent must inspect privately before deciding new destination names.
Failures emit a static stage in stderr JSON and, when already opened, the private
failure receipt. No exception text, command arguments, control output or raw stderr
is included. `control-data-command` means the command failed; `control-data-validation`
means it completed but the clean-state/system-ID check failed. An existing output
receipt is never overwritten; any parent-approved retry needs a new receipt path
and still refuses any existing destination volumes.
The receipt records successful command completion, not a database restore test.

Local synthetic tests (no Docker or network):
`PYTHONDONTWRITEBYTECODE=1 python3 cold-checkpoint-clone.test.py`
