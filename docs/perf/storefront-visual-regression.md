# Storefront visual and performance verification

Use this workflow for storefront CSS, shared layouts, loading fallbacks,
hydration, hero images, resource hints and animation changes. A high Lighthouse
score does not prove a visually correct page. This is a performance workflow,
not a substitute for SEO indexing or structured-data checks.

## Tools and safety

- sitespeed.io 42.7.0 orchestrates Browsertime, Coach and PageXray.
- Enable video and visual metrics; inspect the video, not just sparse thumbnails.
- Run Lighthouse 13.4.1 separately after Browsertime, never concurrently.
- Keep before/after browser version, viewport, CPU/network profile and cache
  state identical. Record exact commit and dirty state. Do not average scores
  across tools or compare desktop numbers directly against mobile numbers.
- Run a build-time public-environment preflight: values such as
  `NEXT_PUBLIC_SUPABASE_URL` must be present in the compiled client bundle;
  runtime-only availability is insufficient. Never print environment values.
- Use a local production build. Never run `vercel build` or trigger a cloud
  deployment for experiments. PSI cannot access localhost.
- Check free disk before installing images or recording. Reserve at least
  10 GiB for the batch; stop if space falls below 5 GiB. These are lab safety
  margins, not vendor requirements. Never delete unrelated data to proceed.
- Do not stop other agents' processes. If the host is busy, label measurements
  contaminated and repeat on an idle host before making a causal speed claim.
- Keep videos/HAR/traces outside git. HAR and console logs may contain sensitive
  data; redact before uploading and never include authenticated sessions.

## Coverage

Use `apps/web/tools/perf/storefront-route-matrix.json`. Resolve current real
product/article URLs before a run; a 404 is not a valid substitute. Test every
listed public route family on mobile and desktop, with three cold samples per
profile. Also test in-app navigation and a warm reload, recorded separately.
Add affected families when a PR changes another shared layout. Do not purchase,
submit repairs, fund wallets or mutate customer state during performance tests.

## First validate one run

Docker on macOS reaches the host through `host.docker.internal`, not its own
localhost. Verify the local proxy resolves the intended merchant and returns
the expected page before a batch. No production credentials belong in Docker.

Example smoke run (native connectivity, NOT a mobile performance baseline):

```sh
docker run --rm --shm-size=2g \
  -v "$PWD/output/sitespeed:/sitespeed.io" \
  sitespeedio/sitespeed.io:42.7.0@sha256:3b89ded94e75faf09d34a9f0921d621d470564dcee7c7f51bf2297d701451f71 \
  http://host.docker.internal:3105/ \
  -b chrome -n 1 --video --visualMetrics
```

Confirm an actual playable video, visual metrics and HAR exist before expanding
coverage. Pin the resolved image digest and record actual browser/tool versions.
Select and verify one throttling engine; do not stack OS and DevTools throttles.
Do not use the `plus1` image's automatic remote PSI integration for localhost.

## Diagnose, fix, repeat

1. Record console errors, failed requests, status/MIME, decoded image dimensions,
   LCP element and LCP breakdown; inspect first paint through settled content.
2. Look for unstyled links, black/white flashes, disappearing fallback content,
   invisible theme text, image gaps and shifts on hydration or interaction.
3. Reject broken-image, wrong-route, navigation-error, console-error,
   application-error/empty-state and missing-metric runs, even when HTTP and
   performance metrics pass.
   `assert-lighthouse-report.mjs` checks the report validity subset automatically.
4. Reproduce the issue against current code. Add the narrow regression test,
   fix the cause, then repeat the same route/profile and adjacent route families.
5. Compare medians and ranges, HAR request changes and video. Keep absolute
   targets (LCP <=2.5s, CLS <=0.1) distinct from observed relative changes.
   TBT is not INP; navigation-only lab runs do not prove interaction performance.

## Known local traps

- CDN cold image requests with a localhost Referer can return 403 HTML and
  Chrome ORB errors. Capture the failed response. On 2026-09-13, the same URL
  returned 200 AVIF with a production referrer or no referrer. A localhost-only
  proxy `Referrer-Policy: no-referrer` solved that lab mismatch. Do not weaken
  production CDN policy or claim this made production faster.
- A CSS preload warning can come from another route's prefetch. Trace the
  initiator; do not eagerly load all CSS just to silence the warning.
- A speculation script existing in the DOM does not prove registration. Verify
  Chrome's Preload ruleset events. Streamed insertion may be ignored.
- Missing local signing keys can cause analytics 500s. Record the configuration
  blocker; do not disable authentication or fabricate a successful endpoint.

## Release gate and future automation

The resumable runner can be previewed without Docker, then run against a served
build identity (the identity is required so artifacts are never confused with
another deployment):

```sh
pnpm --dir apps/web exec node tools/perf/run-storefront-sitespeed.mjs --dry-run --profile mobile --family home --samples 1
pnpm --dir apps/web exec node tools/perf/run-storefront-sitespeed.mjs --build-id <served-build-id> --profile mobile --family home --samples 1 --max-runs 1 --min-free-gib 5
```

The 5 GiB setting is an explicit bounded-batch exception; the runner always
stops at the hard 5 GiB floor. Native profiles do not claim mobile network
throttling. Record actual browser versions from the HAR and runner output.

Attach a table of route/profile medians, ranges, exact versions and evidence
paths to the PR. Mark visual review separately from metric validity. Do not
mark ready while failures are unexplained. Local checks, CI, merge, deployment
and production/CrUX verification are separate gates.

The validity checker has deterministic unit tests and can run on saved reports
in CI. Full video CI is not enabled by this guide: first validate the runner,
stable data fixtures and artifact privacy, then add a dedicated opt-in job.
Never make a network-dependent score threshold a silent required merge gate.

References: https://www.sitespeed.io/documentation/sitespeed.io/video/,
https://www.sitespeed.io/documentation/sitespeed.io/docker/,
https://www.sitespeed.io/documentation/sitespeed.io/best-practice/.
