# Middleware Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the proxy auditable and reduce duplicate concurrent public preflight work without changing storefront or security behavior.

**Architecture:** Extract existing helpers by responsibility, then replace the long proxy body with ordered routing stages. Add bounded single-flight at the existing RPC transport boundary. Keep the legacy regression suite as a parity check and add small focused tests.

**Tech Stack:** Next.js 16.3.4, TypeScript, pnpm 11.7, Vitest, Biome, existing OpenTelemetry and SingleFlight.

**Spec:** `docs/superpowers/specs/2026-09-12-middleware-modularization.md`

## Global Constraints

- Work only in `/Users/mac/Baci-app/.worktrees/middleware-modularization-20260912`; preserve the dirty root checkout.
- The user explicitly authorized this proxy refactor and Terra implementation. Do not modify `.env*`, business types, old migrations, provider settings, or production data.
- Preserve routing precedence, status codes, query handling, request bodies, trusted merchant headers, metadata partitioning, cache isolation, auth, CSRF, rate limiting, and CSP nonces.
- Unknown/unavailable verdicts remain fail-open. Keep `durablePdpPurge: false` and current TTLs.
- Keep `config.matcher` statically analyzable in `src/proxy.ts`. Use focused direct-import modules, aiming for at most 300 lines; do not hide the monolith in another file.
- No new dependencies, service-role calls, or changes to comparison eligibility. Use apply_patch, pnpm, and Biome. Never run `vercel build` or deploy.
- Agents are not alone: edit only task-owned files, never revert others, and do not spawn subagents. Parent owns coordination, inventory integration, and final validation. Leave changes uncommitted for parent review and final CodeRabbit/repository gates; report exact test evidence.

### Task 1: Extract request, response, and preflight helpers

**Files:** Modify `apps/web/src/proxy.ts`; create focused modules in `apps/web/src/lib/proxy/`: `host.ts`, `path-normalization.ts`, `routing-policy.ts`, `request-classification.ts`, `public-cache-policy.ts`, `public-cache-eligibility.ts`, `request-headers.ts`, `response-headers.ts`, `csp.ts`, `api-alias.ts`, `machine-responses.ts`, `terms-redirects.ts`, `retired-slug.ts`, `preflight-common.ts`, `pdp-preflight.ts`, `blog-preflight.ts`, and `compare-preflight.ts`. Add colocated tests if helper behavior changes; no intended behavior changes in this task.

**Interfaces:** Preserve the existing function names and signatures while exporting only cross-module consumers. `proxy.ts` continues to export `proxy(request: NextRequest)` and `config`; its main body stays in place for this task. No extracted module imports the proxy entrypoint. `applySecurityHeaders` remains the shared response decorator, including cache selection. Preserve the compare resolver's single module-level instance.

- [ ] Capture the current focused proxy baseline, then extract the existing declarations before `proxy()` and `applySecurityHeaders` after it. Group private constants with their primary consumer. Split the listed modules further by named responsibility only if a coherent group would exceed the size target; report the resulting map.
- [ ] Keep the extraction mechanical: same conditions, branch order, return values, and timeout/error behavior. Use direct named imports, for example:

```ts
import { applySecurityHeaders } from '@/lib/proxy/response-headers';
import { resolveStorefrontPdpHardNotFound } from '@/lib/proxy/pdp-preflight';
```

- [ ] Run `pnpm --filter @baci/web exec vitest run src/proxy.test.ts src/proxy-compare-page.test.ts src/proxy-pdp-cache.test.ts --maxWorkers=2`. Expected: all existing cases pass unchanged.
- [ ] Run focused Biome checks and TypeScript; report baseline failures separately. Self-review imports for cycles and report moved functions, module sizes, and test results. Do not commit.

### Task 2: Extract ordered routing stages and fix merchant trace coverage

**Files:** Modify `apps/web/src/proxy.ts` and Task 1 modules only as needed for imports; create `apps/web/src/lib/proxy/api-security.ts`, `session-routing.ts`, `legacy-routing.ts`, `platform-routing.ts`, `custom-domain-context.ts`, `custom-domain-routing.ts`, `custom-domain-alias-routing.ts`, `subdomain-routing.ts`, `slug-routing.ts`, `storefront-preflight.ts`, `merchant-tracing.ts`; create `apps/web/src/proxy-routing.test.ts` and `apps/web/src/proxy-matcher.test.ts`.

**Interfaces:** Each ordered stage returns `NextResponse | null` (or a typed resolution carrying only required routing state). Preserve early-return ordering. Host handlers consume the same request plus resolved hostname/merchant state as the current branches. The shared document preflight must retain this exact sequence: blog post, blog listing, compare page, PDP canonical, then PDP membership only when canonical resolution did not suppress it. Helper:

```ts
export function annotateMerchantTrace(slug: string | null, domain: string): void;
```

- [ ] Add a regression for the missing custom-domain annotation by mocking `trace.getActiveSpan()` and routing `https://ogabassey.com/phones/example-product` with the established public dependency mocks. Assert `merchant.slug` is `ogabassey` and `merchant.domain` is `ogabassey.com`; run it before fixing to record RED. Also test subdomains and absent active spans.
- [ ] Extract the current proxy body into ordered stages, with `proxy.ts` as a readable coordinator and the unchanged literal matcher. Keep nonce generation and forwarding aligned on the same request. Do not reorder network reads before cheap guards or weaken alias checks.
- [ ] Replace the three duplicated public-document preflight chains with one shared function preserving their existing host-specific parameters and redirect precedence. Move merchant tracing to the resolved-host paths before their returns, without a new lookup.
- [ ] Use Next's installed `unstable_doesProxyMatch` against the full config, not individual regexes. Test excluded `/_next/static/a.js`, `/_next/image`, `/fonts/inter-naira.woff2`; included canonical PDP, dashboard/API, merchant favicon and sitemap, agent routes, and telemetry relay. Keep prefetch tenant routing intact.
- [ ] Run all proxy tests with `pnpm --filter @baci/web exec vitest run src/proxy --maxWorkers=2`, and focused Biome/typecheck. Review output URL, status, merchant request headers, CSP and CDN headers for all three host shapes using existing regression cases. Report resulting module map/sizes and exact RED/GREEN evidence; do not commit.

### Task 3: Coalesce identical in-flight verdict reads

**Files:** Modify `apps/web/src/lib/storefront-preflight-rpc.ts`; create `apps/web/src/lib/storefront-preflight-rpc-flight.ts` if needed for transport-local keying; create `apps/web/src/lib/storefront-preflight-rpc-concurrency.test.ts`. Reuse `apps/web/src/lib/single-flight.ts` without broad changes.

**Interfaces:** Keep `callStorefrontPreflightRpc(fn, args, options): Promise<unknown | null>` and the existing memo API. Put the shared operation around the existing timeout/RPC/result-classification/memo/breaker work so the owner records one success/failure and all waiters receive the same outcome. Do not retain settled promises. Different transport implementations, timeout budgets, deployment environments, argument sets, functions, or empty-result semantics must not share a flight. Keep the bounded tracking behavior of SingleFlight.

- [ ] Write deterministic deferred-promise tests (no sleeps). Ten overlapping equal calls should start one RPC and return equal results; after settlement and memo expiration a fresh call must start a new RPC. Capture the failing call count before implementation:

```ts
const requests = Array.from({ length: 10 }, () =>
  callStorefrontPreflightRpc(fn, args, options)
);
await Promise.resolve();
expect(rpcImpl).toHaveBeenCalledTimes(1);
release({ data: [{ kind: 'present-or-unknown' }], error: null });
expect(await Promise.all(requests)).toHaveLength(10);
```

- [ ] Test different tenant arguments, RPC names, implementations, timeouts and empty-result semantics independently; production versus preview must remain isolated. Snapshot the string-valued arguments before deferred execution, and test that mutating the caller's argument object before the RPC starts cannot make the payload diverge from its flight key. Test rejection/timeout fail-open, retry after settlement, and one breaker/telemetry update per actual RPC attempt. Use `vi.resetModules`/fake timers consistent with existing transport tests.
- [ ] Implement compatible-flight sharing using the existing `SingleFlight<unknown | null>`, with stable sorted argument keys from the current memo key and explicit compatibility fields. Keep failure returns null and never create an authoritative negative from an unknown response.
- [ ] Run `pnpm --filter @baci/web exec vitest run src/lib/storefront-preflight-rpc src/lib/single-flight --maxWorkers=2`; report before/after RPC count and the exact scope of the saving. Self-review and leave changes uncommitted.

### Task 4: Refresh routing evidence and complete integration gates

**Owner-approved extension, 2026-09-26:** Replace the legacy domain-cache admin fallback with two narrowly scoped public scalar RPCs before accepting the extracted import boundary. Preserve active-domain selection in both directions, including the lone non-primary custom/purchased-domain fallback. Distinguish authoritative absence from unavailable reads; only authoritative absence may populate the negative cache. Add an append-only, privilege-restricted migration and deterministic client/cache tests, plus local PostgreSQL role/selection checks. Do not renew expired authority exceptions, broaden table grants/RLS, or apply migrations remotely. Local fixture validation is not a production migration replay or deployment.

**Files:** `apps/web/tools/cost/storefront-edge-inventory-routing-input-paths.ts` and its tests; `docs/superpowers/evidence/storefront-edge/task-1a-inventory.json`; corresponding generated digest assertion in `apps/web/tools/cost/validate-storefront-edge-inventory.test.ts`; `docs/superpowers/evidence/2026-09-12-middleware-modularization.md`.

**Interfaces:** The inventory must include every extracted runtime proxy module. Existing source-byte, route-tree, and ancestry validation stays enforced. This task consumes the final file map from Tasks 1–3 and all their reviewed test reports.

- [ ] Update the inventory input list and add a regression that every runtime module under `src/lib/proxy/` is included, excluding tests. Preserve drift rejection coverage.
- [ ] Under the superseding 2026-09-26 validation instructions, run `pnpm turbo lint typecheck --filter=@baci/web` and relevant proxy, preflight and inventory integrations; use the full web test task if impact remains uncertain. Broaden to the monorepo only if shared runtime/build/dependency changes arise. Retain focused and broad outcomes separately. Run `coderabbit review --agent -t uncommitted`; address valid important findings. An unavailable reviewer remains an explicit submission gate.
- [ ] Once source is reviewed, commit only task-owned source changes, then regenerate inventory against that real source commit with the existing CLI and update its asserted digest. Never fake ancestry, remove the guard, or claim a squash-merged branch-only authority remains reachable. Record any remaining release constraint.
- [ ] Re-run inventory regressions after regeneration and the focused tests affected by any review fix. Obtain whole-change review. Write evidence listing module sizes, checks, baseline failures, review/deploy status and cost limits.
- [ ] Report measured deterministic work reduction: ten identical concurrent preflights start one RPC instead of ten, a 90% reduction for that burst on one instance. Explicitly state inbound middleware invocations are unchanged and production dollar savings are unmeasured. Do not merge or deploy.
