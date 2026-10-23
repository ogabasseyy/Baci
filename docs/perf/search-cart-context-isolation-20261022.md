# Search hydration: isolate background context publication

## Scope

Initially isolated on `codex/search-cart-context-isolation`, then incorporated
into PR #3755's `codex/cold-mobile-header-search` branch at the user's request.
Based on `074f64cdc09ae3b9378bb5bbb243e4c3701d354d`.
No merge or deployment is authorized.
The parent header-CSS repair is not part of this branch's incremental change.

## Failing case and cause

The initial search HTML can be visible before its client-reference dependencies
finish loading. Hold the local renderer dependency for 2 seconds and the search
client-reference dependency `177d76hjubw9n.js` for 4 seconds, with fresh mobile
contexts, CPU 4x, cache disabled and no input. Both the old control and the
parent #3755 build returned visible results to the route skeleton in 2/2 visits.
The retention assertion fails on both retained parent captures.

Conditional CDP logpoints capture scheduled updates and the actual suspending
fiber/promise. Background provider updates propagate into the still-unhydrated
search subtree; its V2ComparisonScope client reference is blocked, so the route
loading boundary is committed again. Merely deferring `isHydrated` did not stop
that propagation. The search route need not be an active cart consumer for an
ancestor context update to invalidate its dehydrated boundary.

A diagnostic that retained only the initial cart context value stopped the
return when other background publishers were held constant. That freeze is not
a production solution: it would stale cart UI. A cart-only subscription change
then exposed saved-items restoration as another publisher in the same failing
case. These are recorded causal paths, not proof that every natural occurrence
has one exclusive updater.

The theme reset also used January of the current year outside December,
scheduling an immediate reset for a past deadline. Three regressions failed on
January/October/November before correcting it to next January. Correcting only
that deadline did not solve the route return.

## Change

- Cart, saved-items and theme providers publish committed snapshots through a
  stable context channel. Only mounted consumers subscribe with
  `useSyncExternalStore`; unrelated dehydrated route content does not receive a
  new provider context identity on restoration.
- Publication runs after commit and before paint. The server snapshot remains
  the original SSR snapshot for consumers whose client module hydrates later.
- The cart reducer, bootstrap/link lifecycle, generation fences, persistence,
  adoption and command implementations are unchanged and remain urgent.
- The parent cart ready-state retention behavior moves to the cart consumer;
  it defers only presentation readiness, not items or command acceptance.
- Legacy direct CartContext providers and missing-provider behavior remain
  supported. Saved/theme command behavior and storage activation are unchanged.
- The theme deadline is always next January, retaining timeout chunking and
  December-to-January reset behavior.

## Verification boundary

The simplified SSR/hydration unit characterization also passed on the parent;
it is not offered as the failing regression. The actual red/green gate is the
retained real-browser ordering above. The unit additionally exercises Add,
quantity change, remove and clear before releasing the pending search module,
in legacy and shared modes.

Final browser acceptance on the source-matched production build:

- The retained parent case fails 2/2; the final diagnostic passes 2/2 while
  logpoints confirm the search client reference remains blocked and normal
  storage restoration runs.
- Four additional forced visits without debugger/storage instrumentation pass:
  two fresh-cookie and two stale-Santa-cookie visits, with playable videos.
  The renderer/search dependency holds are recorded (approximately 2/4 seconds).
- Nine final cold mobile visits pass (three each: products, search, smartphones),
  full Chrome 155.0.8059.86, 412x823 DPR2 mobile/touch and Android UA, fresh
  contexts, cache disabled and service workers blocked. All record zero input,
  no activation, scroll zero, foreground visibility, correct headings, and no
  broken completed viewport images. Once visible, every route heading remains
  visible; no route loading status returns. Initial loaders are still expected.
- The parent header repair remains intact: sticky header and 20px search icon
  from every visible observed frame. Raw HTML places its single critical rule
  set before header markup on all three routes and home.
- Videos/contact sheets were inspected; all 13 final videos decode. Main
  reserve is 691px. No CLS or speed result is inferred from these checks.
- No page exceptions were recorded. Existing anonymous cart 401 and local
  `/api/events` 403 remain; this is not a clean-network/console claim.
- Final production build succeeds with runtime-source hashes unchanged through
  build and matching at browser verification. BUILD_ID is not unique; use the
  hash receipt, not BUILD_ID alone.
- 590 affected cart/search/provider tests and 21 legacy cart compatibility tests
  pass (611 total). App typecheck (including worker
  and MCP projects) passes. App lint passes with six existing warnings.

CodeRabbit's required uncommitted review completed on retry: one trivial
memoization suggestion was not applied because the production compiler output
already caches the derived cart object by snapshot and effective readiness
(`0zxltquv4-1aq.js`). Manual memoization is also prohibited by repository policy.
The broad web-suite run was interrupted after approximately 53 minutes under
host contention; no full-suite pass is claimed. Every reported failing file
was rerun with one worker: the four feed tests and four checkout tests pass.
The Cloudflare process-isolation test reports exactly `tooling worktree is not
clean`, enforcing its existing clean-tree contract against the uncommitted fix.
Its post-commit recheck is recorded separately in local verification evidence.
The prior CI shard-4 failure was separately reproduced: the Task 1A repository
snapshot had a stale route-tree hash. Regeneration against the committed fix
updates only the source identity, route-tree hash and enclosing digest; all
584 classifications and the proxy-input hash remain unchanged. Its asserted
snapshot digest is updated with it. This is repository consistency metadata,
not new operational release evidence or authorization.
No merge or deployment is claimed here. No field p75 or blanket regression-free
claim follows from these functional captures.

## Evidence

Private/local evidence root:
`/Users/mac/.codex/cwv-lab-builds/20261022-pr3753-release/`.
See `SEARCH-TRIGGER-CONTINUATION.md`, `trigger-logpoints.mjs`,
`assert-search-retention.mjs` and the named per-arm JSON records there.
Browser videos and functional observations are separate from timing benchmarks.
Final receipt: `context-isolation-browser-receipt.json`; archived browser
bundles: `browser/context-isolation-final/` (with original-path mapping).
