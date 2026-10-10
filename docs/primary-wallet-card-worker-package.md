# Primary-card worker package final local handoff

Operator contract/runbook: `tools/staging/primary-wallet-card-custody/README.md`. This is a reviewed-source/local-validation package, **not installed, activated, reusable-crosswalk-ready or autonomous customer funding**. Parent reports the real signed PiggyVest route is hooked before legacy processing; no shared webhook or bank retry module was edited here.

## Exact changes

- Standalone compiled Node CLI and production/staging systemd oneshot/timer templates invoke the existing signed inbox runtime/dispatcher. Readiness makes no claims/provider requests; once mode uses only the existing authenticated GET observation path and durable settlement/finish. Bad acknowledgement, provider/storage failure and expired configuration cause nonzero worker failure for retry.
- `201100` separates intake database authority from custody settlement authority. Intake requires `baci_primary_card_intake`, `primary_card_signed_intake`, new `PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD` and owner-enabled `intake_authority` with a current bounded expiry. The existing dispatcher export/API is unchanged; no old custody-password fallback. Worker launch rejects intake/financial-transfer credentials.
- Worker launch supports explicitly authenticated internal issuer **operation-record file delivery**, not a guessed provider endpoint. It reports `crosswalkSelection=operation_records_only`, `reusableBindingReady=false`, `autonomousFundingReady=false` and `missingProviderContract=exhaustive_bank_and_internal_transaction_aliases`. A new operation with the same verified wallet does not inherit a prior record.
- Reusable mapping audit: existing scoped `transfer_context` already checks verified DB wallet/customer ownership and exact stored reference, and authenticated single-transaction lookup selects the operation. Available reviewed evidence does not establish complete bank/internal transfer alias discovery; neither verified wallet ownership nor single transfer success proves that alias set. Goal-specific paid-interest crosswalks are not borrowed as card authorization. See the operator runbook for the exact four required provider evidence groups and the subsequent restricted reusable projection/alias-extractor code still needed.
- All frozen migration bytes, owner treasury/limits/legacy balances, provisioning/interest/mobile and replay registry were preserved. The bank-before-custody raw retry queue is a separate parent-assigned lane.

## Final checks

- Focused web node Vitest: **237 passed / 32 files**.
- Tool CLI/entry Vitest: **4 passed / 2 files**.
- Standalone package Node tests: **2 passed**, including two fresh deterministic builds, hash/template checks and no-configuration failure without network actions.
- Full own-card scoped Biome: **82 files clean**, including the prior six formatting files, launch imports and typecheck JSON.
- Both card-only and tool-entry TypeScript configurations passed with a 1 GB heap; no broad web typecheck was rerun.
- Isolated Unix-socket-only PostgreSQL fixture passed and cluster stopped: actual intake enqueue and denied claim/settle/table access; distinct worker claiming the intake receipt; intake/worker expiry; generic user/service-role denied; retained prior collection/custody/bank exact-once fixtures.
- Parent additionally reported independent launch 15 tests / 3 suites, package 2/2 and signed webhook 42 tests / 6 suites. Those are parent observations, not extra checks performed by this worker.

## Stable artifact evidence

Generated locally at `/tmp/baci-primary-card-worker-final.wn0WAW3V/package` (no runtime environment loaded). `artifact.manifest.json` contains source/dependency closure, package generator, migration and output hashes, missing bindings and explicit `activated=false`, `providerWrites=false`, `autonomousFundingReady=false`.

```text
custody.cjs
c5465c6a09d56d3c2b11cf297ed990c6175d444a03fbb1fc8527623b5dd8dee2
artifact.manifest.json
7df83aa1952f1b1530738999fe9a1cf908b661917b966cd9b1d8674270919051
baci-primary-card-custody@.service
7733a2c59294f965da8c3e59959fc518e4f059814123656829acde4d715f1d07
baci-primary-card-custody@.timer
57126577248a8ffe48a8ae2799b5a47eb80f1bd3f5ebe93282209dae499dce71
20261007201100_primary_card_intake_role.sql
e3531dd94dc8ea9d411b8e30e2cf24533f3b3a30b99425dcb07faa05b7edee3b
```

Parent-registered `200900`/`201000` hashes remain respectively `f024431b7bcaae85e77e058031f8d83676afeb796b70401310368d5fc202c90b` and `bfa7e7af160fab3a6ef8b52f6045e18296bc1457d9593d79b001b92ef4e72d7b`.

## Remaining gates — not completion

External bindings: register/apply `201100`, provision isolated intake/worker credentials and DB capability/current expiry, approve exact canonical customers/wallet identity/complete transaction alias contract, operate authenticated issuer delivery/refresh, approve/install verified artifacts and enable/monitor the selected scheduler. No external settings or provider evidence were fetched or changed.

Receipt code after provider contract: approved authenticated exhaustive alias extraction/delivery replacing operation-record-only custody evidence. Until then the receipt file mode is bounded evidence/recovery, not automatic future payment settlement. The financial provider adapter and bounded financial selector/oneshot scheduler are now implemented separately: see `docs/primary-wallet-card-transfer-outbox.md`; they are not installed or live-enabled. Settlement receivable reconciliation/replenishment and completion notification/cache dispatch remain separate gates. Bank raw-retry handling remains the other assigned lane. Queued/custody_pending/readiness/submitted is not funded completion.
