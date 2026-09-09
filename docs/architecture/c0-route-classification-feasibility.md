# C0 — Semantic route classification: feasibility & design gate

**Status:** design deliverable — answers the five C0 questions in
`workaround-retirement-plan.md`. **Design only; no `proxy.ts` change.** `proxy.ts` is a
protected file, so any implementation needs explicit owner approval.
**Verified against:** `origin/main` @ `498ffb887c`.

C0 blocks **C** and **B3**, and (per the A1 matrix) also gates four of the six catalog
routes whose only path forward is an edge-level check.

---

## 1. Why this gate exists — measured, not asserted

`apps/web/src/proxy.ts` is **4,684 lines** carrying **~20 hand-maintained route
classification lists**. Several are explicitly documented as needing manual sync, e.g.
`STOREFRONT_ROUTE_FIRST_SEGMENTS` (`:758-766`):

> *"Keep in sync with the `(storefront)/[slug]` route groups."*

**There is no test anywhere in the repo that enforces that sync** (verified: no test file
references `STOREFRONT_ROUTE_FIRST_SEGMENTS`, `CACHEABLE_PUBLIC_STOREFRONT_FIRST_SEGMENTS`
or `RESERVED_STOREFRONT_SEGMENTS`).

### Finding C0-1 — one live segment was unreserved (latent bug, fixed in #3196)

> **Note — an earlier revision of this document overstated this finding**, claiming 17
> unprotected segments including `blog`. That was wrong and is corrected below. The error
> is itself evidence for C0: reading these sets statically is unreliable, because
> `STOREFRONT_ROUTE_FIRST_SEGMENTS` spreads `NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS`,
> which spreads `...RESERVED_STOREFRONT_SEGMENTS` (`:740`) — an extraction that counts only
> quoted literals under-reports the effective set. **`blog` is protected** (transitively),
> and `proxy.test.ts` already covers it.

Measured behaviourally instead: every candidate segment was driven through `proxy()` as a
retired alias on a custom domain. **16 of 17 were protected. Exactly one was not:**

```
unlock-orders
```

- **Mechanism.** `RESERVED_STOREFRONT_SEGMENTS` → `NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS`
  → `STOREFRONT_ROUTE_FIRST_SEGMENTS`, the set consulted by the retired-slug strip
  (`:3333`) and the alias API-prefix guards (`:1344`, `:3523`). `unlock-orders` was the only
  live storefront first-segment absent from that chain.
- **Impact.** A merchant whose retired slug was literally `unlock-orders` had their own live
  `/unlock-orders/*` route 302-stripped on their custom domain.
- **Severity: latent, not active** — it requires a retired slug equal to a route name.
- **Fixed in #3196**, together with a regression test that walks the route tree at test time
  so the next missing segment fails CI instead of drifting silently.

**What this does *not* change:** the guard list genuinely was out of sync with the route
tree, no test enforced the sync it documents, and the gap stayed invisible until something
enumerated the tree. That is precisely the failure mode the C0 generator + CI verifier
exist to remove — the case for C0 is unchanged.

---

## 2. Classification schema (C0.1)

Three classes, as the plan specifies, plus the scope needed to disambiguate:

```ts
export type RouteClass =
  | 'public-cacheable'   // anon-safe, downstream/CDN cacheable
  | 'public-no-store'    // anon-reachable, MUST NOT be cached (personalized/mutating)
  | 'private';           // requires auth; never cached, never slug-shadowable

export interface RouteClassification {
  readonly segment: string;                       // first URL segment
  readonly scope: 'storefront' | 'platform' | 'api';
  readonly class: RouteClass;
  readonly reservedAgainstSlug: boolean;          // may a merchant slug shadow it?
  readonly reason: string;                        // why — kept in the artifact for review
}
```

The generator additionally emits the **derived sets `proxy.ts` consumes today**, so the
migration is a substitution rather than a rewrite of call sites.

## 3. Source of truth (C0.2)

**Decision: colocated route metadata + CI-enforced completeness. Not route-group renaming.**

| Option | Verdict |
|---|---|
| Route-group conventions (`(public-cacheable)/…`) | **Rejected.** The existing groups already encode rendering/layout concerns (`(storefront)`, `(catalog)`, `(listing)`, `(pdp)`, `(home)`); overloading them with cache semantics forces a tree restructure across many routes — high blast radius for a classification problem. |
| Runtime read of the `.next` route manifest | **Rejected** (plan already forbids). `proxy.ts` runs per-request on the Node runtime; a manifest read adds per-request I/O and is not reliably available in all deploy targets. |
| **Colocated `route-meta.ts` per segment + prebuild generator** | **Chosen.** Additive (no restructure), explicit and reviewable next to the route, and the generator can **fail closed** when a route has no metadata. |

## 4. Generated artifact (C0.3)

- Generator: `apps/web/tools/routes/generate-route-classification.ts`, run in **prebuild**.
- Output: `apps/web/src/generated/route-classification.ts` — a typed frozen const plus the
  derived sets. Committed, so `proxy.ts` imports a static value with zero runtime cost.
- `proxy.ts` change is then a one-line import swap per list — the smallest possible diff to
  a protected file.

## 5. CI divergence gate (C0.4)

**Reuse the repo's proven pattern rather than inventing one:** the migration registry
already does exactly this — `apps/web/tools/db/verify-current-migration-registry.ts` walks
the real files, recomputes the expected set, and **throws** when the committed manifest
differs. Mirror it as `verify-route-classification.ts`:

1. walk the App Router tree for `page.tsx` / `route.ts`;
2. recompute the artifact;
3. **fail** if it differs from the committed file (drift), **or** if any route lacks
   `route-meta.ts` (missing classification — fail closed, never default to public).

This is what converts C0 from "a better data structure" into "drift becomes impossible",
and it is the only part that actually retires the band-aid.

## 6. Private-route collision tests (C0.5) — required before B3 consumes it

- every `private` route asserted **not** matched by any `public-cacheable` rule;
- every `reservedAgainstSlug` segment asserted un-shadowable by a merchant slug;
- **regression for Finding C0-1** (already shipped in #3196, to be folded in): for each live storefront segment, a retired
  slug of that exact name must **not** strip the live route;
- `RESERVED_POSTHOG_RELAY_PATH_PREFIXES`, `PUBLIC_MACHINE_READABLE_PATHS` and
  `CUSTOM_DOMAIN_APP_ROUTE_FIRST_SEGMENTS` asserted disjoint from storefront segments.

---

## Verdict

**C0 is feasible, and the design is a direct analogue of a pattern already proven in this
repo** (the migration-registry verifier). It needs no new infrastructure and no vendor
capability.

**Recommended sequencing**
1. ~~Fix Finding C0-1~~ — **done in #3196** (reserve `unlock-orders` + a route-tree-walking
   regression test). Owner-approved; it was a `proxy.ts` edit.
2. C0 implementation (schema → colocated meta → generator → artifact → CI gate) once the
   non-security implementation gate opens.
3. **C** (proxy consumes the artifact), then **B3** (tenant-scoped classification), then the
   A1 rows that need an edge existence check (#3193, rows 1–2).

**Owner decision still required for step 2:** `proxy.ts` is protected, so the import swap
needs sign-off before code lands.

**Note on scope.** #3196's regression test already enforces the sync for *one* list
(`RESERVED_STOREFRONT_SEGMENTS`, behaviourally). C0 generalises that to all ~20
classification lists and makes a missing classification a build failure rather than a
behavioural test that must be remembered.
