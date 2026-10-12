# Local persisted lifecycle slice

## Implemented

- Reuses `piggyvest_goal_policy` and the existing savings ledger. No parallel
  accounting or provider posting path. All new runtime/schema files are below
  300 lines; shared executor/catalog edits belong to the parent.
- `prepare_lifecycle_terms` stores an explicitly selected 1–6 whole-calendar-month
  duration and the existing legacy maturity date before consent. No default.
- `accept_lifecycle_terms` asserts explicit acceptance of that exact selection,
  derives database ownership from the existing customer link, and atomically
  invokes original policy acceptance. Existing receipts cannot acquire duration
  consent retroactively. Runtime actor input must come from authenticated parent
  context, never from an HTTP body or UI authority.
- `activate_lifecycle` locks existing registry/ledger/policy/customer/goal scope,
  validates exact immutable quote/device/consent, and reads principal postings
  under that lock. It requires `ceil(quoteKobo / 20)` confirmed internal principal;
  paid/pending interest and caller balances cannot meet the threshold.
- Initial activation rejects reservations, reversal history, legacy contributions,
  nonzero legacy amounts, and legacy automatic collection. The legacy goal must
  remain paused/manual; no public goal or ledger write occurs.
- An immutable activation record binds operation, revision, consent, server clock,
  guaranteed price and principal evidence. Exact replay returns the same receipt;
  incompatible identities conflict. Collection remains paused with no collection
  consent. Maturity and grace derive from immutable activation time plus selected
  duration in Africa/Lagos, month-end clamped, then 30 calendar days.
- Existing legacy maturity must match the derived local date; a changed/shorter
  existing promise requires explicit migration, not silent replacement. Custom
  day-based durations remain unsupported rather than rounded to months. No
  post-grace forfeiture, FX cancellation, guarantee expiry or collection restart
  is invented.

## Default-off boundary

No deployment grants or enabled gates are seeded. Runtime requires explicit
enabled=true, synthetic local database configuration and the existing dedicated
policy writer. SQL additionally requires that login, Unix-socket connection,
database `piggyvest_local`, and an enabled per-goal lifecycle gate. Before-funding
proof is local only; no provider cash absence or production eligibility is claimed.
The parent customer binder still owns reading/projecting persisted lifecycle and
rendering duration in its real acceptance ceremony; this slice installs no route.

## Verification

- Original activation unit RED: missing implementation rejected the required
  success receipt. Final focused adapter/schema/catalog/executor tests: 42 pass.
- `bash tools/test/goal-lifecycle-local.sh`: disposable socket-only PostgreSQL;
  threshold, explicit/old/mismatched consent, expiry, original deadline, disabled
  gates/terms, legacy isolation, immutable receipts, role denial, Jan31 leap and
  nonleap clamp, Lagos boundary and six-month/30-day rules pass.
- Three synchronized races pass: activation replay, reservation exclusion, and
  committed funding visibility. Restart verifies persisted activations.
- Four actual restricted executor integration tests pass: prepare/accept/activate
  and replay, missing duration consent, deferred COMMIT rejection/rollback, and
  wrong actor. No provider HTTP is used. The harness shuts down its own database.
- Scoped Biome passes; full lint/typecheck/test integration remains parent-owned.
  Initial SQL expiry fixture had a noncanonical timezone suffix and was corrected
  to explicit UTC Z. Constructor mocking was corrected after formatter conversion.

## Parent integration

Catalog now imports all three `GOAL_LIFECYCLE_STATEMENTS`; only policy writer is
allowed. Never catalog/grant `activate_lifecycle_bound`, `lifecycle_scope` or
`lifecycle_dates`. Synthetic fixture grants only public lifecycle entry points.

Migration SHA256:

- `20260912150000_goal_lifecycle_activation.sql`:
  `7be6c78c9f7bca3d37fe0aa1b28bd55e9c71d112dc3afc46814ac001857a1a16`
- `20260912150100_goal_lifecycle_duration_consent.sql`:
  `85d7fc5993bbb7f982dff03f9d09fe4d7216373b4352da9869b69bc12f54cf46`

No commits, deployment, credentials, infrastructure or provider operations.
