# Task 2 report — GIGL shipping settlement retention

- Base: `9b18b357718eeb67ff2ea0328ccd89a3936fa993`
- Head: the commit produced from this worktree (`feat: retain storefront GIGL shipping settlement`)
- Scope: order economics snapshot migration, paid-order rich projection, and settlement metadata/fee threading.

## Files

- Added `supabase/migrations/20260901191000_stamp_gigl_order_economics.sql`.
- Added migration contract tests and focused GIGL settlement regressions.
- Updated paid-order select/types, side-effect wiring, and settlement executor.

## Validation

- RED: before implementation, the mandated migration test command failed with Vitest `No test files found` (exit 1), demonstrating the missing contract.
- GREEN: focused migration, GIGL settlement, legacy settlement, Juicyway, side-effects, and financial-consistency suites passed: **6 files, 33 tests**.
- `pnpm --filter @baci/web lint` passed.
- `pnpm --filter @baci/web typecheck` passed.
- `git diff --check` passed.
- CodeRabbit uncommitted review completed without reported findings.

## Behavior and risks

The append-only trigger stamps only a merchant-matching, newly priced GIGL quote. Explicit `merchant_wallet` remains authoritative; legacy/null pricing remains null. Customer-checkout retained shipping is validated and combined with the commerce fee only at settlement; merchant-wallet, non-GIGL, and legacy/null paths retain zero and create no wallet side effect. Existing gateway-plus-platform-versus-gross fail-closed validation remains in place. No remote migration, provider call, deployment, or push was performed.

Known limitation: generated Supabase TypeScript table types are not edited in this task; regeneration should occur with the migration rollout process.

## Fix Round 1

- Cleared all five economics snapshot fields on missing, mismatched, non-GIGL, and legacy/wrong-version quote paths before returning from the trigger; order subtotal, total, and shipping fee remain untouched.
- Added migration regressions for each caller-supplied bypass and Juicyway parity coverage for customer checkout, merchant wallet/legacy null, and gross-fee guard behavior.
- Validation: migration, GIGL, legacy settlement, Juicyway, side-effects, and financial-consistency suites passed (**6 files, 41 tests**); web lint/typecheck and `git diff --check` passed.
