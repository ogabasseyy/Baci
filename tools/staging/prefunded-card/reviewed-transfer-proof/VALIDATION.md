# Validation evidence

Canonical workspace: `/Users/mac/Baci-worktrees/cursor-savings-phase1`.
All executed transfer/provider reads in these focused tests were mocked.

## Final focused checks

- Vitest: **185 tests passed in 15 explicitly selected files**.
- Owner collector: **20 passing colocated tests**, including the flat bypass,
  root, artifact byte/pin pairs, expiry, wrong transaction and sanitized errors.
- Biome: **14 owned TS source/test files passed**, no fixes applied by the check.
- Scoped TypeScript compiler API: **14 owned files passed**, no emit, no full
  project typecheck. Existing installed Node types were supplied explicitly for
  the root-only collector outside the web tsconfig scope. No installation.
- Every owned source/test/report is at most 300 lines; largest source is 255
  lines. No source outside the inventory was edited by this transfer lane.

Focused Vitest command (run from the canonical root):

```sh
pnpm --filter @baci/web exec vitest run --root ../.. \
  --config /Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/vitest.config.ts \
  apps/web/src/schemas/prefunded-card-transfer-verification.test.ts \
  apps/web/src/lib/piggyvest/normalize-prefunded-card-transfer.test.ts \
  apps/web/src/lib/piggyvest/collect-prefunded-card-transfer-proof.test.ts \
  apps/web/src/lib/piggyvest/prefunded-card-transfer-execution.test.ts \
  apps/web/src/lib/piggyvest/prefunded-card-transfer-provider.test.ts \
  tools/staging/prefunded-card/reviewed-transfer-proof/collector.test.ts \
  apps/web/src/lib/piggyvest/prefunded-card-provider.test.ts \
  apps/web/src/lib/piggyvest/prefunded-card-provider-verification.test.ts \
  apps/web/src/lib/piggyvest/prefunded-card-provider-stored.test.ts \
  apps/web/src/lib/piggyvest/prefunded-card-provider-request.test.ts \
  apps/web/src/lib/piggyvest/prefunded-card-runtime.test.ts \
  apps/web/src/lib/piggyvest/prefunded-card-execution.test.ts \
  apps/web/src/lib/piggyvest/prefunded-card-worker.test.ts \
  apps/web/src/lib/piggyvest/prefunded-card-operation-store.test.ts \
  apps/web/src/lib/piggyvest/prefunded-card-authorization-resolver.test.ts \
  --maxWorkers=1
```

## Reproduced RED / GREEN

1. Synthetic captured-shaped rich TSQ: the old adapter returned `deferred`
   instead of verified success with a genuine typed crosswalk/wallet contract.
   Measured one failure/two passes, then the same regression passed.
2. Contradictory optional third-party reference on the flat normalized contract:
   measured one failure/38 passes in the normalizer suite, then passed after
   rejecting contradictory optional references.
3. Owner collector flat bypass: a full flat receipt resolved without ownership
   or wallet reads. Measured one failure/22 passes across owner/execution suites.
   The rich-only owner gate then passed the same refusal regression; the generic
   flat contract remains supported and separately tested.

Execution tests cover native rich verification using the existing fenced
restricted completion, missing callback wiring, absent ownership and refusal
of owner-reviewed authority in the unattended provider. SQL boundaries are
mocked; these are NOT real database reconciliation/rehearsal evidence.

## Check limitations and earlier command mistakes

An early `pnpm --filter @baci/web test -- <file>` command incorrectly started a
broad suite because the test script passed a double-dash separator. Its owned
process was interrupted, not treated as a full passing run. It surfaced an
unrelated existing manifest assertion in
`tools/db/verify-supabase-history-replay-gigl-pending-sources.test.ts` plus missing
historical Git-path diagnostics. Those unrelated files were not edited.
Subsequent runs used the explicit `exec vitest run` command above only.

The first owner-suite attempt using a root override without the web config
failed alias resolution before running tests; the explicit config fixed that.
Initial scoped compiler attempts had a dependency path/Node-types configuration
issue and found two test-only typing issues, both corrected. Final scoped
compiler diagnostics pass. No full build/typecheck, remote CodeRabbit review,
dependency installation, PostgreSQL proof rehearsal, deployment or financial
mutation was performed here.

## Runtime and evidence separation

Production composition still has no authoritative ownership resolver and rich
TSQ intentionally defers there. This lane does not claim automatic recovery.
The existing provider checks verified stored transfer evidence FIRST and retains
its exact tuple checks; source inventory includes that unchanged priority in
`prefunded-card-provider.ts`. A separately reviewed genuine-original signed
receipt replay can therefore resolve the operation without direct rich-runtime
wiring. Receiver/replay changes belong to the other lane, not this inventory.
No receipt source is invented, relabeled or credited by this collector.

`HANDOFF.md` separates fixed historical byte anchors, freshly collected native
TSQ/wallet proof, parent-only session/function/baseline guards, rollback review,
fixed expiry and any later owner-approved completion. No apply executor exists
here. `SOURCE-SHA256SUMS` is the exact inventory, excluding itself to avoid a
self-referential digest.
