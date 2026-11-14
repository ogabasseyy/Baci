# Production-build CWV preflight and release gates

2026-10-26, Africa/Lagos. Main `c2e351bec25e8ecd8dbd958a57edf5827632f663`, isolated worktree `/Users/mac/.codex/worktrees/experience-cwv/Baci-app`, branch `codex/experience-cwv-mcp`. Local uncommitted work only. **Not ready to ship; no CWV qualification.**

## Fixed during production-build verification

- The owner workspace, approval and private-preview pages awaited request data outside Suspense. New streaming regressions reproduced the failures; request-dependent content now streams behind safe shells. Existing owner/auth/approval tests remain intact.
- Consecutive failed publication admissions caused repeated automatic refreshes. Recovery now requests one refresh until a real admission succeeds, then rearms. Failed admission still withdraws access. The regression failed with three refreshes before the fix and now passes, including recovery and later withdrawal.
- Path-routed production tenant selection compared a full Referer authority with a host value that omitted its port. It now compares the exact request authority, preserving rejection of different ports, hosts and merchant paths. Two new same-authority cases failed before the fix; all five positive/negative cases pass. No auth/RLS bypass or privileged client was added.
- Current main introduced an ads migration with the same version as this branch's unpublished shipping migration. Only the new local shipping file was renumbered from `20261024160000` to `20261024160001`. Its SQL bytes are unchanged; main's migration and all committed history are untouched. Four local references and the pending-source inventory were synchronized. The durable binding migration is now registered by exact hash. Registry verification passes. No hosted migration ran.

## Production build and browser evidence

The normal optimized Next.js 16.3.8 build, TypeScript and 647-page generation completed. The trusted test launcher uses normal Baci runtime composition and normal anonymous/authenticated PostgREST/RLS against a disposable PostgreSQL 17 fixture. It compiles the client with that same live fixture's public configuration. It blocks remote server fetches, supplies no hosted/provider credentials, and does not execute merchant modules outside gVisor. Local-only startup/CSP/network adjustments live in ignored test scratch files; production proxy/environment sources are unchanged.

Build setup failures are retained outside git: missing synthetic quiz signing secret; using compile-only offline-read mode for a full build; a test port-forward collision; an orphaned test child; and inconsistent IP/localhost host identity. The launcher was corrected rather than weakening application validation. Final origin is `http://localhost:43178`, independent output on 43179. Native production tenant checks remain enabled.

Actual Chrome video/HAR diagnostics used sitespeed.io 42.7.0/Browsertime 28.3.0, pinned image digest `sha256:3b89ded94e75faf09d34a9f0921d621d470564dcee7c7f51bf2297d701451f71`. The measured HAR browser is Chrome 151.0.7922.169 (the image's startup banner reports a different installed Chrome; the actual HAR/session wins). Native connectivity/CPU, one fresh browser profile per route/profile, home only; no mobile-network qualification. Server preflight had already warmed the host.

| Profile | Orbit frame LCP from host navigation | Host CLS diagnostic | Frame CLS diagnostic | Lab event durations |
|---|---:|---:|---:|---|
| Mobile |6466.6ms|0.22725|0|16,48ms|
| Desktop |6033.8ms|0|0|40,40,40ms|

Both samples decoded both product images and exercised the custom Ink interaction. The desktop initial attempt was blocked by the local demo badge at the automatic scroll position; the retry used ordinary scrolling and a normal WebDriver click, with no forced click or DOM/style alteration. Treat the badge overlap as an authoring issue to remove before real merchant rollout.

The video is decisive: mobile still shows “Loading storefront…” at 4 seconds; Orbit appears later. Outer fallback LCP of 1.88s is not Orbit's LCP. The mobile HAR shows 4774ms waiting for the isolated index HTML, versus roughly164–186ms for each app resource. This implicates the request-time SSR/delivery critical path in this run; concurrent host load prevents a causal speed claim.

A separate Lighthouse 13.4.1 native-Chrome run completed after Browsertime. It reported outer-page LCP 1240ms, CLS 0.8214 and TBT 0. Those outer metrics do not qualify the custom frame and are not averaged with Browsertime. Its trace and report are retained, without a performance-pass claim.

All samples are **contaminated** by substantial concurrent host work. HARs also show an analytics 500 because the reduced disposable schema lacks `analytics_events`; the initial guest cart read returns 401 before a cart exists. These runs fail the clean-console/network validity gate. No full three-cold-sample/all-route matrix, warm navigation qualification, field INP, p75/CrUX, real device or release pass is claimed.

Raw videos, HARs, traces, Lighthouse HTML/JSON and failed attempts remain outside git under `.superpowers/sdd/2026-10-26-experience-cwv-production/`. The finalized mobile video is `sitespeed-smoke/mobile-home-final/pages/localhost/orbit-local-production/data/video/1.mp4` (9.23 seconds); desktop retry has the analogous path. Selected extracted frames were inspected. Attached PNGs include the benchmark's visual-metrics overlays and synthetic cookie notice; they are evidence, not a redesign.

## Validation and review

- Monorepo lint: 6 tasks passed, 12 warnings. All 8 monorepo typecheck tasks passed. Latest affected commerce/identity types and 18-file Biome check pass after runtime fixes.
- Owner-page tests: 7 files / 22 tests. Frame tests: 23 files / 40 tests. Host/identity/state-route tests: 5 files / 41 tests. These scopes overlap; do not sum them as unique tests.
- Normal-role catalog/shipping integration: 2 tests passed. Real scoped cart/response-loss replay through final checkout review and anonymous quote-attestation SQL: 2 tests passed, without orders. Provider boundaries are mocked.
- Broad monorepo test run was interrupted after an observed registry failure; it is incomplete, not a full pass. The isolated failure identified a duplicate version, then an unregistered retained-binding migration; both were corrected and the 2-test replay-registry rerun passes. A full clean final-candidate test run is still required.
- CodeRabbit completed the 14 runtime/identity files with 0 issues using its included free allowance. Exact hashes are in `source-binding.json`. The five-file migration-metadata review also completed with 0 issues on its free retry; a temporary provider identity HTTP 503 affected the first attempt. Exact hashes are in `migration-source-binding.json`. No paid fallback was used. This is scoped review, not approval of the entire inherited branch.

## Remaining release gates

1. Shorten the path to the first styled custom frame. Profile the per-request isolated-render wait and use a design that preserves fresh catalog/publication checks, full custom code and sandbox isolation. Do not hide delays behind a fast fallback score.
2. Remove the native fallback/cookie-to-frame layout shift; reserve stable space and verify actual early filmstrip frames. Remove the synthetic badge hit-target overlap.
3. Complete the synthetic production schema/telemetry fixture so normal requests succeed under normal RLS. Do not intercept failures as fake successes or use service-role credentials.
4. On an idle host, run at least 3 cold samples per desktop/mobile profile for home, collection, product and custom content, plus separate warm navigation and cart/shipping through final checkout review. No order/payment submission. Run Lighthouse separately and inspect playable video/HAR/console/images.
5. Finish a full clean candidate test run and required current-source review/CI before submission. Hosted retention/runner configuration, migration application, MCP enablement, deployment and publication require a separately authorized rollout. The local production-build harness does not enable a hosted production profile.

No publishing, hosted schema change, order creation, payment, production change or extra AI-provider cost occurred. Full Orbit custom source and the saved Ogabassey concept archive are preserved.

The disposable production-build fixture was closed after measurement; its orders-table assertion was0. Benchmark ports43178/43179 and their SSH forwards were removed. The existing development checkout/preview process was not intentionally modified or restarted. Main was fetched again at the end and still matched the worktree base.
