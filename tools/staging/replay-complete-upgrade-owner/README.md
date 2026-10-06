# Complete replay upgrade: bounded source-only candidate

This directory contains pure preparation/sealing and prestart evidence validators,
not a live installer. It runs no commands, reads no remote state, mints no JWTs,
executes no SQL and changes no roles, grants, schedules or money. Private output
bytes must remain in the parent's root-private handling; never print `files`.
All source files are under 300 lines. Run each colocated `*.test.py` directly
with `python3 -B`; fixtures contain synthetic attestations, not signed JWT or
provider evidence.

## Three small APIs

`artifact.validate_artifact` accepts a byte map containing only
`replay-daemon.mjs`, `replay-artifact.manifest.json`, `daemon-closure.json` and
the exact content-addressed captures. It pins the actual captured daemon
`20a145...3126`, closure `380150...931b`, build manifest `c6d5d1...9d2f`,
47-entry production table and full 207-input table including vendor bytes.
All 206 distinct capture payloads must match their hashes; two paths share
identical bytes. The pinned runtime-import table permits only the reviewed
builtins/`pg-native`. There are no public digest overrides. The raw pinned
manifest itself freezes the exact production path/hash table, not a caller's
arbitrary table. It verifies captured bytes, not a mutable checkout.

The builder-produced `prefunded-replay-bundle.mjs` is old and NOT approved for
installation. Its hash appears only in the pinned build manifest as provenance.
Parent must exclude that payload when constructing the byte map; supplying it
is refused. Never replace the live corrected factory `b73f5e...c4` or private
config `a2356c...6f0` with generated files.

`candidate.prepare_candidate` accepts the four exact predecessor file bytes,
the exact preserved interest-only outer config, that complete artifact byte
map, and a parent-issued receipt token plus a separately pinned
parent signature/claims attestation. It does not decode a JWT and call it verified.
The caller must independently verify that attestation with the real signer secret.

The helper changes only `code/replay-daemon.mjs` and `config/config.json`.
It copies the native outer config, replaces only `receiptToken`, and adds
`paidInterestDatabase` from the pinned legacy connection. It preserves `appToken`,
receipt encryption key, physical identities, `prefundedReplay`, factory bundle and
private `prefunded.json` bytes. `financialDatabase` and accrual remain absent.
The paired executor must use the unchanged TLS paid-interest-only SQL adapter;
the factory remains separately restricted. No bridge binding or payout policy
is fabricated or installed by this helper.

It returns private candidate bytes and a sanitized inactive seal. Current root
container IDs, predecessor seal, all four file hashes, both physical systems,
the existing six-field factory `environment` ABI, generation and Oct6 expiry
are literal pins in `contract.py`. The new seal also binds all four artifact
digests. This is not a claim that its runner or real readiness passed. Changed root facts require
fresh source review, not public pin overrides.

`prestart.validate_prestart` consumes separately reviewed seal/evidence digests.
It requires fresh <=60-second parent evidence, both known claimants stopped,
zero in-flight claim transactions and processing receipts, all other claim paths
accounted for, retained predecessor files, and unchanged receipt/retry/financial
state hashes. It also requires the committed fenced body, unchanged routine
metadata, actual old-token pre-mutation refusal, actual new signed token/server
role/audience/generation evidence, and unchanged active deadline/stopper pins.
The exact candidate daemon/config must pass the real compiled read-only check,
both factory and paid-interest readiness, and the actual focused runner. A failed
runner or a half-capability mode refuses. These are parent-owned observations;
booleans or locally decoded JWTs are not independent authentication evidence.
Acceptance returns `parent-prestart-evidence-accepted-not-started`, never starts
anything and never proves receipt processing, paid interest or customer credit.
`financialProofObservedAt` must be a UTC `Z` timestamp no earlier than the actual
receipt's unchanged `next_attempt_at`, `2026-10-03T07:45:26.302325Z`, and no later
than the validation clock. The separately reviewed financial proof must establish
the actual natural attempt outcome, not merely a clock passing that timestamp.

## Minimal owner chain, implemented later by the parent

1. Finish independent financial proof after the actual Oct3 07:45:26.302325 UTC
   natural retry, without accelerating/resetting it, and the complete-daemon source,
   ABI/build closure review and GREEN focused runner. Do not use the old daemon
   or accept a reported aggregate count while individual runner suites fail.
2. Capture current root-private files/metadata and both physical DB identities.
   Recheck these supplied pins against the actual predecessor before staging.
3. Parent alone signs the new canonical receipt token: existing worker role,
   audience, exact `replay_claimant_generation`, integer expiry `1791302350`,
   bounded existing duration. Preserve the app token and all existing secrets.
4. Prepare candidate bytes privately, retain predecessor files/containers, and
   stage a new generation with root-owned single-link files, gid65532, code0644,
   config0440 and directories0750 explicitly despite umask077. Recheck the full
   candidate seal and exact source inventory after staging.
5. Before any fence change, run the compiled candidate's nonclaiming read-only
   `--check` with both pinned executors, authenticated JWT and physical identities.
   Refuse cutover if this preparation or dual-executor readiness fails.
6. Stop every claimant, drain in-flight RPCs/processing leases naturally and
   capture complete receipt/retry/financial baselines. Never reset backoff or
   mutate the preserved natural retry. Keep both deadline timers/files intact.
   Rehearse the separate claim-fence SQL with default ROLLBACK, independently
   compare restored snapshots, review, then recheck quiescence and commit the
   exact reviewed fence. After commit, failure must NEVER restore the unfenced
   SQL or restart the old native/interest-only generations. Calls already
   executing old bodies must be drained before this cutover.
7. Through actual JWT-authenticated PostgREST, parent obtains old-token refusal
   before any mutation and new-token gate acceptance. A NULL-bound probe must
   stop at unchanged original parameter validation, never acquire a receipt.
   Independently compare receipt/backoff/financial snapshots around the probes.
8. Repeat the compiled candidate's nonclaiming read-only `--check`, with both
   pinned executors/physical identities. Recheck zero claimants, no lease or state drift,
   active effective Oct6 deadline and fresh evidence; validate prestart.
9. Parent starts only the exact sealed complete generation under the canonical
   `pvb-staging-replay-prefunded` name and existing stopper target. Recheck time,
   container identity/isolation, competitor stop and fencing immediately before
   and after start. No other path receives the new credential. A generation
   bearer token is not a process-singleton; enforce exclusive launch control.
10. On failure, stop the verified candidate and retain everything for review.
    Leave the fence committed, backoff unchanged and predecessors stopped.
    Recovery may use only an independently approved compatible complete
    generation with matching fenced credentials and repeated fresh gates.

## Safe reuse versus forbidden reuse

Reuse concepts/pure validators from the old owner's protected file reads,
`verify_tree`, declarative container isolation and effective deadline checks.
Actual source pins, single-link metadata, no drop-ins, exact image/user/mounts,
TLS identities and pre/post-start expiry checks must remain mandatory.

Do NOT directly invoke `replay-native-upgrade-owner.owner.execute/stage` or
`DockerRuntime.swap/restore`: their source/artifact/predecessor pins are older,
stage deliberately preserves the old daemon, and restore restarts an old
generation when it was previously running. That recovery is incompatible with
this committed generation fence. This candidate intentionally supplies no
root driver or automatic SQL/container rollback adapter.

Required parent inputs: exact captured daemon/manifest/closure/capture byte map and actual runner
evidence; fresh pinned private predecessor/interest files and financial proof;
parent-minted token/signature attestation; root staged metadata/inventory;
actual committed fence/metadata and server probes; retained-state hashes;
compiled dual-executor readiness and unchanged effective deadline evidence.
