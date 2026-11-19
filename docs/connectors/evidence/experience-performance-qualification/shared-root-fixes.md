# Shared generated-store safeguards

Source baseline: current main `de0e4a5f2fab01aa06964293d0c713fbea07ae6b`, isolated `codex/experience-cwv-mcp` worktree. Local synthetic checks only; no deployment, orders, payments or AI-provider calls.

The fixes apply to the shared SDK/compiler/host, rather than authored Orbit layout:

- Prerender documents deliver the initial root inert and hydration pending before browser modules execute.
- Newly compiled client and hydration wrappers opt into `react-commit/v1`. The host waits for a nonce- and current-route-epoch-bound React commit acknowledgement before readiness. Existing compiled clients retain the legacy handshake. Failed hydration keeps the boundary inert and triggers bounded recovery.
- Native measurement retains bounded raw layout-shift entries and raw CLS. Scored CLS excludes only entries strictly before native first paint. Missing paint uses raw CLS; post-paint shifts remain counted, and overflow contaminates the sample. This is lab accounting, not field CWV certification.
- MCP `get_experience_capabilities` provides authoring requirements: deterministic initial render, reserved dimensions, initial hero discovery, nonblocking optional features, byte budgets and per-build route/viewport checks. Guidance supplements runtime enforcement; it cannot guarantee every custom design performs identically.

The 24-attempt previous benchmark remains diagnostic: 16 measured samples and eight readiness failures on a busy host. A separate instrumented old-build product run reached ready, decoded both images and finalized its HAR/video. It does not establish a common cause for the eight failures. The new source requires fresh native checks and review before qualification; prior-build measurements do not validate it.

No claim that future stores automatically pass CWV is made. Every candidate still needs its own performance evidence; production field qualification remains unestablished.

## Verification in this change

- Experience runner: 33 files, 107 tests passed. SDK: four files, 10 tests passed. Web document/capability/report tests: 20 passed; host channel/frame tests: eight passed. Biome: 23 changed source/test files passed. Focused runner, worker, SDK and performance TypeScript checks passed.
- Native gVisor Chromium 153: editorial fashion, device configurator and motion studio, each at 390 and 1440 pixels. All six samples reached committed visible content with decoded viewport images, zero console errors and zero observed CLS. These minimal synthetic reference-host samples are diagnostic only, not the complete route matrix or production qualification. No interaction latency was measured.
- Visible post-paint regression control: CLS 0.369149; otherwise identical reserved-space control: CLS 0. Raw shift evidence is retained in the receipts.
- The first local proof fixture incorrectly used route epoch zero, below the SDK initial epoch one, and therefore stayed inert. Those attempts were retained in scratch and excluded from the valid six-sample evidence. No runtime workaround was introduced.
- Free CodeRabbit returned `rate_limit` (all three included reviews used). No paid credits were used and no clean-review claim is made.
- Full monorepo `pnpm typecheck`: eight tasks successful (five cached), completed in 3m46s. Existing Orbit preview has not been rebuilt with this source.
