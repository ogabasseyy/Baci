# Mobile search/category LCP: first-row loading correction

Status: local correction; no demonstrated simulated-LCP improvement. Not a
production performance claim or a sub-2.5s result. No merge/deploy authorized.

## Production evidence

PSI mobile, Lighthouse 13.5.0, 2026-10-23T10:41:05Z, production source
`094903099fecca9824ac554290dbd70bdcdd686d`:

| Route | Simulated LCP | Observed LCP | Selected element |
| --- | ---: | ---: | --- |
| `/search?q=iphone` | 5840ms | 1789ms | First-row iPhone X image |
| `/smartphones` | 4801ms | 2745ms | First-row Redmi product image |

Observed subparts (not the simulated headline's subparts):

| Route | TTFB | Load delay | Transfer | Render delay |
| --- | ---: | ---: | ---: | ---: |
| Search | 298ms | 1352ms | 78ms | 61ms |
| Category | 720ms | 1352ms | 29ms | 644ms |

Both selected images were lazy-loaded. Search's ProductIndexCard never received
a first-screen policy; category's ProductCard also used the lazy default.
This is a verified deferral defect, not proof that it explains the complete LCP.

## Change

- OgaBassey search opts its first two cards into eager/high-priority loading.
- OgaBassey category opts its first grid row (two cards), or first list card,
  into the same policy.
- Other merchants and other card callers retain lazy defaults. Remaining cards
  stay lazy. No preload, URL/quality, CSS, guard, cache or database changes.

## Verification and limits

Four component regressions failed before the implementation; page-wiring
regressions failed with the caller policy absent. All 236 affected tests pass
across 44 files. Both local production builds compile and typecheck successfully.
Biome checks the four non-excluded files; repository configuration excludes
the OgaBassey component tree. CodeRabbit was quota-blocked; the owner explicitly
waived that local review gate and requested push plus Codex review.

Nine cold full-Chrome mobile contexts (three each products/search/category),
412×823, DPR2, empty browser cache, service workers blocked, no interaction:
headings retained, no skeleton return after content, header sticky with 20px
search icon, no page exceptions or broken completed viewport images. Videos
and representative contact sheets inspected. Known local events 403 and
anonymous-cart 401 remain; no console-clean claim is made.

Lighthouse 13.5.0, same full Chrome and mobile configuration, three cold browser
samples per route/arm, simulated network, median headline LCP:

| Route | Control | Candidate | Verdict |
| --- | ---: | ---: | --- |
| Search | 8607ms | 8746ms | No demonstrated improvement |
| Category | 7685ms | 7689ms | No demonstrated improvement |

The selected candidate images are eager/high in browser and Lighthouse output.
Observed search load delays decreased in these samples, but host/server/network
variance is substantial; do not turn that into an established speed delta.
One search sample in each arm recorded CLS 0.921, attributed to the same mobile
footer SVG. This reproduces on unchanged control; it remains an unresolved
existing stability issue, not a clean no-regression clearance.

Sitespeed 42.7.0 pinned image, one native/unthrottled mobile sample per cell,
video/visual metrics/HAR retained: search 4570→1820ms; category 2610→2340ms.
These are diagnostic only: search TTFB 2580→12ms, category 1960→1490ms, and
the arms were not alternated. They do not establish a causal LCP improvement.
The candidate Docker CLI remained attached after its container disappeared;
only that owned CLI was stopped, so artifact contents, not exit success, are
the evidence. No comparison is a release-grade timing pass.

Local build IDs are identical by configuration and are not unique identities;
source-before/after SHA receipts establish each arm's source separately.
Raw private evidence is under the local CWV lab directory, dated 20261023.

## Open work

The original PSI LCP target is not resolved. Eager loading removes one gate;
streamed result availability, shared resource delivery and the category's
paint delay still require a production-matching, traced causal comparison.
The existing footer shift requires its own recorded trigger before a fix.
Do not present this PR as verified LCP improvement or production clearance.
