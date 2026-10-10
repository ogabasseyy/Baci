# Actual root adapter: source implementation pending parent review

Implementation update: `continuation_root.py` and bounded helpers now exist.
The authenticated 48-member local capture passes the full evidence-chain test.
The only intermediate queue delta is attempts 654 to 655 and `available_at`
`2026-10-03T10:39:13.282099+00:00` to `2026-10-03T11:36:05.366749+00:00`;
neither claim token nor lease changes. Exact non-target hashes are preserved.
The original natural catalog excludes the checker; its original pin is required.
Explicit legacy/outer module mappings and owned PID/XID drain are implemented.
The design below records earlier requirements, not outstanding missing captures.
Parent review, full release sealing, actual guard duration and original Context's
fresh anchored checks remain necessary. No live credit is claimed.

This source implementation is not a continuation seal or execution approval.
No root commands, provider requests, financial actions or repair retries were
performed. The retained evidence bytes below were authenticated and inspected
locally; runtime collections remain unexecuted.

## Fixed repair anchors

Authenticate each file with `continuation_release.protected_bytes` before JSON
decoding or executing source. Require exact paths, root-owned 0600 single-link
files, stable no-follow descriptors and nonwritable root-owned ancestors.

| File | SHA-256 |
| --- | --- |
| `/root/baci-ledger-continuity.clooltoe/owner.py` | `2612faeebfaf73501ffcf6b20b6cf19578246d3653f5522e0b9e68690a8b66da` |
| `/root/baci-ledger-balance-repair.9xx36nvp/before-afa0c9cfb4f6443ba1c8be875c9e6da6.json` | `b708f82d1a77a4df19a3f7b4bfd217ffa37500f9fc9e120abfa97470fc651a3f` |
| `/root/baci-ledger-balance-repair.9xx36nvp/after-f647e2f2add94c038ba1ec5ab9f0a171.json` | `d2f70b36ad83ea8e6385189a86cbf132671e136bd176cf045414c4d530046478` |
| `/root/baci-ledger-balance-repair.9xx36nvp/result-a2c81a75c8d3466daca1694e6f4fd36d.json` | `5efd783ce7a485828efe4d44209b59819c3fbf74f6f94b0a601df5d74dba59de` |

The local ledger owner bytes match the reported owner hash. Its `prove` checks
unchanged masked snapshots, full checker row equality except `prosecdef`
false-to-true, and normal snapshot equality except changed permanent metadata.
Its `baseline_matches` binds the prior TLS diagnostic baseline through the exact
two-reminder proof. Reuse these *pure checks* on authenticated retained bytes;
never call `main`, `candidate_query`, `dependency` or repair execution paths to
establish completion. Result booleans are corroboration, not authority.

## Evidence chain, not a replacement baseline

1. Authenticate the original projection release manifest and its complete exact
   file set before importing any legacy dependency. Release seal remains
   `f9d2fcb4caf7481ebe8c0720a0cceb572bd1557c2e83f7f6c17a33d4560286ed`.
2. Authenticate the original partial financial audit using the existing
   `projection_preflight.AUDIT_PATH`, hash and size. Run its historical retained
   proof, including the existing first-pass treasury/queue deltas. Do not run
   its old `_current` unchanged: exact old metadata/reminder comparison now
   intentionally refuses. Do not silently bypass that refusal.
3. Bind the diagnostic baseline to that historical state with the existing
   full snapshot comparison. Bind repair-before to the diagnostic baseline
   through the pinned reminder proof, on comparison copies only. Actual
   snapshots, including both reminders, remain intact in every journal.
4. Verify repair-before/after using the exact applied owner proof. Require
   truthful RO identities, full checker rows, exact evidence shapes and
   chronological capture times. Accept only this one checker authority delta;
   masked evidence must not become a continuing metadata exemption.
5. Fresh prepare snapshot must equal the authenticated **unmasked** repair-after
   snapshot except capture time. Preserve financial, Auth, role, function,
   catalog, non-target and hidden-column witnesses. The repaired metadata digest
   is accepted only through steps 2-4, never by substituting a fresh baseline.
6. Reauthenticate original receipt HMAC/AEAD provenance and the existing
   read-only provider crosswalk contract. No new charge/transfer or cached
   boolean substitute. Any provider GET needed later remains a separately
   authorized runtime prerequisite; none is executed during source preparation.

The repair owner pins reboot continuity helper
`fa884466e53a30f7154158914e284a29a78c602294fcea6a5ce40ed75ef9cdb2`
and reminder helper
`a915b8134b5626f6d664f3d3cf79245c59ee089373738ab37d6f24022283842f`.
Reminder proof remains `/root/baci-reminder-continuity.sb522x47/proof.json`,
SHA `55c52b6b8797b8b17b144fbd66dd59817fcc1efe5177a617b8616d7979907169`.
Keep the existing exact new-goal reminder and all seven excluded notification
rows. Historical normalization is restricted to step 3, not runner readback.

## Adapter methods and ownership

- `prepare_root(captured)`: authenticate all external inputs before import;
  acquire the existing global cutover lock once with no-follow, root ownership,
  single-link, inode/path equality and nonblocking exclusive flock. Recheck that
  same descriptor and path at every boundary. Constructor failure independently
  releases every acquired resource; no service cleanup or worker restart.
- `prepare()`: return exactly `protectedSnapshot`, `original`, `provider` after
  the full chain above and fresh physical identity/quiescence/source checks.
- `guard(stage, transaction=None)`: check deadline/timer, pins, lock, unchanged
  failed Docker state and reboot journal, exact stopped units and configuration,
  native/competitor state and receipt claimant exclusivity. Without transaction,
  use the existing strict RO drain. At commit boundary execute a reviewed fixed
  inspection on the **owned connection**, with truthful RW identity; exclude
  only its actual `pg_backend_pid()` and require no prepared/other transactions.
  No arbitrary SQL callback or client-supplied exclusion PID.
- `reconcile()`: independent RO collection and fresh receipt/provider evidence,
  full identity/session drain and actual unmasked snapshots. Never retry a
  mutation after lost COMMIT acknowledgement. Runner binds completed report and
  every precommit witness, including hidden/non-target reminder hashes.
- `journal(phase, evidence)`: private bounded root-owned 0700 audit directory,
  exclusive 0600 artifact creation, no-follow, bounded serialization, no tokens
  or credentials. Never print raw evidence. Audit failure prevents success.
- `close()`: independently clean owned lock/import resources without replacing
  primary uncertainty or conflating local cleanup with remote COMMIT proof.

## Inputs still required before implementation/sealing

- Local protected-source captures of the three retained apply JSON files above,
  plus the pinned diagnostic baseline, partial audit and exact reminder proof.
  Hashes alone do not reveal their actual schemas/contents or prove the chain.
- The original `release.json` and all its captured files. Current source is not
  automatically equal to the immutable release. Transitive financial/native
  owner and preparation closure bytes used by `Context` must also be available
  and authenticated before their imports/runpy calls.
- An explicit authenticated-loader composition: legacy bootstrap currently
  rejects already-loaded module names, while continuation loads shared modules
  first. Do not import legacy modules under conflicting names or reuse ambient
  modules. Preserve exact original globals/origin checks; review captured-byte
  namespace isolation or revise loader order narrowly with regression coverage.
- Exact reviewed catalog/role evidence before and after the checker repair.
  Old catalog checks cannot be replaced with a boolean or newly chosen hash.
  Determine the precise checker-only catalog delta from actual evidence.
- Fixed source and expected typed result for the owned-transaction RW drain;
  existing separate-connection RO drain rejects the intentional open transaction.

The adapter now consumes the supplied captures and explicit source mapping.
The release remains unsealed pending parent review. Missing or changed runtime
prerequisites still refuse; no successful-check placeholders are permitted.

## Focused adapter regressions when inputs arrive

Reject changed repair hashes, malformed/duplicate JSON, checker body/owner/ACL
drift, unrelated masked or unmasked metadata drift, Auth/catalog drift, altered
historical rows/reminders, stale fresh collections and missing chain links.
Reject preloaded external modules, symlink/hardlink/owner races and closure drift
before imports. Cover lock substitution/contention, partial-constructor cleanup,
other/prepared transactions and foreign exclusion PID. Preserve COMMIT ACK with
unconfirmed status on readback/audit/cleanup failure, with zero mutation retries.
