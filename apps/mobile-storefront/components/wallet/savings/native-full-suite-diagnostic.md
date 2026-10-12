# Full native runner diagnostic — 2026-09-12

## Original failure

Parent Turbo run `/private/tmp/piggy-frozen-candidate-test.log:15342` reports `jest --runInBand` killed with SIGSEGV, not a Jest assertion failure. Web tests were running concurrently and were interrupted when Turbo aborted; that run is not full-monorepo green.

The timestamp-matching macOS report `/Users/mac/Library/Logs/DiagnosticReports/node-2026-09-12-221700.ips` records Node PID5754 at22:16:52, immediately before the parent log's22:16:53 modification. Exception: EXC_BAD_ACCESS/SIGSEGV, KERN_INVALID_ADDRESS0x6. Faulting thread0 starts in `v8::internal::ClearStaleLeftTrimmedPointerVisitor::VisitRootPointers`, followed by root iteration and MarkCompact garbage collection. Host: ARM64, macOS26.6.2. This is evidence of a native runtime/GC crash, not proof that concurrency, OOM or any particular test caused it. No diagnostic environment, credentials or customer data were printed.

## Isolated unchanged rerun

Verified no active Jest/Turbo native tests before starting. Existing held browser QA fixtures were preserved; they are not competing native test runners. Parent was notified to reserve the native runner.

Command from `/Users/mac/Baci-worktrees/cursor-savings-phase1`:

```sh
pnpm --filter @baci/mobile-storefront test
```

This uses the unchanged package script: Jest `--runInBand`, then existing iOS/Android Node packaging tests. Node24.11.1, pnpm11.7.0. No dependency/configuration/cache changes, heap flags, environment edits, device actions or test skips.

**Exit0**, `/tmp/piggy-native-full-isolated.log` (terminal marker `NATIVE_TEST_EXIT=0`):

- Jest: 1009/1009 suites, 6013/6013 tests, 1/1 snapshot;196.797seconds.
- Existing Node packaging tests:5/5 pass.
- No SIGSEGV or assertion failure in this run. Existing Watchman recrawl/force-exit and test diagnostic warnings remain.

Observed process RSS samples were about1.66–1.87GB while progressing; these are samples, not a peak or evidence of original OOM. The full native crash was not reproduced in isolation. The most specific supported conclusion is a non-reproduced V8 native GC crash in the earlier concurrent run; root cause remains unproven. Current native tests pass the exact full package command. Prior focused81 tests are separate evidence. Parent must finish its interrupted web/root validation independently.

Runtime source and test configuration remain frozen/unchanged during this diagnosis. Only this local report was added.
