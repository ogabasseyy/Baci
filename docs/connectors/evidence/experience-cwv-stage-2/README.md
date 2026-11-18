# Local performance diagnostics and MCP integration — 2026-10-25

Base main: `2594d32c9dbc7f7e5c532f85f539080f418d4730`, verified against remote main before work. Isolated worktree: `/Users/mac/.codex/worktrees/experience-cwv/Baci-app`. Source changes are local and uncommitted. The original commerce preview and saved Orbit archive remain separate.

## Implemented and verified

The normal local private-preview integration is now implemented; see [the subsequent prerender MCP evidence](../experience-prerender-mcp/README.md). This page preserves the earlier benchmark snapshot.

- Full custom Orbit React/TypeScript/CSS source is unchanged. Four public route artifacts are rendered in the existing offline gVisor runner from normal anonymous/RLS synthetic catalog data. Merchant modules do not execute in the trusted host.
- The experiment paints actual styled Orbit content with JavaScript disabled, then hydrates and supports its Ink colour interaction at 390 and 1440 pixels. This experiment remains read-only; the Baci commerce preview remains on port43174. The prerender experiment is on port43176 with its opaque sandbox frame on43177.
- Added opt-in `read_experience_performance` to the existing MCP registry/gateway, with generated strict input contracts. It accepts only storefront and build IDs. The default eight legacy tools remain unchanged; the opt-in surface is now fourteen experience tools.
- Normal owner auth/RLS resolves the build and source digests before a trusted composition callback can read retained diagnostics. Authorization is repeated after the callback. Unknown builds, wrong digests, caller URLs and revoked grants are rejected. Missing measurements return `not-measured`. No request launches a browser or invokes AI. No service-role client, schema change or hosted mutation was introduced.
- Report schema fixes both CWV and release qualification to false. Actual retained browser results were round-tripped through the MCP HTTP gateway and disposable normal-auth PostgreSQL/PostgREST/RLS setup. This is local composition verification; it does not configure the hosted MCP service.
- Browser observers run in both frame and host. Frame LCP is translated to the host navigation time origin; host and frame CLS remain separate. Event Timing duration is explicitly a lab interaction diagnostic, not field INP. Missing metrics remain null.
- Each sample uses a fresh browser context, native CPU and native loopback networking. HAR, Playwright trace with screenshots, final screenshots and exact browser version are retained under `.superpowers/sdd/2026-10-25-experience-cwv/artifacts/`. HAR/trace files remain outside git. The browser job uses the existing 30-second gVisor deadline and network isolation. All four HARs contained six requests each, all HTTP200 and only loopback ports43176/43177. Traces contain17–43 screenshot resources. Selected mobile trace frames were visually inspected: initial blank navigation, styled Orbit hero, and the successful Ink selection; a complete production video review remains outstanding.

## Observed smoke samples — contaminated, not qualification

Chromium153.0.8010.12. One cold-context sample per viewport and renderer, home route only. The observation window is1500ms after content/image readiness, followed by one colour interaction. No field/lifetime metric is asserted.

| Renderer | Width | Frame LCP from host navigation | Frame CLS | Lab event duration | Images / errors |
|---|---:|---:|---:|---:|---|
| Client baseline |390|2665.6ms|0|192ms|decoded /0|
| Prerender experiment |390|2706.8ms|0|240ms|decoded /0|
| Client baseline |1440|3387.7ms|0|744ms|decoded /0|
| Prerender experiment |1440|2084.6ms|0|528ms|decoded /0|

The host had roughly150–166 load average against12 logical CPUs during these samples. All reports are explicitly contaminated. These observations do not establish an improvement or a CWV pass. Host LCP is null because the outer test host contains only a frame; substituting a loader score would be invalid. The mobile sample exceeds the2.5s target, and event-duration samples exceed200ms. Do not waive them or interpret them as field INP.

## Verification

- Experience/MCP focused unit tests:55files /103tests passed.
- Runner regressions:27files /66tests passed.
- Preparation, bounded Unicode input, document safety and observer tests:4files /7tests passed.
- Benchmark execution:1file /2tests passed, producing four diagnostic samples; passing execution is not passing performance.
- Independent no-JS/hydration browser proof:1file /2tests passed.
- Normal-auth/RLS MCP rejection contract:1test passed.
- Actual measured-report MCP round trip:1test passed.
- Scoped authoring, performance and builder-MCP TypeScript checks passed. The performance config initially omitted the existing consent-mode Window augmentation after adding the MCP integration test; the resulting five analytics type errors were fixed by including that existing declaration source, without editing analytics runtime code. Generated contract consistency passed. CodeRabbit completed the34-file CWV/MCP scope with0issues using the free CLI allowance. Final source hashes and exact review scope are in `source-binding.json`. Two subsequent non-runtime corrections are separately bound: include the existing consent-mode type augmentation and apply Biome formatting to generated JSON. Their scoped typecheck/schema consistency checks passed. This is not whole-candidate approval.

## Reproduce, in order

From `apps/web`, using the credential-filtered environment exported by `tools/experience-runner/qualify-release.mjs`:

1. `pnpm exec vitest run --config vitest.experience-performance.config.ts`
2. Bundle `prerender-browser-worker.ts` as Node ESM with `playwright-core` external and install it into the existing local browser rootfs. The SSR worker and bounded-input helper must also be installed in the existing Node rootfs. Do not execute merchant bundles on the host.
3. `pnpm exec vitest run --config vitest.experience-performance-benchmark.config.ts`
4. `pnpm exec vitest run --config vitest.experience-performance-browser.config.ts`
5. `pnpm exec vitest run --config vitest.experience-performance-mcp.config.ts`
6. `pnpm exec vitest run --config vitest.experience-lifecycle.config.ts tests/experience-lifecycle/performance-mcp.test.ts`
7. Restart only this worktree's `serve-prototype.mts` process after artifact regeneration, because its bootstrap is loaded at startup.

These explicit suites require the previously authorized local disposable gVisor runner and local PostgreSQL17. The isolated worktree now has its own offline-installed dependencies; it no longer shares mutable node_modules with the old commerce preview. No paid dependencies or AI calls were used.

## Remaining release work

1. Carry validated immutable route HTML and hydration bundles through the normal authenticated build, retention, preview and public-output lifecycle. The current normal MCP preview remains client-rendered. The experiment does not replace Baci commerce with a new adapter and does not establish production artifact provenance.
2. Integrate early frame delivery and a freshness-safe hydration handshake with the real Baci bridge. Keep current grant, tenant, catalog, cart and output revocation checks; never cache private bootstrap or cart/session state as public artifacts.
3. On an idle host, qualify an actual local production build with the repository's sitespeed.io/Browsertime video/HAR and separate Lighthouse workflow. Cover all affected route families, at least three cold samples per desktop/mobile profile, warm navigation and real cart/shipping interactions up to final checkout. Never create an order or payment. Inspect initial hero opacity animations and filmstrip before accepting a loader-free render claim.
4. Complete full candidate validation and required current-source review before any submission. Hosted MCP enablement, publication, release and field p75/CrUX qualification are not performed or authorized here.

No publishing, order creation, payment, production change or extra AI-provider charge occurred.
