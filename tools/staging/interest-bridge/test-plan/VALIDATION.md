# Local validation, 2026-10-02

Canonical directory: `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/interest-bridge/test-plan`.
Only this sidecar's source files were edited. Predecessor work was retained.

The r4 inventory-size correction separates 8-MiB inventory stdout, inventory
report and dedicated snapshot-reading bounds from the unchanged 1-MiB
source/provider/approval/identity/other-evidence bounds. Byte counts use UTF-8,
and reports are compact JSON, bounded after adding owner metadata and newline.
The parent's read-only live diagnostic reported 2297429 UTF-8 bytes, 9568 schema
objects, psql exit 0, company and aggregate budget 10000, and old principal
10000.0. These are parent-supplied measurements, not a new live action here.
Financial/authentication SQL and consent checks are unchanged by this correction.

`sh tools/staging/interest-bridge/test-plan/run-tests.sh`: **79 tests passed**
in 39.817 seconds, with actual local disposable PostgreSQL 17 (no skipped tests).
The suite uses existing creation RPC and mapping/policy guards; its peripheral
tables and unused bridge functions are explicitly synthetic fixture support.
This is not a full production-schema or real receipt-application test.

Verified behavior includes:

- Goal-only creation and concurrent retries yield one separate zero-principal
  opted-in goal, exact public-wallet/webhook-customer mapping, and ledger binding.
  No policy, contribution, operation or extra funding is installed.
- Goal-only rehearsal rolls back; protected schema and row hashes, old goal
  principal 10000, and treasury totals 10000/0/0 remain unchanged.
- Existing policies, including disabled ones, refuse without deletion.
- Full-policy retains enabled policy creation, strict routing proof requirements,
  immutable definition hashes, and exact idempotency. Mode-crossing rehearsals
  cannot authorize application.
- Complete candidate goal, audit and idempotency rows are compared before binding
  inserts and after immediate/deferred binding effects. Final mapping/binding
  validation is read-only. Principal outputs read actual final goal rows.
- Opening identity plus replenishments is capped at 10000 cumulatively, with
  per-binding counter reconciliation and exact company source/worker identity.
- Source pins, missing files, duplicate/path-traversal manifest records, stale
  evidence, altered ownership/roles/catalogue/mappings and financial side effects
  refuse; CLI errors remain redacted and ambiguous applies remain unconfirmed.

Two additional regressions were observed failing before their fixes in actual
PostgreSQL: a new approved snapshot could accept an increased treasury cap;
a deferred binding trigger could install a disabled policy after the original
policy-absence check. Explicit aggregate treasury checks and a policy-absence
check after `SET CONSTRAINTS ALL IMMEDIATE` now reject both. An extra treasury
binding cannot turn the 10000 total cap into a per-binding allowance.

The subsequent Socrates findings were both validated. Before these corrections,
seven new PostgreSQL regressions failed: immediate candidate principal mutation;
deferred consent replacement, audit-identity replacement and binding disablement;
replenishments hidden by unchanged counters; inconsistent opening identity;
and replaced company source identity. The pre-existing state-drift guard already
rejected replenishments added after the snapshot. All eight now pass, alongside
two read-only binding-validator tests and the existing rollback/retry suite.
The earlier no-serious-issue review conclusion is superseded by these corrections.
Treasury identity/replenishment fixture tables are minimal synthetic projections
for corruption and drift tests, not provider evidence or full treasury storage.

Eight additional size regressions cover inventory over 1 MiB, the exact 8-MiB
boundary, refusal above 8 MiB, UTF-8 byte accounting, dedicated snapshot reads
with unchanged ownership/digest checks, compact serialization when pretty JSON
exceeds 8 MiB, oversized final reports, and refusal of the larger report limit
outside inventory mode. Large stdout cases use a mocked successful psql process;
file/report cases use actual temporary bytes, not live schema evidence.

Repository-wide checks from the preceding implementation turn were attempted and
remain blocked outside this directory; they were not rerun for this correction:
`pnpm turbo lint` reported 11 errors in mobile-storefront, including existing
`tsconfig.json` formatting. `pnpm turbo typecheck` failed in
`apps/mobile-storefront/components/checkout/use-checkout-payment-controller.test.ts`
at lines 153, 172 and 180 (unknown props/result types). These files were not
edited. No repository-wide test-pass claim is made.

The supplied local metadata artifact's SHA-256 was verified as
`847646f609c14488cd60c430f1825b096767f18b6f7a67d45be6d0de67298930`.
Root-private provider GET and identity artifacts were not accessed or refreshed
by this sidecar. No browser, provider request, live staging apply, deployment,
commit, credential/environment/proxy edit, or migration edit was performed.
Parent review and root execution remain pending; `HANDOFF.md` provides guarded
inventory, goal-rehearse and goal-apply commands and proof requirements.
