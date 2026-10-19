# Snapshot transition lane handoff

Local source and focused checks only. Parent review, actual read-only SQL
collection, independently verified pass, transition validation and any later
baseline adoption remain pending. No financial activation is claimed.

## Exact source SHA256 pins

```json
{
  "transition_constants.py": "c62d50ec9a4030fb9a0d2fddf6217f304483fed31351aa0f2ee838973f5edf5b",
  "snapshot_collector.py": "d450a7429ca5e5a972fc1ae87893e254aac49ee82bbb9ea02f34788d1e879a7b",
  "snapshot_transition.py": "531c2d08c48bae1253a4a65175fb33aff18e7955b9db96857d76d7a8b63547aa",
  "README.md": "d234665fc4ea6ee420eedf85aa936ff2a61768b636596f2975c7a7d8c759d67c"
}
```

## Entry points and required inputs

- `snapshot_collector.sql(bundle, seal_sha)` returns SQL only. Preload the
  collector's three shared modules from the retained sealed r8 tooling paths.
  The collector refuses off-root/same-byte substitutes, drifted manifest/source
  files, stale imported function origins, and an inconsistent loaded source
  contract. Review/pin generated SQL before parent execution.
- `snapshot_transition.validate(before, after, started_at=..., finished_at=...,
  outcome=..., evidence_id=..., expected_snapshot=..., seal_manifest=...)` is
  pure validation. `seal_manifest` must be the exact retained r8 manifest bytes;
  `expected_snapshot` must be the independent actual complete seven-field row.
  The receipt binds both complete captures and actual pass timestamps with a
  `transitionSha256`; `baselineAdopted` is always false.
- Parent must preserve the original frozen baseline/failed report and establish
  the reviewed prepass capture's provenance. A new capture cannot reconstruct
  missing earlier before-state. Preserve original evidence and adopt a later
  baseline only after complete transition proof and durable reviewed receipt.
- Parent must retain the independent provider-verifier pass/source identity,
  restricted credential/transport proof and actual start/finish/outcome. The
  helper verifies captured state transitions; it cannot prove provider retrieval
  from an invented JSON row or self-declared boolean readiness.

## Preserved invariants

All 21 protected table fingerprints and complete financial JSON are captured in
one repeatable-read/read-only transaction. Only the sole binding's `verified_at`
may change, justified by one exact authorized immutable snapshot append; an
exact duplicate requires zero append and complete unchanged state. Full binding
canonical-row hashes and full financial canonical hashes remain verified; no
generic table/hash exclusion is used.

Company opening/available remains 10,000 kobo, reserve/consume zero, replenishment
absent, old principal 10,000, identity and old intent/operation/history unchanged.
New row amount/verifier/evidence/time/sequence must match the independent actual
proof. Every historical snapshot and every other protected field/table remains
exact. Full schema/ACL/RLS/type/routine/role/membership fingerprints stay unchanged.

Both supplied actual PostgreSQL function-definition SHA256s and canonical source
body SHA256s are pinned. The sequence-534 failed-pass readback supplied by the
parent is retained as contextual history in README, never fabricated as a new
pass or substituted for a missing full row (including its actual `verified_at`).

## Focused verification

20 tests passed: 5 collector/source-origin tests and 15 transition tests, with
table-driven regressions for all nonbinding table hashes/counts, all unauthorized
binding fields, historical deletion/modification, amount/counters/cap/principal,
injected binding, financial metadata/history, timestamp/sequence/evidence,
actual source/definition hashes, RLS/ACL/schema and collector source-pin drift.
The positive receipt preserves both input captures and never adopts a baseline.
Collector tests check the actual local sealed-expression implementation's full
21-table SQL generation; no generated SQL was executed against staging here.

Every source/test is below 300 lines. No sealed r8, installed byte, parent lane,
env/proxy/migration, remote resource, browser, payment or production was changed.
No install, build or commit was performed. Global lint/typecheck remain separate
from these Python checks and existing unrelated failures must not be repaired.
