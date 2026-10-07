# Cancellation HTTP client — READY FOR PARENT REVIEW

## Follow-up: HTTP integration recovery union

Direct `pnpm --filter @baci/web exec tsc --noEmit --incremental false` reproduced TS2339 at cancellation-client-http.integration.test.ts:166. The test now stores the returned view and explicitly rejects null/review before accessing recovery; no casts or non-null assertions. Exact HTTP integration test passes (1/1), scoped Biome passes. Web typecheck rerun has no cancellation-client errors; it remains blocked only by the separately owned `src/lib/piggyvest/purchase-pricing.ts(77,30)` TS18048 (`actor.data` possibly undefined), left unchanged.

## Follow-up: strict closure narrowing

Reproduced TS18048 at client selection.goalId using `pnpm --filter @baci/shared exec tsc --noEmit --ignoreConfig --strict --target ES2020 --module ESNext --moduleResolution bundler --lib ES2020,DOM --skipLibCheck src/lib/piggyvest-cancellation-client.ts`. Captured the already-validated goal string before the async closure, preserving strict narrowing without casts/assertions. The same focused typecheck now passes. Six malformed-selection cases confirm rejection before HTTP/CSRF. Client plus factory suites: 15 tests pass; scoped Biome passes. Client runtime is now 176 lines.

Local synthetic verification only. No production activation, provider calls, credentials, database changes, or financial execution.

## Stable files

- packages/shared/src/lib/piggyvest-cancellation-client.ts
- packages/shared/src/lib/piggyvest-cancellation-client.test.ts
- packages/shared/src/lib/piggyvest-cancellation-client-binding.ts
- packages/shared/src/lib/piggyvest-cancellation-client-binding.test.ts
- packages/shared/src/schemas/piggyvest-cancellation-client.ts
- packages/shared/src/schemas/piggyvest-cancellation-client.test.ts
- apps/web/src/components/storefront/piggyvest-savings/cancellation-client-binding.integration.test.tsx
- apps/web/src/components/storefront/piggyvest-savings/cancellation-client-http.integration.test.ts
- apps/mobile-storefront/components/wallet/savings/PiggyvestCancellationClient.integration.test.tsx
- docs/piggyvest-cancellation-client-report.md

Existing runtime, UI, policy transport, and contracts are unchanged. Parent added the public barrel exports; app integration tests now consume them. Runtime modules are 175/80/14 lines. Existing bounded streaming policy body reader is reused.

## Public API and parent wiring

`createPiggyvestCancellationClient({ configuration, goalId, fetch, getCsrfToken, isCurrent })` returns `quote(signal?)`, `prepare(command, signal?)`, and `recover({ goalId, operationId? }, signal?)`.

Configuration is strict: `mode: 'local_test'`, explicit literal numeric-loopback HTTP `baseUrl` with port, `endpointPath`, `recoveryEndpointPath`, optional `credentials` (defaults `omit`). Paths cannot be equal or nested, have query parameters, or escape origin. Fermat composition uses `/cancel` and `/recovery`. UUID query identities canonicalize, original strict preparation command bytes retain their UUID casing. Only validated goal/operation query fields are emitted.

`await createPiggyvestCancellationClientBinding({ mode: 'prepare' | 'recovery', source, tenantKey, operationId?, http: { configuration, fetch, getCsrfToken }, isCurrent })` returns the existing `read/prepare/recover/invalidate` controller interface. Feed this to either existing web/native optional cancellation binding. Both factories are exported from `@baci/shared/lib`; all three app integration tests use that public barrel.

The caller supplies authenticated source and a current identity predicate for session/tenant/goal; these are not authentication credentials or server authority. Server handlers still authenticate and resolve exact RLS scope. Keep the controller in that explicit authenticated lifetime across UI remounts and invalidate at logout/context replacement. After reload or uncertain historical operation, use recovery mode: construction performs no HTTP, quote, or CSRF work, and cannot prepare. Never treat absent recovery as permission to start another operation. No durable browser/native storage is added.

Prepare mode requires a valid caller operation ID before loading a quote. Timeout/response loss can follow server commitment: the controller retains the attempted command and becomes uncertain, without automatic resend, operation generation, balance mutation, refund claim, or interest finality. A recovered prepared state means a local principal reservation only; provider dispatch remains a contract gap.

## Transport limits

Five-second total deadline covers CSRF, fetch and streaming body. Maximum body is 262144 bytes/1024 chunks using the existing strict body reader. Non-2xx, malformed/extra data, redirect, mismatched response URL/goal/operation, invalid CSRF, cancellation and stale identity redact to `Cancellation unavailable`. Response URL must match exactly. No bearer or arbitrary header option exists.

Injected fetch must implement streaming response bodies and honor redirect rejection before following redirects; post-response checks cannot retroactively prevent leakage by a nonconforming adapter. There is no ambient runtime fetch, cookie jar, credentials, or environment lookup. Browser same-origin cookies remain explicit configuration. Native Expo fetch capabilities are NOT assumed: a reviewed adapter with bounded streaming, no-follow redirects, cancellation, and explicit authenticated cookie/Origin handling is still required before real native binding. Abort does not prove cancellation of server commitment.

## Verification evidence

RED: missing client implementation initially failed tests. Added ancestor-overlap regression failed (schema accepted nested endpoints); the stricter path schema made it green. Initial integration assertions exposed async fixture timing and incorrect synthetic SQL selector; corrected test harness uses awaited completion and exact statement constant.

GREEN commands (2026-09-12):

```sh
pnpm --filter @baci/shared exec vitest run src/lib/piggyvest-cancellation-client.test.ts src/lib/piggyvest-cancellation-client-binding.test.ts src/schemas/piggyvest-cancellation-client.test.ts src/lib/piggyvest-policy-client.test.ts src/lib/piggyvest-policy-client-body.test.ts src/lib/piggyvest-cancellation-controller.test.ts
# 6 files, 57 tests passed
pnpm --filter @baci/web exec vitest run src/components/storefront/piggyvest-savings/cancellation-client-http.integration.test.ts src/components/storefront/piggyvest-savings/cancellation-client-binding.integration.test.tsx
# 2 files, 2 tests passed
pnpm --filter @baci/mobile-storefront exec jest --runInBand components/wallet/savings/PiggyvestCancellationClient.integration.test.tsx components/wallet/savings/PiggyvestCancellationBinding.test.tsx
# 2 suites, 9 tests passed
pnpm exec biome check packages/shared/src/lib/piggyvest-cancellation-client*.ts packages/shared/src/schemas/piggyvest-cancellation-client*.ts apps/web/src/components/storefront/piggyvest-savings/cancellation-client-*.test.* apps/mobile-storefront/components/wallet/savings/PiggyvestCancellationClient.integration.test.tsx
# 9 files, no errors
```

Web HTTP test uses actual ephemeral loopback listener, Fermat's composed router, actual auth/context/CSRF handlers, shared client and controller; RLS and SQL executor are synthetic mocks, not PostgreSQL. It discards a successful actual HTTP POST response then proves no resend and recovery-only reload. Separate web UI test joins real handlers to actual review binding. Native test joins actual native binding/controller/client over real loopback sockets to a synthetic endpoint with a test-only explicit Node transport. It is not proof of native platform networking or the real backend. No device/build/install performed. Jest emitted existing Watchman recrawl/forced-exit notices; no infrastructure changes made. Parent owns root lint/type/full-suite and final exports.
