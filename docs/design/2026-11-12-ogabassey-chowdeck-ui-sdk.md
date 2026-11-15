# Ogabassey: Chowdeck-inspired UI SDK iteration

This iteration supersedes the earlier neutral visual treatment, keeping its published-catalog integration and ownership messaging. It is local, uncommitted work, not a production deployment.

## Direction and research

The owner requested Chowdeck's personality and an evaluation of Vercel's newly released UI SDK. Reviewed [Chowdeck](https://chowdeck.com/) in the browser: oversized friendly typography, warm backgrounds, rounded controls, illustrated scenes and distinct coloured sections. The redesign uses those compositional ideas with Ogabassey's red identity, original CSS device illustration, an actual published hero product and green leaves. No Chowdeck source code, artwork or text was copied.

[Vercel UI SDK](https://github.com/vercel-labs/ui) is a headless behaviour library, not a visual theme. Read its [skill](https://github.com/vercel-labs/ui/blob/main/packages/core/skills/ui-sdk/SKILL.md), build-interface, agent-ready and testing references, plus the installed React package's index and Dialog documentation. Pinned `@ui-sdk/core` and `@ui-sdk/react` to `0.1.0-beta.1`. Added exact-version release-age exceptions for these two owner-requested beta packages; the general dependency cooldown is unchanged.

## Implementation

- Centred mission headline, warm hero, CSS laptop illustration and value badge; decorative art is hidden from assistive technology and omitted visually on small screens.
- Coloured category cards and ownership panels, a dark green repair section, digital-receipt message and theme-aware text contrast. Existing theme controls and fonts remain owned by the existing storefront.
- An on-demand comparison dialog uses the actual UI SDK Dialog, Title, Description and Close parts. Opening, closing, focus containment and focus restoration are provided by the SDK. The launcher reports loading or chunk failure; the ordinary ownership links remain available.
- The SDK module is imported only inside the comparison click handler. No SDK runtime import is present in the hero, stream reserve or server-rendered product grid. The comparison gate adds a small client boundary below the ownership cards.
- Hero CSS is shared with its stream reserve; below-fold ownership CSS is emitted with its section. No video, animation library, additional font or data query was introduced.

## SEO and performance boundaries

Existing canonical URLs, metadata, robots decisions, JSON-LD, publication guards and product URLs are unchanged. The hero honours an upstream document heading instead of inserting a second H1. Published product content, category navigation and ownership information remain in server HTML. The dialog repeats helpful information; it does not hide the only copy from crawlers or no-JavaScript readers.

A small esbuild diagnostic, excluding shared React and Next modules, produced a roughly 1 KiB gzip initial comparison gate including its helper chunk. SDK code appeared only in dynamic chunks (approximately 32 KiB gzip to open the dialog, with optional sheet/announcement chunks separate). This is evidence of code splitting, not a Next production bundle measurement or an INP result.

The original production-performance release gate remains: compare a configured production build with live baseline using matching browser, viewport, network, CPU and cache settings; inspect images/video, LCP and CLS, and exercise interaction responsiveness. The owner's reported 100 score is still the target, not a verified outcome of this iteration. No Lighthouse, production build, merge or deployment was performed. Host load was high during this session, so speed claims would not be defensible.

## Verification

- 59 focused tests passed across 13 files in bounded runs: 10 homepage/reserve tests; 2 SDK dialog/loading/agent tests; 1 failed-chunk test; 46 metadata, SEO-indexing, committed-LCP, structured-head, publication, preload, recovery and homepage integration tests.
- The SDK tests initially exposed missing jsdom browser stubs (`CSS.supports` and visible popovers), which were added locally to the test file. These are testing-environment gaps, not production failures. Browser checks separately confirmed modal naming, Enter activation, Tab/Shift+Tab containment, Escape, both close buttons and returning focus to the launcher.
- Browser preview reviewed at realized desktop width 1063px (the in-app browser capped the requested 1440px), plus 390px and 320px mobile. Both themes and mobile anchor navigation checked; no horizontal overflow at the checked mobile widths.
- Measured light-theme contrast: red hero headline 6.59:1, hero body 9.34:1, green-panel body 8.77:1. Dark-theme headline 3.90:1 meets the large-text threshold; hero body is 9.32:1. This is a targeted contrast check, not a full WCAG audit.
- Changed-file Biome and whitespace checks passed. Web-package lint exited 0 with 18 existing warnings.
- Web-package typecheck exited 1 because the local checkout cannot resolve `@baci/experience-sdk` in `experience-preview-dispatch.ts`. No task-owned file was reported. Remaining chained tool typechecks did not run after that failure.
- Frozen, lockfile-only filtered install validation exited 0. Dependency lock changes contain only the two SDK packages and their existing peer references.
- CodeRabbit review was attempted for the final uncommitted changes and exited 1 before findings: all included reviews used and no assigned organisation seat. The review gate remains incomplete.

The static preview renders the new source components and hydrates the real comparison launcher. Header/footer are simplified preview scaffolding; public catalog entries are snapshots. A preview-only `no-referrer` meta tag resolves the documented localhost CDN image issue; production referrer policy was not changed. This preview is not evidence that the full Next app or production CWV passed.

## Remaining release gates

Resolve the local workspace dependency or validate typechecking in CI. Obtain the required available CodeRabbit review and full required CI for dependency changes. Complete production-style performance comparison before merge/release. None of those outcomes should be inferred from the design preview.

## Hero search placement experiments

Added opt-in above-description and below-description hero search variants. Both use a native GET form to the existing merchant search route, with a labelled required query field and existing 200-character limit. No client JavaScript is added for search. Preview headers give IMEI Checker, Repairs, Swap / Trade-in, Wallet and Blog the freed space; production navbar integration is pending visual selection. Default Hero behavior remains unchanged unless a placement is supplied.

Six focused experiment tests pass; the preceding hero/reserve run passed 16 tests across three files. Biome passed after replacing the form search role with the native search element. Browser search for iphone 13 reached real catalog results. Both placements fit a 390px viewport without page overflow; light/dark search styling was checked. Preview comparisons are not production CWV or SEO measurements.

## Selected direction — 2026-11-14

Owner selected B: search below the introduction. Hero now defaults to below-description, including matching inert reserve geometry. The main preview index uses B without the experiment switcher; A and B comparison URLs remain available. Production navbar integration and deployment remain outstanding.

Review integration inspection: merchant Settings → Trust already exposes a Google Place ID and Google reviews enable switch. The shared Google Places adapter and public reviews endpoint exist; no customer-facing Google review section or Business Profile OAuth review-sync implementation was found in this checkout. Confirm the owner’s truncated feed request before expanding that integration.

## Google review production repair — 2026-11-14

Authorized by owner to fix the production endpoint. The dedicated Baci-Vercel-Places-Legacy-Autocomplete key in project ogabassey-easybuy-gadgets allowed only places-backend.googleapis.com. Preserved that target and added places.googleapis.com. Production /api/google-places/reviews returned HTTP 200, business OgaBassey Phones Store, rating 4.6, count 269, five reviews, relevance sort. No Vercel environment variables, source, deployment or homepage release changed for this repair.

Recency follow-up: corrected earlier statement that newest-first always requires Business Profile OAuth. Existing legacy Place Details access supports reviews_sort=newest. The local preview server now uses that mode and labels it Newest first; the returned feed starts with two five-star reviews labelled two months ago. Production remains relevance-sorted. Preview retrieves fresh data server-side with no-store, never exposes the credential, and preserves returned review order including lower ratings.
