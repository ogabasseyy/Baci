# Local prerender artifacts in the normal MCP build/preview flow

2026-10-25. Main snapshot: `def9f0b7a52abf1367cec63b75f0c315c33925e0`. Worktree: `/Users/mac/.codex/worktrees/experience-cwv/Baci-app`, branch `codex/experience-cwv-mcp`. Local, uncommitted implementation; no hosted enablement or publication.

## What is connected

`createLocalPrerenderPipeline` composes the existing authenticated build supervisor and owner preview runtime around one bounded companion-artifact store. A local composition supplies normal user clients and the existing verifier receipt callback, fresh public catalog bootstrap, the private resource vault and local host origin. Set the dispatcher `rendering` and `finalizeBuild` from this pipeline and use its owner `createPreviewLaunch` alongside the existing approval methods. The existing fourteen opt-in experience tools and default eight legacy tools keep their input contracts. `get_experience_capabilities` reports `runtimeRendering: prerender-private` when this local pipeline is selected.

The queued source still travels through normal MCP upload, build and finalization. A separate offline gVisor compilation job produces the hydration client and SSR renderer. Independent compilation checks both outputs; the existing six browser qualification captures exercise Chromium, Firefox and WebKit at390/1440px. SSR also runs inside gVisor before acceptance. The renderer digest is included in the trusted verifier receipt, and renderer bytes are retained against merchant, build and immutable source digests. Candidate validation is a pure module shared by the application and standalone tools; this avoids introducing Next.js environment declarations into the credential-filtered runner.

An owner launch resolves the normal RLS-protected build/source and creates the existing short-lived preview binding. It obtains a fresh public bootstrap, substitutes freshly minted asset tickets, and runs the exact retained SSR renderer inside the offline sandbox. A separate inert HTML parser validates and normalizes the result; merchant JavaScript never executes in the trusted host. Active markup, event attributes, dangerous URLs, document clobbering, and unapproved preload links are rejected. The document embeds escaped bootstrap JSON and integrity-bound application resources, then receives a new immutable private HTML ticket. It is never inserted into the trusted Next.js DOM.

Owner/grant authority is checked again after rendering and immediately before returning the owner descriptor. The existing database liveness projection is checked after asynchronous work and on every resource read. Missing/evicted/mismatched companion output fails closed. Failed renders revoke staged resource tickets. The child remains on an independent origin with opaque sandbox origin, restricted CSP, no-store responses and no network/credential access during execution.

The hydration entry retains full React/custom interactions and uses the existing Baci commerce SDK. It hydrates initial markup in private prerender previews, while preserving the client-rendered capture path for independent build qualification. Private shopping continues to use Baci's existing simulated preview dispatcher; it cannot inject a live cart writer. The normal storefront commerce engine and its auth/RLS contracts are unchanged.

## Verified behavior

- MCP source upload → queue → independently qualified build → preview capture → normal owner launch passed with real disposable PostgreSQL/PostgREST and normal authenticated owner clients/RLS.
- The tested composition uses `createLocalPrerenderPipeline`; capabilities report private prerender support. No model-provided success or approval flags are accepted.
- Updating the synthetic bootstrap price from250 during build to320 before launch produces320 in the actual private HTML. Preview HTML is therefore not a frozen build-time catalog snapshot.
- Disconnecting the real synthetic connection makes previously issued HTML tickets unreadable and prevents new launches. Published-head count stays0.
- Exact produced private HTML/client/resource bytes were then replayed inside the independent browser gVisor profile. At390px and1440px, content rendered with JavaScript disabled; with JavaScript enabled it hydrated and the custom `Count0` button changed to`Count1`, with no page errors. This replay proves byte/render behavior; live authority is checked separately by the RLS test and never recreated by replay.
- The existing normal-role public catalog/price and shipping-attestation regression tests passed. The real scoped Baci cart engine also passed lazy creation, response-loss replay, cart snapshot and final checkout review; its orders-table assertion remained0. Provider shipping calls were mocked. No order submission, payment or external provider action ran.

## Validation and known failures

Focused experience/MCP/preview unit suite:60files /123tests passed. Runner suite:28files /71tests passed after the retention fix. The final normal-auth MCP/private-owner integration passed, and both independent browser viewport tests passed. Commerce regression suite:2tests passed. Real cart-engine checkout-review regression:1test passed. The pure validator extraction was additionally checked through the existing2candidate tests and2artifact-store tests.

Scoped authoring and performance typechecks passed. Runner typecheck initially failed because the new store imported an application service which pulled in Next.js's required `ProcessEnv.NODE_ENV` declaration. Moving the existing unchanged pure candidate validator to its own module fixed that dependency leak; runner typecheck then passed without widening subprocess environments. Biome passed on the affected source. CodeRabbit reviewed29files using its included free CLI allowance and raised1issue: tying renderer retention to a ten-minute lease window breaks later launches. This was regraded as important usability and fixed with bounded LRU retention, without a client-rendered fallback. The exact retention and eviction regressions failed before the fix and passed afterward. The resulting3changed files were not re-reviewed; before/after source hashes and the review receipt are recorded in `source-binding.json`. This is not whole-candidate release approval.

The first end-to-end owner launch failed because this lifecycle fixture had not loaded the already-existing private-preview migration. Loading that exact migration only in the disposable fixture fixed it. No migration file or hosted schema was changed. Origin credential/mismatch and late owner-revocation guards have deterministic RED→GREEN regression evidence.

The first mobile replay timed out on a5s pointer action while desktop passed. A bounded diagnostic rerun, followed by the complete final390/1440matrix, passed without increasing action timeouts or the30s browser sandbox deadline. Diagnostic instrumentation added a DOM state read; the original failure remains preserved in `/tmp/experience-private-browser-proof.log`. Its precise cause is unproven, so no stability, CWV or release qualification is inferred from a later green run.

## Local limits and release boundary

Companion renderer retention is deliberately process-local and bounded by LRU eviction to32entries /64MiB of serialized candidate bytes. It has no fixed ten-minute age limit; preview resource leases retain their separate expiry and revocation checks. It is suitable for this authorized local synthetic flow; it is not durable production retention. Restart/eviction requires a fresh build, and a missing renderer cannot silently fall back to a blank client preview. Private resource leases remain separately bounded and revocable.

Public publication delivery, public prerender artifact retention, production enablement and field CWV remain separate release work. No production build/Lighthouse/video matrix or field p75/CrUX qualification is claimed. The existing full-candidate submission/CI/review gates remain required. Nothing was committed in the task worktree, pushed, merged or deployed.

## Reproduce

Use the credential-filtered `experienceReleaseEnvironment()` from `tools/experience-runner/qualify-release.mjs`; run commands from `apps/web`.

1. Prepare the previously authorized disposable gVisor profiles. `experience-runtime/build.mjs` now installs the separate prerender compiler and the existing bounded SSR worker/helper; worker identities remain source-bound in the local evidence. Do not run authored modules in the host process.
2. `pnpm exec vitest run --config vitest.experience-lifecycle.config.ts tests/experience-lifecycle/prerender-mcp.test.ts`
3. Bundle `tests/experience-performance/private-preview-browser-worker.ts` as trusted Node ESM with `playwright-core` external; install it as `/opt/experience/private-preview-browser-worker.mjs` in the existing browser profile.
4. `pnpm exec vitest run --config vitest.experience-prerender-browser.config.ts`
5. `pnpm exec vitest run src/lib/experience src/app/builder/experience/preview builder-mcp-server/experience-registry.test.ts`
6. `pnpm exec vitest run --config vitest.experience-runner.config.ts`
7. `pnpm exec vitest run --config vitest.experience-commerce.config.ts`
8. `pnpm exec tsx --test tests/experience-commerce/cart-engine.node.test.ts`
9. Run the scoped authoring, performance and runner TypeScript configs and affected-file Biome checks.

Scratch source/worker identities and browser artifacts are under `.superpowers/sdd/2026-10-25-experience-prerender-mcp/`. Captured private launch tickets/bootstrap files remain ignored and synthetic; only bounded receipt metadata and screenshots are copied here.

No publishing, orders, payments, production changes or extra AI-provider costs.
