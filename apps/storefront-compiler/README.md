# `@baci/storefront-compiler` (Phase 0 Spike — PR 1)

Isolated static compiler and `workerd` (Miniflare) data-plane benchmark harness for Baci's Open Agent Storefront Platform.

## Responsibilities
1. **Closed-Graph Static Compilation (`compileStorefrontWorker`):**
   - Compiles agent-authored React 19 + TypeScript + Tailwind CSS v4 storefront manifests into:
     - `worker.mjs` (Cloudflare Workers for Platforms SSR module with `bindings: []` — zero bindings so all subrequests pass through Baci's Outbound Worker).
     - `client.<hash>.js` (`<= 150 KiB` gzipped hydration bundle).
     - `styles.<hash>.css` (`<= 50 KiB` gzipped Tailwind v4 programmatic CSS).
   - Never evaluates merchant code during compilation; blocks `node:*`, `cloudflare:*`, URL imports, `../` path traversal, absolute paths, undeclared packages, `eval`/`new Function`, `navigator.serviceWorker`, `document.cookie`, and `dangerouslySetInnerHTML`.
2. **Host-Specific Container Isolation Profiles (`container-profiles.ts`):**
   - Expresses compiler limits in both `runsc`/Docker cgroup flags and Cloudflare Containers instance types, deriving the hard `SIGKILL` timeout (`max(5 * p95, 5000ms)`) from measured p95 compile latency.
3. **Ogabassey-Scale `workerd` SSR & Generation-Churn Benchmarks (`run-phase0-benchmarks.ts`):**
   - Executes compiled User Workers inside `workerd` via `Miniflare` against a 2,000-product catalog, verifying true HTTP `404` responses on unknown categories/products, Outbound tenant-binding enforcement, anon `cost_price` containment, and comparing single-`generation` vs split `catalog_structure_generation` + `availability_generation` cache hit ratios across `0, 2, 12, and 60` inventory writes/min.
