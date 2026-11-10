# Durable prerender artifacts and local normal delivery

2026-10-26. Main snapshot `c2e351bec25e8ecd8dbd958a57edf5827632f663`, isolated worktree `/Users/mac/.codex/worktrees/experience-cwv/Baci-app`, branch `codex/experience-cwv-mcp`. Local, uncommitted implementation. No hosted migration, publishing workflow, orders, payments or paid AI.

## Connected behavior

The existing authenticated MCP build/owner-preview pipeline accepts a trusted `artifactDirectory` setting. It stores only compiled companion renderer output and its merchant/build/source binding on private local disk. Signed immutable records survive a new process and memory-cache pressure. Catalog, customer, session and cart data are not retained. Missing, corrupted, symlinked or mismatched records fail closed. Default admission limits are256records/512MiB; reaching capacity rejects new output rather than silently evicting accepted builds. Disk-write failures clean temporary files.

`startLocalPrerenderStorefront` composes the existing normal public reader, storefront runtime and loopback output gateway with this same store. Its returned `runtime` is the local storefront composition point; the default production runtime is not changed. It obtains fresh Baci catalog/bootstrap data and the current safe build binding under normal anonymous RLS, executes the renderer only inside the offline gVisor profile, validates inert HTML, and rechecks catalog/publication authority after rendering. The delivery gateway serves integrity-bound client resources with no-store HTML. Renderer bytes have no HTTP endpoint. Full custom React source and interactions remain supported; commerce stays behind the existing Baci host/SDK boundary.

The new append-only migration exposes only four build-binding identifiers through `experience_public_prerender_binding`, gated by the existing current-publication manifest projection. It does not expose source or renderer bytes. This migration has run only inside disposable local test databases. Synthetic published-head rows are fixture setup for the read path, not a call to a publishing or approval workflow.

## Local configuration

Supply the same private, server-owned `artifactDirectory` to `createLocalPrerenderPipeline` and `startLocalPrerenderStorefront`. Use normal caller-scoped clients for authenticated MCP operations and the ordinary anonymous client for public delivery. Install the returned local `runtime` through the existing storefront runtime composition and close `gateway` on shutdown. The constructor rejects production mode and requires a loopback host origin. No environment/proxy change or hosted infrastructure is included.

Preserve the directory and its private integrity key across local restarts; do not expose or commit either. Removing the directory makes its builds unavailable. Roll back local composition to the prior runtime to disable this path; no publication pointer is modified. This is a single-host local durability proof, not replicated/object storage or production rollout qualification.

## Verification

- Real normal-owner MCP upload/build/six-engine-viewport qualification/owner preview passes after constructing a second pipeline against the retained directory. Fresh price changes appear; grant withdrawal blocks subsequent reads. Published-head count remains0 in this private-flow test.
- A separate disposable PostgreSQL/PostgREST fixture tests normal anonymous delivery for home, collection, product and custom story routes. All return populated HTML. A normal-owner price update appears on the next render. Withdrawal during rendering returns404; anonymous access to private artifact rows remains denied. Orders remain0.
- Independent sandboxed browser replay of those exact delivered HTML/resource bytes passes at390px and1440px: visible content without JavaScript, decoded product images, hydration, custom Ink interaction, no page or console errors. This replay verifies rendering; the separate live fixture verifies authority.
- Baci cart/checkout and shipping regressions pass through final checkout review without creating an order. Shipping providers are mocked at their boundary.
- Focused application tests:60files/123tests. Runner tests:30files/78tests. Additional live durable-delivery integration:1test; desktop/mobile browser matrix:2tests; durable MCP flow:1test. Focused runner, authoring and durable integration TypeScript checks pass. Scope is affected experience packages and consumers; full monorepo/CI/release gates are not claimed.

The attached receipts explicitly set `cwvQualified:false`. These functional checks do not establish production Core Web Vitals. Next steps are production-build performance benchmarks on an idle host, full release checks/review, and separately authorized hosted storage/migration/rollout work. Existing Orbit preview on43174 is preserved; these tests use disposable delivery instances and do not silently upgrade that tab.

CodeRabbit raised 0 issues across the21 changed source files, using its included free CLI allowance. `source-binding.json` binds that review to unchanged final source hashes. Inherited integration work is outside this review scope. The initial command accidentally selected553 inherited files and was rejected at the free file limit; the corrected review used a local snapshot containing only this phase's diff.
