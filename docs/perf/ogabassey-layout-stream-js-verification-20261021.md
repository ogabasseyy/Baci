# OgaBassey layout and deferred JavaScript review status

## Scope correction (2026-10-22)

This draft retains the catalog/ad-frame layout repairs, the streamed main-region
minimum height, and the bounded BlogSnippet SDK deferral. It does not fix the
streamed hero or establish a production LCP improvement. Nothing was deployed.

The initial sibling canonical homepage route is withdrawn. Although its hero
appeared in visible initial HTML, it bypassed the persistent [slug] layout.
Client-side navigation alone did not prove provider identity preservation.
Restoring the original route also restores its development preview and
pre-hydration dark-canvas behavior. No authorization or boundary gate is relaxed.

The main minimum height now preserves the mobile header offset
(calc(100svh - 132px)) and uses a full viewport on desktop. The previous inline
100svh override was incorrect for short mobile pages.

The final reservation lives in shared route CSS, not Tailwind utility names:
browser inspection proved those utilities were not emitted on blog/PDP.
The repaired built pages compute 691px on an 823px mobile viewport and 940px
on a 940px desktop viewport, on home/blog/PDP, with no inline override.
The CSS regression failed before the rule and passes after it.

Corrected runtime source: 11f74c506ac08e56c9f3c8edcccc0e4d11059882.
The inventory was regenerated from that exact commit because removing the
canonical shortcut changes the route input set. It has 584 rows and SHA-256
b10bfe508b24b5d5f81c2d2030ac4dece881140b17bcb5dfd5ef741db63b4924.

## Retained changes

- Keep independently streamed catalog links after the primary products.
- Give the ad frame itself stable responsive geometry, mirrored in critical CSS.
- Reserve the main region so a streamed response cannot initially place the
  footer in the content area.
- Delay BlogSnippet's Supabase SDK import until the existing bounded LCP or
  interaction signal, and cancel work after navigation.

Blog/PDP initial head-script totals were unchanged in the earlier build.
The SDK change is a deferral contract, not a demonstrated initial-byte saving.

## Evidence and limits

Earlier local correctness captures covered 150 route/profile visits, six
Browsertime videos and six Lighthouse reports. They belong to the superseded
initial source, not to this corrected draft. Their catalog/ad observations
supported the retained repairs: desktop products CLS 0.300619 to 0, and search
0.068594-0.136634 to 0.000554. These are not production or field-p75 claims.
Final-source browser verification is recorded separately below; it does not
establish production performance or resolve the disclosed baseline errors.

Final-source matrix: 25 route families x two viewports x three cold contexts =
150 visits with Chrome 149.0.7827.22. Maximum session CLS was 0.002067745;
zero broken visible images; desktop products and search each recorded CLS 0
in all three samples. Six rewards visits still render the baseline auth error
(React 419); they are not functional passes. The old contact int64 occurrence
did not recur, which does not establish its cause or clearance.

Six separate Sitespeed 42.7.0 / Chrome 151.0.7922.169 recordings cover
home/blog/PDP on mobile and desktop. All report CLS 0. Reviewed contact sheets
show styled content staying present after paint, with reserved image geometry
and no observed footer flash. All six retain cart401/events403 and console
warnings; these are diagnostic layout captures, not clean performance reports.
The native matrix and part of the video collection overlapped; timing and speed
comparisons are explicitly withheld. Lighthouse was run separately afterward.
All six Lighthouse 13.4.1 reports also recorded CLS 0, without runtime errors.
Their timing/scores are not comparative evidence and are not used as speed claims.

Private final-source evidence uses the r1-final- prefix under the evidence root
/Users/mac/.codex/cwv-lab-builds/20261021-live-psi. The earlier r1-withdrawal-
matrix stopped after a missing-utility CSS defect was found; it is superseded,
not merged into final-source results. The corrected main-height probe is bound
to the final build. Browser artifacts are not committed or uploaded raw.

The original current-head CI exposed a credential-boundary path through the
new sibling route. That route is removed rather than allowlisted.

The corrected production build, TypeScript check and web lint pass. The live
event-boundary test passes with no new exception. Focused layout/SDK tests pass
(39), restored-home/Hero tests pass (59), and the final CSS parity/budget suites
pass (10). These sets overlap and must not be summed. The inventory test is
rerun separately after regeneration. Both correction reviews completed with
zero CodeRabbit issues. Home-blog-home preserves one active shared shell.

Known separate issues remain: rewards' missing CustomerAuthProvider, lab events
403 / anonymous cart 401, and one unattributed contact int64 error. Earlier
shaped navigation failures and busy-host timing results are not speed evidence.

## Streamed hero: unresolved

Keeping the persistent shared layout in subsequent structural builds still
placed the hero in hidden streamed sections. The cached-output trial's first
title was at byte 43,266 under S:4. It failed the visible-initial-HTML criterion.
Those trial changes are withdrawn; tests and successful builds do not override
this failed structural check. No React scheduler, guard, or proxy workaround
is included.

The next streaming investigation must address the shared layout's request-time
boundary while preserving tenant/publication checks, persistent providers and
generic-store PPR behavior. Protected proxy changes require explicit approval.
No sub-2.5s, field improvement, merge or deployment claim is made.

## Review follow-up: initial mobile listing reserve (2026-10-22)

Codex's ready-for-review pass identified a delivery gap in the retained reserve:
products/search/category can reach storefront-core.css through the deferred full
style loader. Testing a settled page or parsing that stylesheet did not prove
the reserve existed during the initial streamed state. The earlier all-route
reservation claim must be read with this correction.

StorefrontLcpCopyStyle now includes the small responsive main-height rule in its
existing inline, high-precedence shell resource, outside the tenant-resolution
Suspense boundary. It retains calc(100svh - 132px) on mobile and100svh on desktop.
The full stylesheet's delivery, guards, hero routing and image quality are
unchanged. The initial-style regression test failed before this change and passes
after it; it inspects the component's delivered CSS, not storefront-core.css.

A local production build and foreground Chrome155.0.8059.86 browser checks covered:

- Three cold mobile contexts each for `/products`, `/search?q=iphone` and
  `/smartphones` (9 visits, 412x823, DPR2). Every visit had 691px from the first
  observed visible main frame, with the reserve present in the inline resource.
- One cold desktop context per listing route (3 visits, 1350x940), with 940px from
  the first observed visible main frame.
- One cold mobile context each for home, blog and
  `/smartphones/iphone-11-pro-max` (3 adjacent-route visits), with 691px reserved.

All 15 visits returned 200, recorded zero pointer/touch/key input and
`navigator.userActivation.hasBeenActive === false`, and were foreground-visible.
Each context had browser cache disabled and service workers blocked. Probe reads
used CDP Runtime.evaluate with userGesture:false: ordinary automation evaluation
had activated a discarded preliminary capture and could load deferred styles.
React merges the inline resource into a data-href token list, which the corrected
probe checks. Earlier predicate-only failures are not application failures.

The pre-change cold search diagnostic caught min-height 0px at its first visible
frame, later changing to 691px without input. Full core styles did ultimately
load in the diagnostic browser paths; the fix does not depend on exactly which
other path caused that later load. A raw served response independently places
the reserve in the head's inline style resource, before body/main parsing.

Three mobile videos and their contact sheets cover initial paint through the
bounded capture. Product-image loading and some existing style settling remain;
this is not a blanket no-flash or full-session CWV clearance. The known anonymous
cart401/events403 remain, so these are targeted geometry checks, not clean
performance passes. No LCP or comparative speed claim is made.

Validation: 31 focused tests across 8 suites (including 2 inventory snapshot
tests), local production build and app typecheck pass. App lint passes with 6 existing warnings;
touched files are Biome-clean. The route inventory's authority inputs did not
change and its snapshot was not re-pinned. Private evidence, harness source,
recordings and source receipt are under
`/Users/mac/.codex/cwv-lab-builds/20261021-live-psi/r2-reserve/`.

CodeRabbit completed with 2 trivial test issues, both addressed: scope CSSOM
assertions to the delivered component resource and narrow rule types without
casts. No critical/high issue was reported. This local review does not replace
the required fresh current-head Codex review after pushing.
