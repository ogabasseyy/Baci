# Middleware modularization and request-work reduction

## Goal

Turn the oversized web proxy into a readable routing coordinator while preserving its security, tenant isolation, redirects, and degraded-data behavior. Reduce duplicate in-flight public verdict RPCs separately from the structural changes.

## Behavior contract

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
