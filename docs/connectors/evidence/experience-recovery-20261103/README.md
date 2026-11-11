# Experience integration recovery — 3 November 2026

The recovered implementation is reconciled onto main `a22bf2cceeac3de81919f011bbb85c691e69e7e7`, in isolated branch `codex/experience-recovery-20261103`. The previous base was 103 commits behind. Main advanced once during recovery; its disjoint sandbox-proof tooling update was fast-forwarded without conflicts. No feature commit, push, PR, publication, deployment, hosted migration, order or payment was performed.

## Source recovery

- Applied retained stash `230760e6f0a87fa802c85512ac4d1e097e320625` without removing it.
- Located later unreferenced Git tree `c1a7cdc35c7b3957f3262b4db72523ad778cf741`; restored its review fixes and retained it under a local recovery ref.
- All 803 paths in that saved source inventory exist. Preserved current-main dependency versions, cart credential behavior, CI changes, catalog/PDP improvements, consent behavior, credential registries and shared exports.
- Recovered the final three payment-caller collector files from original agent patch records, keeping current-main assertions and allowlists intact.
- Orbit's separately saved 17-file source/compiled/evidence archive passes its existing SHA256 manifest. It remains at `/Users/mac/Documents/Baci-design-research/orbit-ogabassey-concept-2026-10-25`.
- `recovery.json` records provenance and differences. Old evidence directories retain their original dates and bases; none is rebound as current-main proof.

## Fixes while reconciling

- Kept main's lockfile graph and added only the SDK importer/dependency closure, avoiding unrelated mobile peer-resolution churn. Frozen offline lockfile validation passes.
- Loaded the quota replacement after the original lifecycle function in the disposable SQL fixture. The previous ordering failed with PostgreSQL 42723; SQL/auth checks now pass. No historical migration was edited.
- Applied the same ESM testing-library and single-React resolution used by current main to SDK tests. The original run had two invalid-hook failures; all SDK tests now pass.
- An in-flight renewal is now bound to its execution instance, and retired admission checks cannot withdraw a replacement. Its regression failed before the fix; all 72 component tests and commerce typecheck pass.
- Same-route navigation now returns the current trusted canonical route without beginning an unfinishable transition. Three regressions failed with ROUTE_TIMEOUT before the fix and cover home, canonical product and authored product alias.
- Fallback cart status follows the native engine's applied/rejected outcome. A rejected-outcome regression failed before the fix. Added coverage for the real empty-catalog result as well as defensive rejection.

## Validation boundary

See `checks.json` for current results. The final-main focused run passed 262 files / 1,164 tests; the subsequent renewal fix passed all 29 component files / 72 tests and the commerce typecheck. This is source recovery and reconciliation, not release qualification. Current-main desktop/mobile journeys, the full web suite, clean CWV measurements and final whole-candidate review remain separate gates. No performance guarantee is inferred from historical Orbit results.

At recovery time the default Colima VM was stopped and its ignored toolchain receipt was absent, so private authoring could not run. The authorized follow-up restored the VM, rebuilt trusted workers and the receipt, and passed the live compile and private-authoring checks. Desktop/mobile checkout now reaches final review with zero orders. All 24 CWV captures completed but were contaminated by shared-host load, so timing/release qualification remains pending. See [the follow-up evidence](../experience-sandbox-checkout-cwv-20261103/README.md). No fake digest, skipped assertion or host compilation of untrusted source was substituted.

Free CodeRabbit reviewed the storefront components. Its valid issues were reproduced and fixed. A follow-up attempt hit the shared included-review limit; the free retry was started after reset. No `--use-credits` option was used. See checks.json for the final scope and outcome; whole-candidate review is not represented as all-clear.

## Local recovery locations

- Active isolated worktree: `/Users/mac/.codex/worktrees/experience-recovery/Baci-app`.
- Independent source-file archive, binary Git patch, per-file manifest and SHA256 manifest: `/Users/mac/Documents/Baci-design-research/experience-recovery-20261103`.
- The app worktree tool could not access the source repository; Git created the isolated worktree directly. App attachment also rejected it as unmanaged. All commands used the explicit isolated path; the shared checkout was not modified.

The follow-up CSS-token suggestion was declined against current code: `src/lib/storefront-defaults/curated-theme-token-projection.ts` defines `--store-background-text` from the contrast-aware foreground. Its existing dark-theme regression passes. The other follow-up issue, instance-renewal isolation, was fixed with a regression. No clean whole-candidate review is claimed.
