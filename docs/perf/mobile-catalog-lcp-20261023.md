# Mobile search/category LCP: first-row loading correction

Status: local corrections; preliminary lower simulated-LCP medians, not an established speed gain. Not a
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

## Continuation: traced dependencies and footer CSS race

The previous 8.6–8.7s local comparison above is withdrawn as timing evidence.
The local server supplied `NEXT_DEPLOYMENT_ID`, but this application derives it
from `BACI_NEXT_DEPLOYMENT_ID_SOURCE`. This made the local runtime request both
versioned and unversioned copies of scripts. Production PSI artifacts did not
show this duplication. The external lab wrapper was corrected; application
deployment configuration was not changed. All 12 new Lighthouse samples have
zero duplicate script paths.

The corrected baseline's Lighthouse Lantern graph was recomputed from its
trace and matched the reported simulated LCP exactly. Its critical script path
included the Supabase SDK and the standard Zod graph. The comparison-facts hook
imported the SDK and product normalizer before the user opened comparison.
Those imports now occur only inside the existing opt-in refresh, after valid
IDs are established. Unmount/abort checks also run after import resolution.
The merchant/status/ID filters and normal RLS client are unchanged. Compiled
initial script tags no longer contain the identified Supabase SDK payload.
This is not a claim that every heavy script on the route has been removed.

The persisted comparison validator now uses the installed `zod/mini` API with
the same safe-parse consumer contract. Regression cases preserve trimming,
finite/nonnegative numbers, unknown-field stripping and invalid optional-ID
fallbacks. Its standalone minified browser bundle fell from 327,958B to
16,672B (5,854B gzip); an executable 50KB budget guards this leaf module.
Search's recorded script transfer fell from 649,984B to 563,259B in these
samples. These totals include post-LCP scripts, not just the critical path.

The footer geometry defect was reproduced by delaying external CSS 2000ms:
the old footer changed from static to fixed positioning and its SVG expanded
to 1135px before settling to 65px. The existing template-specific early style
emitted header rules only. It now emits the existing combined header/footer
chrome rules. Both normal and delayed-CSS final probes kept the footer fixed
and its nonzero SVG height at 65px, with no recorded layout shifts. The probe
does **not** establish that this is the exact cause of the historical 0.921
sample: the before probe reproduced the geometry race, but not that CLS score.

Codex's tenant-scope finding is addressed: the server passes an explicit
first-row-priority opt-in based on the resolved merchant's `slug`, not the
request's route spelling. The generic category renderer defaults to false.
Regression tests cover another merchant and route/identity disagreement.

### Corrected measurements

Lighthouse 13.5.0, full Chrome 155, mobile 412×823/DPR2, default simulated
network, three fresh browser samples per arm/route. Candidate block ran first,
then the preserved pre-continuation build, using the same corrected server
wrapper. Not alternating, not quiet-host release evidence (start load1 about
8.4–19.1). Images and selected first-row elements remained intact.

| Route | Control median (range) | Candidate median (range) | CLS |
| --- | ---: | ---: | --- |
| Search | 5572ms (5425–5727) | 5137ms (5120–6073) | 0 all samples |
| Category | 5619ms (5286–5715) | 5272ms (4816–5572) | 0 all samples |

These are lower medians with overlapping ranges, not a proven causal speed
gain. One candidate search sample's observed image transfer lasted 16.44s;
it is retained and disclosed, not silently removed. Observed LCP/subparts are
stored separately from simulated headline metrics. Neither route meets 2.5s.

Final local production build exited 0 with unchanged runtime-source hashes.
The selected 41 suites / 192 tests passed, including failing-before/passing-after
regressions for tenant scope, footer geometry, deferred import and validator
footprint. Nine fresh cold mobile contexts (three each products/search/category)
recorded no interaction, no heading disappearance or skeleton return after
results, sticky header/20px search icon, and no broken completed images or
page exceptions. Known local cart 401/events 403 remain disclosed.

Private continuation evidence:
`/Users/mac/.codex/cwv-lab-builds/20261023-pr3768-continuation/`.
The baseline compiled output is preserved there; source is not reverted for
comparison. The final build is restored after measurement.

Final diagnostic Lantern graphs confirm the identified SDK path is absent.
Search's latest limiting script is the PostHog-containing chunk (248,772B raw,
75,381B gzip); category still includes a shared validator chunk and CSS.
These diagnostic captures use a supplied Puppeteer page and are not added to
the matched timing table. Do not claim the Mini leaf migration removed all
standard Zod code from the route, or that SDK deferral alone explains the
headline delta.

Read-only browser comparison activation selected two products and displayed
refreshed prices/specifications without page exceptions. Omnimart's category
and search routes returned their own merchant titles and no Oga chrome style;
these fixture responses had no selected product images, so browser evidence
does not independently prove their lazy-image policy. Colocated tenant tests
cover that policy. A stale Squishyland domain returned Store Not Found and is
excluded, not presented as merchant coverage.

Pinned Sitespeed 42.7.0 / Browsertime 28.3.0 final native mobile smoke retained
video, HAR and visual metrics: search LCP 6870ms / CLS 0, category LCP 1390ms /
CLS 0. These are unthrottled single samples, not a before/after speed verdict.
The image's banner reports Chrome 152 while its HAR identifies Chrome 151;
this provenance discrepancy is disclosed rather than conflated with full
Chrome 155 Lighthouse measurements. Contact sheets show styled content with
no skeleton return after results; the known 401/403 responses persist.

## Open work

The original PSI LCP target is not resolved. Eager loading removes one gate;
streamed result availability, shared resource delivery and the category's
paint delay still require a production-matching, traced causal comparison.
The footer geometry race is fixed; the exact historical CLS event remains
unattributed. The current measurements do not establish production p75 or a
sub-2.5s result.
Do not present this PR as verified LCP improvement or production clearance.
