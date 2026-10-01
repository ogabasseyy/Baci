# Middleware modularization and request-work reduction

## Goal

Turn the oversized web proxy into a readable routing coordinator while preserving its security, tenant isolation, redirects, and degraded-data behavior. Reduce duplicate in-flight public verdict RPCs separately from the structural changes.

## Behavior contract

### Explicit coordinator approval

On 2026-09-27, the owner explicitly answered “Yes, approve the existing
proxy.ts refactor” for PR #3513, reviewed head
`9415d87846f7449d0b0579055b0f6b8c2e86d071`. This covers the existing
`apps/web/src/proxy.ts` coordinator refactor with auth, CSRF, rate limiting,
and domain-routing behavior preserved. It does not authorize merging,
deployment, or subsequent security-policy changes.

### Storefront CSP exception and migration tracking

The storefront `script-src` in `apps/web/src/lib/proxy/csp.ts` retains
`'unsafe-inline'` as an existing compatibility exception, not a claim that
inline scripts are safe. Admin/auth routes keep their per-request nonces.
This refactor must not expand the exception or its external source allowlist.

The primary dependency is Next.js framework/Flight inline scripts in cached
storefront HTML with `cacheComponents: true` in `apps/web/next.config.ts`.
Per-request nonce authorization cannot simply be added to that shared HTML:
the response policy and rendered scripts must agree, and a nonce must not be
reused as a cache key workaround. Next.js documents that nonce-based CSP
requires dynamic rendering, disables ISR, and is incompatible with PPR:
[Next.js CSP rendering guidance](https://nextjs.org/docs/app/guides/content-security-policy#static-vs-dynamic-rendering-with-csp).

Additional inline-script migration candidates include
`apps/web/src/components/analytics/tiktok-pixel.tsx` and
`apps/web/src/components/analytics/google-customer-reviews.tsx`. These are
source-inventory candidates, not proof that either executes on every storefront.
The SRI option is currently commented out in `apps/web/next.config.ts`; it is
not an enabled replacement or proof that all inline scripts are authorized.

Follow-up CSP migration remains open:

On 2026-09-27, the owner approved deferring this hardening from PR #3513
to [issue #3519](https://github.com/ogabasseyy/Baci/issues/3519). The PR thread
is resolved as deferred, not fixed; the migration gates below remain open.

- [ ] Inventory rendered framework, analytics, advertising, and payment scripts
  on representative anonymous, authenticated, checkout, and crawler responses.
- [ ] Validate nonce propagation on explicitly dynamic routes, including
  framework/Flight scripts, application scripts, and third-party loaders.
- [ ] Evaluate a supported hash-based policy for cached/PPR routes; otherwise
  obtain explicit approval for the rendering/cache and compute-cost tradeoff
  before migrating those routes to dynamic nonce-based authorization.
- [ ] Exercise the candidate policy in report-only mode in an approved test
  environment, then verify hydration, payments, attribution, and cache isolation.
- [ ] Remove `'unsafe-inline'` only after those gates pass. Do not cache or reuse
  a request nonce, silently disable PPR/ISR, or treat this record as risk closure.

### Preserved behavior

- Preserve the exported `proxy(request)` and statically analyzable `config.matcher` in `apps/web/src/proxy.ts`.
- Preserve exact routing precedence, status codes, query handling, request-body forwarding, trusted merchant headers, bot metadata partitioning, and public/private cache isolation across custom domains, merchant subdomains, and root-domain slug paths.
- Rate-limit alias-shaped API requests before any alias lookup. Keep origin/mutation protections, webhook/bearer exceptions, session handling, strict CSP nonces, and PostHog credential stripping unchanged.
- Unknown, timed-out, unavailable, or malformed public verdict data must remain fail-open; only authoritative verdicts can redirect or hard-fail a document.
- Keep `durablePdpPurge: false`; do not increase cache freshness or declare purge release gates complete.
- Observe resolved merchant identity on normal custom-domain requests as well as subdomains; do not log credentials, customer identifiers, or query strings.
- Coalesce only compatible public RPC work: include function, all arguments, empty-result semantics, timeout budget, deployment environment, and injected implementation identity. Keep the existing bounded memo, breaker, and timeout semantics. No new persistent cache or dependency.

## Architecture and verification

One responsibility per new module; aim for at most 300 lines. Use direct imports, not a giant shared context bag or a new monolith hidden behind a tiny entrypoint. The existing regression suite remains intact; new tests go into focused modules.

Preserve recorded source-inventory safeguards. Hash extracted routing modules too. Regenerate inventory only against a real reviewed source commit; never weaken byte checks or manufacture ancestry. Report squash-merge/ancestry issues as release constraints.

Run focused proxy and preflight regressions during implementation; select final affected-web lint, typecheck and test coverage under the superseding 2026-09-26 repository validation policy, and run CodeRabbit before submission. Broaden scope if shared runtime/build/dependency changes arise. Keep local completion, review, merge, deploy, and production verification distinct.

## Cost claims

File extraction does not itself reduce billed invocations. For N overlapping identical verdict requests on one warm instance, single-flight should reduce RPC starts from N to 1 (a 90% reduction for N=10). It does not eliminate the N inbound middleware invocations or prove a monthly dollar saving. Quantify with deterministic call-count tests and document the limitation.

## Out of scope

No production mutations, configuration/subscription changes, cache-TTL changes, migrations, deployment, font/static packaging repair, or changes to comparison eligibility algorithms. Do not duplicate other agents' comparison work.
