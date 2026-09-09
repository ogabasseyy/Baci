# A1 — Per-route decision matrix (catalog metadata / prerender scope)

**Status:** design deliverable — closes the A1 gate in `workaround-retirement-plan.md`.
**Scope:** the 6 catalog routes in the retirement scope. No implementation here; per the
plan's execution order, A1 code may not merge until the non-security implementation gate
opens (S0-B ✅ + S1 ✅ + S2 resolved).
**Verified against:** `origin/main` @ `498ffb887c`.

---

## The constraint that decides every row

`generateMetadata` that **awaits `searchParams` defers metadata** — the route's head can no
longer be prerendered. So a route is prerender-eligible only if its title, canonical and
robots can all be produced **without** `searchParams`.

For the listing routes all three currently derive from `searchParams`:

| Output | Source | File |
|---|---|---|
| page-aware title fragment + description | `parseStorefrontPageParam(resolvedSearchParams.page)` | `[category]/page.tsx:83,~86` |
| self-referencing canonical | `getCanonicalStorefrontFilterSearchParams(resolvedSearchParams)` | `[category]/page.tsx:~168` |
| facet noindex | `getIndexableRobotsMetadata(resolvedSearchParams)` → `index:false` when `countActiveStorefrontFilters > 0` | `lib/seo-utils.ts` |

Second constraint: **a streamed error cannot change an already-committed 200.** A static
shell commits 200 before the body runs, so any route that must emit a *real* 404/308
before the response commits cannot be shell-resolvable.

---

## Decisions

| # | Route | Request-time behavior | **Decision** | Rationale |
|---|---|---|---|---|
| 1 | `[category]/compare` | `notFound()` **inside** `generateMetadata` (`page.tsx:132`, trade-off comment at `:125`) | **STAY DYNAMIC** | Empty hubs returning a *real* hard-404 is a deliberate, recently-shipped SEO fix (#3020/#3025/#3037, recrawl already owed). A static shell commits 200 first → soft-404, regressing it. Reopen only with an edge-level existence check → **belongs to C0/C, not A1.** |
| 2 | `compare` (global hub) | `notFound()` inside `generateMetadata` (`page.tsx:98`); noindexes query variants; sometimes delegates to category metadata | **STAY DYNAMIC** | Same 404-before-200 constraint as #1, same C0/C dependency. |
| 3 | flat PDP `products/[productSlug]` | Page component throws `permanentRedirect` → real **308**; `generateMetadata` deliberately does *not* redirect (explicit comment `page.tsx:65-69`) and only mirrors the checks to emit noindex | **EXCLUDE — stay dynamic, no static params** | It is a variant-cleanup/legacy **redirect** route with ~0 title value. A static shell degrades a real 308 into a soft meta-refresh. Confirms the plan's "likely exclude". |
| 4 | `search` | title + canonical from `q`; also `await headers()` (`page.tsx:27,29`) | **STAY DYNAMIC + noindex** (no change) | Query-derived metadata is definitionally not prerenderable, and the route is already noindex — prerendering buys no SEO value. |
| 5 | `[category]` | page-aware title, paginated self-canonical, facet noindex — all from `searchParams` (`:83`, `:219`) | **PRERENDER PAGE-1 — approved in principle, BLOCKED on 2 prerequisites** | The bare `/{category}` (page 1, no filters) is the indexable, high-value variant; every faceted/paginated variant is *already* noindex, so prerendering them is worthless. See prerequisites below. |
| 6 | `products` (index) | page title, canonical, bounds check, filtered robots — all from `searchParams` (`:59`, `:128`) | **PRERENDER PAGE-1 — same two prerequisites** | Identical shape to #5; decide and implement the two together. |

**Net: 4 of 6 routes are decided-dynamic. 2 are approved in principle but not yet unblocked.**

---

## Prerequisites for rows 5 & 6 (the only remaining A1 work)

Both must be satisfied before either route can be prerendered:

**P1 — move pagination out of `searchParams`.**
Adopt path-segment pagination (`/{category}/page/2`) so `page` becomes a route param.
Metadata then derives from `params`, not `searchParams`, and page 1 becomes statically
resolvable. The alternative (rel-canonical-to-root) is *rejected*: it would collapse
distinct paginated pages onto one canonical and lose the self-referencing canonical the
routes deliberately emit today.

**P2 — a non-`searchParams` mechanism for facet noindex.**
`getIndexableRobotsMetadata(searchParams)` is the last `searchParams` read. Options:
- **(a)** emit `X-Robots-Tag: noindex` at the edge when canonical filter params are present
  — clean, but it is proxy-layer classification, i.e. **coupled to C0/C**;
- **(b)** keep the *filtered* variants on the dynamic path and prerender only the bare URL
  — requires the route to branch before awaiting `searchParams`, which Next does not
  support inside one `generateMetadata`; realistically this means a **separate route
  segment** for filtered views.

**Recommendation: (a), sequenced after C0.** It keeps one route implementation and puts
robots policy in the same layer that will already own semantic route classification.

**Static-params contract when P1+P2 land** — mirror the proven nested-PDP implementation
(`(pdp)/[category]/[productSlug]/product-static-params.ts`):
- bounded: page size **200**, max **12** pages (≤2400 params) — categories are far smaller,
  so cap at the static tenant's full category list;
- single static tenant (`PRERENDER_PLACEHOLDER_STORE_SLUG`), placeholder param retained
  because `cacheComponents` requires `generateStaticParams` to return ≥ 1 entry;
- keep `dynamicParams` true so unknown categories fall through to the dynamic path.

---

## Consequences for the plan

- **A1 is now closed as a decision gate.** No route in this scope is a free quick win —
  confirming the plan's premise. Four are settled permanently; two carry named,
  independently-schedulable prerequisites.
- **A1 does not unblock any implementation on its own.** Rows 1–2 wait on C0/C, rows 5–6
  wait on P1 (self-contained) + P2 (C0/C). Row 3 and 4 are done — no follow-up.
- **A2 is unaffected** — it still requires the full-body bot-rendering/cache strategy, which
  none of these decisions provides.
- Suggested order once the non-security gate opens: **P1 (path-segment pagination)** is the
  only piece with no external dependency, so it can land first and independently; everything
  else in Workstream A queues behind C0.
