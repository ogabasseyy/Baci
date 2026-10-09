# Recent Actions failure investigation

## Production release fixes

- Android storefront prebuild failed twice on October 8 while loading the nested production Expo config. Expo transpiles the entry file only; imported TypeScript needs an additional loader. Expo now loads a plain CommonJS production factory; a typed compatibility entry preserves the original import path. A regression exercises the actual Expo loader under `--no-experimental-strip-types`. See [Expo configuration guidance](https://docs.expo.dev/workflow/configuration/).
- iOS archive failed when PostHog's Hermes source-map upload returned `error sending request`. Retry only that upload's transport failures, at most three attempts. Configuration, authentication, bundling, and persistent upload failures remain fatal. A successful local test is not proof of an App Store release; rerun the release workflow after merge.

## Dependency and Windows checkout fixes

- Sharp 0.35.4 includes affected librsvg. Sharp 0.35.5 bundles patched librsvg 2.63.2 for [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). Update the web manifest, transformer manifest, workspace override, and lockfile together.
- Windows cannot check out four generated documentation paths containing `*`. Rename those paths, repair parent links, and exclude the ambient CSS declaration from TypeDoc generation so the paths cannot return. Keep testing on Windows; skipping checkout or the fixture would hide the defect.

## PR failures already repaired

- Search refinements extracted cart validation helpers; the current route is below the 300-line limit. Its latest run 37886517649 exposed a stale orders-route content receipt after public offer validation changed. A separate reviewed repair refreshes that receipt and its independent expectation, with a regression proving later privileged lookup drift remains rejected. Seven focused files/161 tests pass, including live boundary and authority checks.
- Piggyvest's current branch includes `retainedWebhookSecrets: []` in the custody schema expectations; its CI run 37882795446 passed.
- Blog's current branch uses a valid unauthenticated test fixture for the tombstone refresh route; its CI run 37884103914 passed.

## Review workflow updates

Dependabot updated the security-audited Muse checkout actions without updating the reviewed anchors and mutation fixtures. Retain the reviewed Muse pins in that update PR, and exclude only that workflow from automatic action updates. Future manual updates must coordinate the workflow, auditor pins, and regression fixtures. The SARIF audit remains fail-closed.

## SEO operational follow-up

The October 8 readiness run received HTTP 402 for both public sites. This investigation cannot establish the provider's historical reason from a status code alone. Current requests to `usebaci.com`, including its monitored pages and robots.txt, return HTTP 200 with indexable metadata. No application change is justified for a historical 402 that has cleared.

`ogabassey.com` currently returns Cloudflare HTTP 403/error 1010 to this cloud executor. Diagnose the matching request in the Cloudflare security events with the site owner; determine whether verified search crawlers and the monitoring runner are affected. Do not globally disable firewall protection or spoof a browser to make the monitor pass.

An unauthenticated PageSpeed request currently returns HTTP 429/RESOURCE_EXHAUSTED. Use the workflow's configured PageSpeed API key for the next production audit. The historical SEO score 0.8 and elevated INP/TBT require a fresh successful audit before prescribing page changes. Field INP represents historical traffic, so an immediate rerun may still report an older slow period.

The monitor now reports failing weighted Lighthouse audit IDs and runtime error codes. This distinguishes blocked/non-indexable pages from actual performance regressions without changing thresholds. After merge, run SEO Monitoring and inspect those diagnostics. Do not treat a passing code test as proof that either live site meets the SEO thresholds.
