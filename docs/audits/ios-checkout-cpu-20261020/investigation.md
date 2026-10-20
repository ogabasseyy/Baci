# iOS product, cart and checkout CPU investigation

Date: 2026-10-20. Baseline: `db913dd1ca` (full revision in the retained manifest).

## Finding and change

The cart checkout arrow and checkout action arrow each scheduled an infinite Reanimated loop. Neither stopped on navigation blur. Native stack screens can remain mounted beneath the next route, so their decorative animations kept cloning Fabric shadow trees and calculating layout while the shopper had moved on. Home's utility rotation also lacked a focus guard; a deterministic regression reproduced its continued rotation while covered by product.

Cart and checkout now share a finite three-cycle attention cue, retain their original 600/800 ms timing, reset to rest when processing, and cancel on blur, background/inactive state and unmount. Foreground/focus can start a fresh finite cue. Home pauses its rotation timer while unfocused and resumes on return. Checkout actions, totals and payment behavior are unchanged.

## Profiling method

- Real full Expo Router app and native Fabric/Reanimated renderer, isolated guest/catalog/checkout fixtures. No real account, order, payment or provider call.
- iPhone 18 Pro simulator, iOS 27.0; Debug native build and development JS. Disposable bundle `com.ogabassey.cpuprobe`, version 2.0.1(9), UUID `544AFB77-9D04-35F5-A9D7-A876DC3DB38E`.
- Same native binary and fixture across baseline/candidate. Two process runs each, ordered baseline, candidate, baseline, candidate. Product → cart → checkout preserves the underlying route stack; fixture cart contains one product.
- After navigation, wait eight seconds, reset the phase, then measure cumulative process CPU (`ps time`) over fifteen seconds after a one-second settling period. Native sampling runs separately, outside the measured windows. The confirmation pass records the actual router pathname and no fixture errors for all six phase snapshots.
- Product/cart/checkout entry and navigation use a disposable in-app software test driver. This does not verify physical keyboard, touch/scroll latency, external provider SDKs, production image/catalog loads or thermal behavior on an iPhone.

## Results

Percent of one CPU core, two fifteen-second idle windows per screen and source state:

| Screen | Baseline runs | Fixed runs | Interpretation |
| --- | --- | --- | --- |
| Product | 7.5%, 3.5% | 3.8%, 4.5% | Variable; no reliable product-specific improvement established |
| Cart after product | 16.2%, 20.7% | 3.5%, 4.2% | About 79% less CPU, comparing the means |
| Checkout after cart | 20.4%, 26.5% | 3.5%, 4.5% | About 83% less CPU, comparing the means |

These are simulator observations, not production CPU estimates or a statistical benchmark. The host experienced memory/disk pressure during initial setup; interrupted captures were excluded. The earlier standalone-cart window is not included in the normal-stack comparison.

The retained three-second native checkout samples corroborate the mechanism. Baseline: 162 of 612 main-thread samples pass through `AnimationFrameQueue.executeQueue`, including 138 through `ReanimatedModuleProxy::performOperations` and recursive `cloneShadowTreeWithNewPropsRecursive`/Yoga layout. Fixed: 6 of 960 main-thread samples pass through the frame queue; neither `performOperations` nor recursive shadow-tree cloning appears. Recursive inclusive frames are not added together. These are native symbol-table samples; system-frame gaps remain.

Initial ETTrace multi-thread captures had matching dSYMs and showed the same Reanimated/Fabric work. Their temporary JSON files were later removed outside the retained-artifact location. They are qualitative supporting observations only, not the basis of the paired numbers above. The original simplistic fiber-flag counters and unsuccessful native-op monkey patch are excluded from all conclusions.

## Evidence and limitations

Portable CPU windows, source hashes and native sample counts are in `results.json`. Retained local artifacts: `$CODEX_HOME/diagnostics/baci-cpu-20261020/`:

- `manifest.json`: baseline revision, installed binary UUID and candidate runtime file hashes.
- `measurements.jsonl`, `measure.py`: raw CPU windows and measurement protocol.
- `reports.jsonl`, `entry.js`, `server.cjs`, `launch.mjs`: fixture/route acknowledgements and reproducible local harness. Its environment contains locally generated dummy capabilities and must remain outside source control.
- `baseline-checkout-steady-sample.txt`, `candidate-checkout-steady-sample.txt`: native stacks.
- Validation logs and Jest JSON results.

The profiling app was uninstalled, its simulator shut down, and temporary native project, package entry, local config and TypeScript config changes restored. The regular installed app and other worktrees were preserved.

Build 638's MetricKit CPU diagnostics were collected from a physical device with serious thermal state and an earlier source revision. This work demonstrates a cause of avoidable CPU in the current source; it does not prove every reported MetricKit stack or iOS rendering hang is resolved. Do not mark Sentry issues resolved from these measurements. Real-device release validation remains necessary. Simulator UI access was blocked by browser policy on reconnection; no later native keyboard interaction is claimed.

## Validation

- The focused regression suite failed on the original runtime: six failing tests reproduced infinite repetition, missing blur/background cancellation and hidden home rotation. It passed with the fixes.
- All 25 affected Jest suites pass: 118 tests, including cart actions/price changes and checkout contact/address continuation, payment/review and retry fixtures. `--findRelatedTests` covered the three changed runtime modules and their tested consumers.
- Storefront lint passes with one existing unused-suppression warning in `hooks/use-copy-to-clipboard.ts`; platform-drift passes.
- Before the routing follow-up, fresh storefront typecheck reproduced nine existing typed-route errors: two in `app/saved/index.tsx`, six in Elite/Fashion/Standard slide test fixtures, and one in `components/wallet/WalletScreen.tsx`. Temporarily restoring every task-owned source/test change to HEAD and excluding only the new test reproduced the exact same nine diagnostics with `turbo --force`. Generated router types were preserved. An initial baseline cache hit was disregarded.
- No shared runtime, dependency or build/test configuration changes remain, so validation is scoped to storefront. No production release or physical-device validation was performed. CodeRabbit was skipped at the user's request.

## Routing type follow-up and release preparation

The saved-item product href retains its template-literal type; the wallet panel preserves the sanitizer's `WalletReturnHref` instead of widening it to `string`. Slide fixtures now use valid category routes with literal types. These changes preserve runtime navigation and keep typed routing enabled.

A fresh storefront typecheck and lint pass after these fixes. The expanded affected suite passes 190 tests in 32 suites, including saved item selection, wallet consumers and all three slide variants. The earlier nine diagnostics are historical baseline evidence, not remaining blockers. PR CI, head-specific review, merge, signed delivery and Apple public availability are separate subsequent steps.
