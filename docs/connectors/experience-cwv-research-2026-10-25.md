# Full-code storefront performance: research and implementation recommendation

Research date: 2026-10-25. Research only; no runtime implementation, publication, infrastructure provisioning or paid AI calls.

## Recommendation

Use isolated route prerendering plus hydration inside the existing sandboxed frame, and add independent performance qualification to the existing build lifecycle. Keep arbitrary merchant React/TypeScript/CSS outside Baci's trusted server and top-level document. Keep Baci commerce and normal auth/RLS as the sole authority for cart, current price, shipping and checkout.

This is the best incremental fit for the current architecture, not a measured claim that the implementation will pass CWV. Prove it on Orbit before expanding the contract to all stores. A loader is an interim presentation fix. It is not the product's first useful content or a performance result.

## Verified implementation observations

The task worktree's local candidate is c90cae6d021de5abe630717e4d0808905a987648, with uncommitted follow-ups. Its base main is49c131fd8768f971802a926430397cf642b9afb1. The locally available origin/main moved to35b0a5720b96c167dda02c8c1a0a4a149cfa3591 during research. A read-only diff showed no changes between those main revisions in the experience components, runtime, runner, SDK or slug layout paths examined. A read-only git ls-remote check confirmed remote main is35b0a5720b96c167dda02c8c1a0a4a149cfa3591. No rebase or worktree refresh was performed for this research.

- `tools/experience-runner/bundle-source.ts` generates a client entry that waits for `bridge.ready` before calling `createRoot`.
- `tools/experience-runner/published-gateway.ts` emits an empty root, stylesheet and module script, and currently marks every response no-store.
- `ExperienceShell.tsx` mounts the frame after client activation and active-instance validation. `experience-launch-channel.ts` assigns its URL in a client effect and sends public bootstrap after the channel handshake.
- `ExperienceFrame.tsx` hides the frame before connection. These serial dependencies explain why the design cannot appear in initial HTML today; their relative timing still needs measurement.
- `StorefrontPprStaticShell` puts content under Suspense. A live JavaScript-disabled Next dev check remained on Loading storefront chrome. This is an observed delivery gap, not proof of its production cause; reproduce against a production build before choosing the shell fix.
- The semantic snapshot intentionally supports a small safe text/link tree. It is useful for semantics and fallback, but cannot reproduce arbitrary full CSS, images and layout. Do not turn it into a restricted design template to solve performance.

## Options

| Approach | Benefit | Limitation | Decision |
|---|---|---|---|
| Keep client rendering and polish loader | Small change; preserves isolation | Still waits for JS and bridge; does not fix first useful paint | Interim only |
| Execute merchant components inside Baci Next SSR/top document | Removes nested loading chain | Executes untrusted code in trusted runtime/document; conflicts with isolation | Reject |
| Generate only a structured native snapshot | Safe semantic fallback | Cannot preserve full arbitrary design/interactions | Keep as fallback, not primary design |
| Prerender real merchant components in gVisor and hydrate in frame | Full custom design, initial content, existing commerce boundary | Needs new immutable HTML artifact, freshness and hydration contracts | Recommended prototype |
| Serve each custom storefront as a top-level document on an isolated origin | Removes frame overhead and simplifies some measurements | Larger routing/auth/canonical/commerce redesign | Revisit only if the measured framed prototype cannot meet targets |

## Proposed design

### 1. Capture the real loading chain first

Use a guarded local production build with synthetic data and the repository's existing sitespeed/Browsertime video, Lighthouse, HAR and console workflow. Run tools sequentially on an idle host. Capture parent navigation, public manifest/data resolution, frame discovery/navigation, CSS/hero discovery, first actual custom paint, hydration and bridge readiness on a correlated time line. Keep three cold samples per mobile/desktop route profile and warm/soft-navigation results separate. Existing functionality receipts are not performance receipts.

### 2. Produce prerendered artifacts in the isolated build

Build a server-renderable entry alongside the browser entry. Render home, editorial and representative catalog routes with a pinned public bootstrap/catalog revision and approved assets inside the existing network-disabled, credential-free, CPU/memory/deadline-limited runner. Never import merchant modules into the Next server. In Node, use React renderToPipeableStream and wait for complete output for static generation; use hydrateRoot in the browser rather than createRoot over an empty node.

Retain route HTML, public bootstrap identity, JS/CSS/assets, renderer/runtime version and digests as one attested artifact set. Independently verify HTML, network rules and output quotas before it can become a candidate. Serve the output as a separate-origin sandbox document with current CSP, not by inserting raw HTML into Baci React. No dangerouslySetInnerHTML workaround. Rendering failure, timeout or non-SSR-compatible code returns actionable private build feedback; it must not silently substitute a loader and mark qualification passed.

Full custom code remains supported. The performance-capable contract requires a deterministic first render: browser-only APIs/effects run after hydration, initial cart/private state is stable, and server/browser IDs, asset URLs and bootstrap match. Keep browser-only interactions; do not replace custom code with a section schema.

### 3. Separate public paint from mutation readiness

The trusted server must resolve merchant, current published build and public data identity before presenting public content. Explore including the authorized frame URL in the first response, so discovery does not wait for Next hydration. The trusted frame wrapper can display pre-rendered public content while hydrating; the MessageChannel and current active-build checks still gate every commerce effect. A visible price is not an accepted checkout price. Do not optimistically enable purchase actions or bypass freshness while connecting.

Early frame discovery changes the load-event race: replace the current assumption that the parent always attaches its listener before src with a bounded, instance/digest/nonce-bound hello/connect protocol. Test already-loaded frames, BFCache, duplicate/replayed hello, reloads and superseded builds before adopting it. Separate content-painted, hydrated and commerce-ready milestones; channel-ready alone is not evidence of useful paint.

Keep merchant public data cacheable by tenant/build/route/locale/catalog revision. Cart, customer, owner auth, sessions, quotes and checkout stay uncached/private. Give verified content-addressed public JS/CSS/fonts/images immutable caching; keep current publication authority and document/data freshness separately validated and invalidated. Cached old bytes must never regain commerce authority after rollback/revocation. Do not place nonce, bearer token or shopper data in shared HTML artifacts.

The parent shell must also expose meaningful content without waiting for a client reveal script. Diagnose the observed outer loading state in production, then make the public shell/frame boundary available outside unrelated auth/cart Suspense work. Keep the safe canonical semantic fallback for crawlers/no-JS, and verify it at the actual merchant URL. Do not globally disable Next Cache Components.

### 4. Bake good defaults into the authoring contract

Expose a versioned performance profile through existing MCP capabilities/evidence, not a new AI service. Guidance should require responsive images with reserved dimensions, immediate discovery/high priority for the real hero, lazy below-fold media, small route-specific JS/CSS, local/subset fonts with stable fallbacks and nonblocking display, stable initial layout, and quick input feedback with heavy tasks deferred or chunked. Do not lazy-load the primary storefront frame/hero. Keep build/asset budgets deterministic and explicit; establish numeric byte budgets from the measured Orbit baseline and target device profile rather than inventing a universal number.

### 5. Independent qualification and honest telemetry

Use existing runner/browser infrastructure and open-source Lighthouse/web-vitals/Browsertime. Observe both top document and actual custom frame. A top-page observer can miss frame LCP/CLS/INP even for same-origin frames; CrUX includes frame content. Correlate frame/parent time origins and visibility in lab traces. Report host and frame metrics separately until an aggregation method has been validated; do not average their scores or claim a synthetic combined value equals CrUX.

Gate valid local production runs on LCP<=2500ms and CLS<=0.1, plus a <=200ms lab interaction-latency target for exercised menu, variant, cart and navigation interactions. Exercise post-load shifts, not just initial navigation. Keep TBT as a diagnostic, never as an INP pass. Keep all samples and ranges; missing metrics, wrong route, loader-only content, broken images, hydration failure, console errors or busy-host contamination mean unqualified, not passed. The public route and frame both need meaningful paint; a separately fast frame cannot erase parent discovery delay.

Instrument trusted runtime host/frame modules for later real-user LCP/INP/CLS and build/route/profile attribution through a bounded authenticated-by-channel message shape. Collect only minimal non-sensitive numeric data; no customer/form contents or arbitrary telemetry endpoints. Custom code shares the frame's JS realm, so self-reported runtime data remains diagnostic and must never become sole release/authorization proof. Independent browser evidence supplies the local gate. Production CWV status requires sufficient field data at the75th percentile, separately by mobile/desktop. No production telemetry installation is authorized by this research.

Bind qualification to source, build, route/data revision, runtime, browser and performance-profile version. Preserve private draft/preview access for iteration; public readiness must not become true when required evidence is absent or failed. Keep performance feedback distinct from owner publication permission.

## Implementation order and decision points

1. Baseline plus isolated Orbit prerender/hydrate prototype. Include a production no-JS test and origin-time-correlated filmstrip. Stop to reassess if it cannot meet cold-mobile targets; do not expand a failing architecture.
2. Version the artifact/SSR-bootstrap contract, fix early frame discovery and cache/freshness boundaries. Add hydration mismatch, cross-tenant, stale-price, revoked-build, failure-recovery and adversarial regressions. Refresh existing browser/commerce qualification.
3. Add versioned performance evidence/gates to existing MCP lifecycle, with actionable reports and agent instructions. Prove private iteration and failed qualification cannot publish. Establish operational RUM only under later release authorization.

This adds no AI-provider inference calls. Local compilation, rendering and browser tests use compute; zero AI cost does not imply future hosting is free. Current authorizations remain local-only synthetic data, normal auth/RLS, no publishing, orders, payments or paid services.

## Primary sources

- React server rendering: https://react.dev/reference/react-dom/server/renderToPipeableStream
- React hydration and identical initial markup: https://react.dev/reference/react-dom/client/hydrateRoot
- Next Cache Components and narrow Suspense boundaries: https://nextjs.org/docs/app/getting-started/cache-components
- LCP and real content: https://web.dev/articles/optimize-lcp
- INP: https://web.dev/articles/inp and https://web.dev/articles/optimize-inp
- CLS and reserved media dimensions: https://web.dev/articles/optimize-cls
- Frame measurement limitation: https://web.dev/articles/crux-and-rum-differences and https://github.com/GoogleChrome/web-vitals#limitations
- Lighthouse CI assertions/budgets: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md
- HTML sandbox origin/security contract: https://html.spec.whatwg.org/dev/iframe-embed-object.html
