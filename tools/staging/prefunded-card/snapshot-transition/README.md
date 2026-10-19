# Separately reviewed snapshot transition proof

This new procedure lane does not modify the sealed r8 bundle, installed bytes,
the financial gate, or its strict protected-state comparison. Nothing here
executes SQL, contacts a provider, starts a worker, or adopts a baseline.

## Parent-owned collection and proof

1. Preserve the original frozen protected baseline, failed gate report and
   independent row/evidence readbacks. A new capture cannot retroactively prove
   an earlier transition whose complete before-state was not retained.
2. Load `protected_snapshot`, `database_sql` and `source_functions` directly from
   the retained r8 bundle's tooling paths. Generate `snapshot_collector.sql(bundle,
   seal_sha)` and review/pin this separate collector source and generated SQL.
   It verifies the exact r8 manifest, actual module paths/bytes, function origins
   and loaded sealed-source JSON. Never use same-byte worktree substitutes.
3. Run the generated SQL through the existing isolated local-postgres boundary
   before the authorized independent snapshot pass. Retain its exact JSON bytes
   root-private. The single repeatable-read/read-only transaction captures all
   21 protected table fingerprints, complete sealed financial JSON and its
   canonical hash, every full binding/snapshot row, and schema/function/ACL/RLS,
   role/membership, trigger, policy, constraint, index and type fingerprints.
4. Retain actual pass start/finish UTC timestamps, pinned worker/source identity
   and exact successful outcome. Run the unchanged independent verifier with
   its original restricted provider retrieval and fresh database clock checks.
   Capture the same SQL afterwards. Retain the full seven-field snapshot row
   independently as `expected_snapshot`; do not invent its `verified_at` value.
5. Call `snapshot_transition.validate(before, after, started_at=..., finished_at=...,
   outcome=..., evidence_id=..., expected_snapshot=..., seal_manifest=...)`.
   `seal_manifest` is the retained r8 `financial-preparation.json` raw bytes;
   both collector source-pin maps must match this exact manifest. Capture clock
   bounds must surround the actual pass, which must finish within 60 seconds.
6. Only after a valid receipt, parent review and durable receipt retention may
   the parent adopt `after['protected']` as the post-snapshot baseline for the
   unchanged remaining gate checks. Keep the original frozen baseline; record
   the before/after capture SHA256s and returned `transitionSha256`. Never adopt
   on exception, rewrite an earlier baseline, patch a sealed comparator, or
   return a fabricated boolean readiness assertion.

## Exact allowed transition

The sole binding must be `ffffcb16-2e95-5cff-a591-e9cc81cf5f57` with unchanged
identity/full row except `verified_at`. Available/opening company float must
remain 10,000 kobo, reserve/consume zero and replenishments absent. Old principal
remains NGN100 (10,000 kobo), old intent/operation/history and every other financial
JSON field remain exact. Every nonbinding protected table fingerprint stays exact.
The binding fingerprint is recomputed from its captured complete canonical row;
the complete financial hash is verified against the captured canonical JSON.

For `recorded`, exactly one complete immutable snapshot may be appended; all
historical rows remain byte-equivalent as JSON. Its full row must equal the
independent expected proof, with available 10,000, expected binding/verifier,
exact evidence ID, observed time equal to binding freshness, millisecond
precision, strictly later than prior binding/snapshots, sequence max+1, and both
observation/verification times inside the actual pass. The evidence identifier
is reconstructed using the original verifier's binding/business/wallet/time/
amount digest. No timestamp-only exception applies to any other field.

For `duplicate`, zero append and the complete captured state must be unchanged,
excluding only capture time. The exact existing latest evidence row must match
the independent proof and binding freshness and remain within 30 seconds.
Ordinary verifier reruns normally create fresh evidence, not duplicates.

Function `prosrc` SHA256s are pinned to reviewed canonical source. The supplied
actual `pg_get_functiondef` SHA256 readbacks are additionally mandatory:

- Scoped recorder: `9d061b1e8695477e48e9810de0d9286ddc5b5495e4ceecb2374eb4bb761bd202`.
- Core recorder: `35c31d1abbea778d44171f39fb6e38cb75bc2ffed47ebe7221eb77cbfcb0cda4`.

Every captured security/ACL fingerprint must remain unchanged. The parent's
reviewed prepass security baseline is still required; unchanged is not a claim
that an arbitrary initial security configuration was approved.

The supplied failed-pass readback reports sequence 534, observation
`2026-10-02T09:03:58.436+00:00`, verifier `prefunded_snapshot_verifier`, available
10,000 and evidence `pvts_f39b496d11d4bc464667864403c99b2d8398c8b44fb2ade6a64e734721ca889d`;
previous sequence 533 was observed September 29 at 15:57:46.246. These are
parent-supplied observations, not remotely verified by this lane. Preserve them
as history; a subsequent fresh pass must prove its own next row, not relabel 534.

## Local focused checks

The separately reviewed phase collector uses a 32 MiB output bound only for its
fixed, source-rendered, read-only local PostgreSQL census. The actual census is
about 21 MB because it retains complete schema/security details and their
canonical copies. Normal database commands keep their original 1 MB bound;
original historical source and SQL readers remain unchanged. Duplicate JSON
keys, nonfinite values, unknown phases and oversized captures refuse. A fresh
capture is admitted only against the explicit reviewed complete prestart state
or the fully revalidated authorized snapshot transition receipt.

```sh
for test_file in tools/staging/prefunded-card/snapshot-transition/*.test.py; do
  PYTHONDONTWRITEBYTECODE=1 python3 "$test_file" || exit 1
done
```

Fixtures and SQL-generation tests are local only. Actual SQL execution,
independent provider retrieval, transition proof, baseline adoption and financial
activation remain parent-owned prerequisites. No staging completion is claimed.
