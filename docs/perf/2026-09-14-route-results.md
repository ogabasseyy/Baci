# Local route verification — September 14

Served build: `0tn-8wpTnoTHIesepUG_o`, compiled locally with the existing public
environment loaded before compilation. No Vercel build or deployment occurred.
Source branch: `codex/homepage-visual-parity`, based on `d4876c281e` with
uncommitted visual fixes. This is not production/CrUX evidence.

## Lighthouse

Lighthouse 13.4.1, Chrome 152.0.7977.84, DevTools applied throttling, three
browser-cold samples per route/profile. These are not server-cache resets.
Reports: `/Users/mac/.codex/cwv-lab-builds/20260912/results/routes-route-fixes-final-*.json`.

| Route | Mobile score range | Mobile median LCP | Desktop score range | Desktop median LCP |
| --- | --- | --- | --- | --- |
| Home | 95–96 | 2.347 s | 99–100 | 0.446 s |
| Compare | 98–99 | 1.772 s | 99–100 | 0.226 s |
| Category compare | 98–99 | 2.094 s | 99 | 0.897 s |
| Cart | 77 | 5.227 s | 100 | 0.456 s |
| Article | 99 | 1.568 s | 99–100 | 0.408 s |

CLS was zero in all 30 samples. Cart mobile does not meet the LCP target:
its empty-state description is delayed behind persisted-cart hydration.
The hydration guard must not be removed merely to improve a score, since that
would show a false empty cart before saved items load. No cart runtime code was
changed in this iteration. A comparable pre-change cart measurement is missing.

## Video and observed correctness

Thirty Sitespeed.io 42.7.0/Browsertime 28.3.0 runs are stored under
`/Users/mac/.codex/cwv-lab-builds/20260912/results/sitespeed/route-fixes-after-20260914`.
Their HAR browser is Chrome 151.0.7922.169. They use native connectivity, not
Lighthouse's throttling, so their timings must not be compared directly.

- Previously unstyled `/compare` now has an eager route stylesheet.
- Both comparison surfaces are readable after explicit surface/fallback fixes.
- Cart now renders its normal empty state after correcting the local build
  environment; the prior application error was not a cart-code defect.
- Article images render in inspected mobile and desktop captures.
- Inspected homepage frames no longer expose the previous black main surface;
  blank loading frames still exist. Final screenshots alone do not prove every
  intermediate frame is correct.

## Unfinished release evidence

The Docker HTTP hostname caused `crypto.randomUUID` secure-context errors in
30/30 console logs. Vercel insights also attempted local-only unavailable
endpoints. These runs are not console-clean. A localhost/HTTPS lab rerun is
required, without changing production security to suppress test errors.
The normal local server additionally lacks the analytics signing configuration
`SUPABASE_AGENTIC_JWT_PRIVATE_JWK`; this is a separate environment blocker.

Full final route coverage, Firefox/WebKit, warm navigation, comparable baseline
performance attribution, and final repository/review gates remain incomplete.
Do not label the whole storefront fixed or production CWV improved from this
table. Keep a PR draft until its stated acceptance gates are actually met.
