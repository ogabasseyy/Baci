# Orbit prerender proof — stage 1

Implemented in isolated managed worktree `/Users/mac/.codex/worktrees/experience-cwv/Baci-app`, based on current main `7f711eea1f6a27cb24005e03511b3c8b64aa9aa7` at task start. The earlier commerce preview worktree and original Orbit/Ogabassey archive were preserved. New work is local and uncommitted. No publication, hosted migration, storefront order/payment, paid AI call or paid service was performed.

## What is proved

- The compiler emits an optional React SSR bundle and a matching hydration bundle without evaluating merchant modules in the host process. Existing client-only compilation remains the default.
- Merchant SSR executes inside the existing credential-free, read-only-root, network-disabled gVisor Node profile. Build/capture deadlines, memory limits and cleanup policy were not raised or relaxed. Separate worker files avoid replacing the existing compiler/capture workers.
- Full Orbit source was prerendered for home, collection, product and editorial routes using public data read through normal anonymous Supabase/PostgREST RLS. These are disposable fixture rows, not a real publication. The fixture confirms zero orders.
- At390px and1440px the independent Linux Chromium browser context with `javaScriptEnabled:false` finds Orbit's actual heading and decoded240px synthetic images. The client-only baseline has no heading with JavaScript disabled. With JavaScript enabled, hydration becomes ready, the Ink colour control changes state, and no page errors are recorded.
- The document contains real initial content and escapes embedded public JSON; document-size and reserved-entry collisions are checked. Initial markup remains accessible without JavaScript; the client temporarily gates interactions during connection.

The parent-only JavaScript override in the in-app browser did not propagate to the frame, and its raw child-target control was unsupported. It was restored immediately and was not counted as no-JS evidence. The independent Linux test, not that incomplete UI attempt, is the successful no-JS proof.

## Checks and preserved failures

- Offline runner suite:27files,66tests passed; `/tmp/experience-cwv-runner-final.log`.
- Prerender/document integration:2files,3tests passed; `/tmp/experience-cwv-prototype-final.log`. Four real isolated renders, zero orders.
- Browser proof:1file,2tests passed; `/tmp/experience-cwv-browser-final.log`. See the JSON receipts and real no-JS screenshots here. Both runs are within the unchanged30-second per-job capture budget.
- Affected source Biome check:16files passed; `/tmp/experience-cwv-lint-green.log`.
- Runner and prototype scoped typechecks passed before the final extra browser verifier; final verifier typecheck status is recorded separately.
- CodeRabbit review of the bounded prototype diff uses only its free CLI allowance. Its base is the existing integration C1 rather than main, to keep the16-file prototype review distinct from the much larger carried integration. Exact paths/hashes are in `source-binding.json`. This is not whole-branch or release review.

The first SSR integration failed at the60-second limit. A diagnostic reproduction showed all phases through rendered and4339stdout bytes, but the one-shot process remained alive. The worker now flushes its output and exits; the unchanged integration passes. Both failures remain in `/tmp/experience-cwv-prototype-web.log` and `/tmp/experience-cwv-prototype-diagnostic.log`. Document-budget and initial-inert regressions were observed RED before their fixes; their logs are retained. The operator initially failed CommonJS top-level-await compilation and was corrected to an explicit `.mts` entry.

## Preview

Read-only prototype: http://127.0.0.1:43176/ . The Baseline link switches to the old client-rendered approach. This viewer rejects all commerce commands and is explicitly CWV-unqualified. It is a rendering experiment, not a replacement checkout or a reduced commerce adapter intended for release. The original normal-auth/RLS commerce preview remains http://127.0.0.1:43174/qa1.

The parent/frame URLs are separate loopback origins. Authenticated shopper operations are not embedded in artifacts; the test renderer reads a fresh public bootstrap only. Prototype readiness flags always remain false. Existing real commerce, auth, RLS, payment and order code was not replaced by this experiment.

## Remaining before release

1. Controlled full-storefront production-build cold mobile/desktop measurements. Host load was115 during this continuation, so these functional results are not CWV measurements. No LCP/INP/CLS pass is claimed.
2. Remove or redesign Orbit's initial hero opacity animations before final performance qualification: its current source has a0.7-second hero-copy rise and a1-second device-scene fade. Prerendering preserves those authored effects; initial HTML alone does not eliminate their visual delay.
3. Integrate versioned prerender artifacts, early frame discovery and a race-safe handshake into the actual public runtime/MCP lifecycle. Current public gateway still emits its old empty-root document; this stage does not silently change it. Independently validate untrusted HTML, cache/data freshness, revocation, rollback and hydration mismatches.
4. Qualify the outer Next streaming shell and canonical no-JS/SEO delivery, not just the isolated document. Add trustworthy host/frame performance evidence, agent feedback and release gates; runtime self-reports alone cannot authorize release.
5. Resolve remaining integration-wide tests/review and obtain exact-candidate CI/general review. Main refresh retained the current-main inventory snapshot pending regeneration from a committed candidate; dirty-source checks are not overridden.

## Reproduction order

The local gVisor Node and browser profiles must already exist. No provisioning occurs in these steps. Compile the trusted `prerender-browser-worker.ts` with esbuild as Node ESM (external `playwright-core`) and copy it to the existing browser rootfs as `prerender-browser-worker.mjs`. Copy `prerender-worker.mjs` to the existing Node rootfs. Both paths and policies are fixed in `local-oci-executor.ts`.

Use the credential-filtered `experienceReleaseEnvironment()` for test execution. First run `vitest run --config vitest.experience-performance.config.ts` from apps/web to generate current artifacts; then run `vitest run --config vitest.experience-performance-browser.config.ts`. The two phases are explicit to prevent browser tests racing artifact preparation. Finally `pnpm --dir apps/web exec tsx tests/experience-performance/serve-prototype.mts` opens only loopback listeners. Never substitute historical artifacts for current source qualification.

## Final review and checks

The complete16-file CodeRabbit review used the free CLI allowance and raised3 issues. Two Unicode chunk-decoding defects were regraded as important because they could change merchant copy and break JavaScript integrity. Both were fixed using one bounded streaming decoder. A deterministic one-byte-chunk regression reproduced the corrupted naira/Yoruba/emoji text before the fix and passes afterward. The third issue, missing spacing in the prototype startup log, is cosmetic and deferred. The16 reviewed files are bound before fixes; the final18 source files and their changed hashes are bound separately. No claim of post-fix re-review or whole-branch approval is made.

Fresh post-review verification: preparation3files/5tests passed; browser1file/2tests passed at390/1440; SDK4files/7tests passed; runner27files/66tests passed. Runner and final prototype scoped typechecks passed, including the browser verifier and decoder. Logs: `/tmp/experience-cwv-postreview-proof.log`, `/tmp/experience-cwv-sdk-tests.log`, `/tmp/experience-cwv-runner-final.log`, `/tmp/experience-cwv-typecheck-postreview.log`. Source lint passed; no budgets were raised.

Reproduction also requires copying `bounded-input.mjs` beside the standalone `prerender-worker.mjs` in the Node rootfs. The browser worker bundles the shared decoder. The ordinary default web test profile excludes these explicit local-runner tests.

The same buffer-to-string pattern also exists in legacy compile/capture test workers outside this prototype. Those were not changed or overwritten by this stage; audit/fix their Unicode boundaries before release-wide qualification. This prototype does not establish a Unicode guarantee for the earlier pipeline.

Full-monorepo, exact-candidate CI, general review, production Next build/benchmarks and actual public-runtime/MCP adoption remain separate incomplete gates. The previous broad integration diagnostic had9web test failures and is historical, not a final-source pass. No commit, push, deployment or publication was performed for this stage.
