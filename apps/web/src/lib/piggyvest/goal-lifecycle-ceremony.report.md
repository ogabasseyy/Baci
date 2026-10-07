# Duration-aware customer consent ceremony

## Public protocol

- Optional top-level `durationMonths`, integer 1–6, on draft view and acceptance.
- Absence remains absence: generic review/consent is nonactivatable, not a six-month
  default. Existing generic receipts cannot be upgraded retrospectively.
- Prepared terms require exact revision/hash/version/duration acknowledgement;
  missing, added or changed duration is rejected before a receipt is recorded.
- Parent/Sartre own shared client display/submission and binder projection. The
  backend now consumes the shared duration validator and preserves the field.
  Consent still does not establish funding eligibility or trigger activation.

## Implementation

Migration `20260912150200_goal_lifecycle_policy_ceremony.sql` extends existing
`goal_policy.read` with prepared duration; there is no second SQL read/catalog
entry. `createGoalPolicyStore.accept` dispatches exact duration input through the
already cataloged `accept_lifecycle_terms`, otherwise generic `accept`.

Both SQL acceptance functions revalidate under the same scope/ledger/goal lock
used by duration preparation. Generic acceptance rejects any prepared duration,
including preparation committed after an earlier HTTP read. In the opposite
order, an existing generic receipt prevents preparation. No unsafe session flags,
unlocked dispatch decisions, new caller grants or lifecycle activation were added.

The existing bounded handler preserves authentication, derived actor/tenant,
real CSRF, no-store, SHA256 exact terms matching, body byte/chunk/deadline limits,
idempotent replay, and redacted errors. Prepared legacy receipts lacking duration
consent fail closed for explicit migration rather than manufacturing acceptance.

## Evidence

- New handler tests first failed against the old behavior (five RED assertions).
- Final focused handler/store/request-schema/flow suites: 79 tests pass.
- Lifecycle harness: seven actual restricted-executor tests pass, including
  concrete context plus real CSRF plus HTTP handler plus SQL ceremony and eventual
  synthetic activation; generic nonactivatable consent and direct-RPC denial.
  Authentication/RLS client responses remain synthetic; private SQL uses actual
  isolated local PostgreSQL, not a mocked executor.
- Five synchronized races and restart checks pass: activation replay, reservation,
  funding visibility, and both duration-prepare/generic-accept lock orders.
- Scoped Biome and diff checks pass. Parent owns full quality gates and its
  connected-client runtime scenario. No external calls or processes left running.

500/501 registered files are unchanged. Final 502 SHA256:
`7f9113553ae543d1c32ecbace53712939328a9e889ceec3d08257100e40230cf`.
