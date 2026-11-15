# Ogabassey: technology within reach

## Brief

Redesign the homepage around affordable access to smartphones, laptops and gadgets: premium pre-owned devices, flexible payments, saving towards a device, repair and reduced e-waste. Both light and dark mode are required. The owner reports a current performance score of 100; a production-build comparison is a release gate, not a result inferred from this implementation.

## Research and direction

Reviewed the live homepage on 12 November 2026, the repository logo, theme and homepage delivery architecture, and these public pages:

- https://ogabassey.com/about — accessibility and affordability positioning.
- https://ogabassey.com/repairs — repair and device longevity.
- https://ogabassey.com/blog/ogabassey-improving-customer-experience — digital inclusion and the product/service range.

The homepage gave early prominence to product launches, utility purchases and sponsored placement. The redesign gives the mission and shopping priority. The visual system uses the merchant's existing red, neutral surfaces, larger typography and generous space; it inherits the existing light/dark theme tokens. No new font or animation dependency.

## Implemented homepage composition

1. Mission-led hero: “Your next chapter. Your next device.” The first published launch product remains the featured device; product names, prices and links are never invented.
2. Direct smartphone, laptop, tablet and accessory navigation.
3. Existing product grid, including its server fallback and deferred interaction logic.
4. Three ways to own: pre-owned value, 25–40% upfront with 3–6-month repayment on eligible plans, and saving towards a device.
5. A restrained “We love the environment” section, repair link and digital-receipt message.
6. Existing utility services and sponsored placement moved below the shopping and brand content.

The payment ranges and paperless receipt positioning come from the owner's brief. No interest rate, guaranteed approval, universal wallet yield or quantified environmental saving is claimed. The web wallet currently has funding/account functionality; savings marketing links there without adding or changing financial behaviour. Payment-plan help links to the existing contact page.

## Performance and integration contracts

- Existing merchant/publication checks and cache-resolution logic remain intact.
- Hero image uses the existing mobile LCP descriptor, preload path and desktop AVIF/fallback renderer. No new catalog request.
- New hero has no client state, timer, carousel or animation library.
- The streaming reserve uses the same responsive hero markup, invisibly and without product data, images, links or controls. The critical shell emits the shared stylesheet before streaming; React deduplicates its stable style resource identifier.
- Below-fold product hydration and utility activation retain their existing gates.
- Layout and palette respond to existing theme variables. The homepage does not replace the site's theme provider.
- No proxy, environment, migration, checkout or production infrastructure changes.

## Visual preview

A standalone, locally rendered preview uses the actual new hero and ownership components plus the existing static product grid with a public catalog snapshot. Its simplified navigation/footer and theme-toggle harness are for design review; they are not a full Next.js app or a reproduction of the existing authenticated header. Product and service links go to the public site. The payment-section jump stays inside the preview.

Preview: http://127.0.0.1:8774/

The local artifact includes desktop and mobile captures in light and dark mode. The preview is not evidence of production CWV, live inventory freshness, checkout qualification or savings availability.

## Release gates

Before merging/releasing, obtain an available CodeRabbit review, resolve required CI, then compare the approved production-style build against the current live baseline under matching mobile and desktop settings. Record LCP, CLS and responsiveness/TBT as well as Lighthouse scores. Exercise cold/warm cache, publication gating, empty feeds, deferred product hydration, theme switching, search, cart and real route prefixes. Do not infer production INP from a static lab preview.

Keep the owner-reported 100 baseline as the target. Do not deploy a regression. Production deployment requires the separately authorized VPS prebuilt workflow.

## Validation record

- 53 tests passed across 10 focused files: the new homepage, publication/tenant guards, recovery and settled-state paths, preload composition, stream reserve and desktop image rendering.
- Visual preview checked at 1440px desktop and 390px/320px mobile widths, in light and dark themes; no horizontal overflow at the checked narrow widths. Theme toggle and payment-section navigation exercised.
- Web-package lint passed with existing warnings. Changed-file Biome checks completed. A pre-existing array-index key warning remains in the homepage test mock.
- Web package typecheck reached TypeScript but was blocked by missing local workspace dependencies, including `@baci/experience-sdk`, `qrcode`, `pg` and `@noble/hashes` subpaths. No errors were reported in task-owned runtime files. The worktree reused installed dependencies to avoid a broad install on the shared Mac.
- CodeRabbit review was attempted but rate-limited before findings; review gate remains incomplete.
- No production build, Lighthouse comparison, merge or deployment performed. The reported 100 score has not been requalified for this redesign.

## Concept comparison refinements

Reviewed the owner's Hydrogen and Carbon concepts in their browser previews. Adopted the compact four-benefit composition and distinct, numbered payment and savings journeys. The benefits share the hero's stream-reserve markup; these additions use server-rendered markup and CSS without additional client JavaScript. Leaves remain green in light and dark themes.

Kept the owner's stated deposit and duration ranges. Did not import the concepts' conflicting interest rates, inspection counts, warranty promises or environmental totals. Lifestyle device and repair photography is a useful future direction when suitable Ogabassey assets are available.

Verified the updated preview at desktop and 390px mobile sizes in both themes. Changed-file Biome and whitespace checks passed. Focused verification was blocked by Vitest worker-start timeouts with both a single fork and a single thread, before tests executed. The new assertions remain unqualified by a completed final test run; avoid further repeated runs on the shared Mac until resource availability improves.
