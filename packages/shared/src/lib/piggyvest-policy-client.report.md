# Policy HTTP client — parent review

Isolated local-test transport only. No app binder, routes, activation, provider requests or financial effects added.

## API

`createPiggyvestPolicyClient({ configuration, fetch, getCsrfToken, isCurrent? })` is exported from `@baci/shared/lib`. Configuration is strict: `{ mode: 'local_test', baseUrl, endpointPath, credentials? }`. Base URL permits only literal HTTP `127.0.0.1` or `[::1]` with explicit valid port. Endpoint is an absolute path without query, traversal or fragment. Credentials default to `omit`; app cookie configuration is explicit. No bearer/header configuration exists.

`load(goalId, signal?)` sends GET with exactly goalId. `submit(acceptance, signal?)` sends shared strict acceptance JSON and injected `x-csrf-token`. Both return the shared public view. POST requires server-recorded accepted consent with matching goal, revision and terms version/hash; it does not infer funding eligibility. UUID casing is canonicalized. All errors are `Policy unavailable` without raw diagnostics.

## Bounds and integration requirements

- Five-second total deadline includes CSRF, fetch and streamed body; 262144-byte and 1024-chunk response bounds. JSON UTF8 only; compressed or malformed bodies rejected.
- Caller must inject a conforming fetch with streaming Response.body and redirect-error enforcement. Native adapters lacking streaming fail closed; no unbounded text fallback. A post-response URL check cannot undo credentials leaked by a transport that ignores redirect:error.
- Injected responses must expose the exact final request URL. Browser binding must use the configured same origin; this module never reads ambient location, cookies, environment or auth globals.
- Parent owns endpoint mounting, cookie jar/session configuration, CSRF acquisition, stable context identity callback and aborting superseded work. No duplicate runtime binding is provided.
- Abort/timeout does not prove POST was rolled back. Never automatically resend acceptance; refresh authoritative draft after an indeterminate result. The client performs no retries.
- Funding, balances, eligibility, provider chronology and device-price guarantees are outside this transport.

## Files and scoped verification

New source/test pairs: `lib/piggyvest-policy-client`, `lib/piggyvest-policy-client-body`, `schemas/piggyvest-policy-client`; authorized `lib/index.ts` export; this report. All paths under packages/shared/src.

Initial TDD against unavailable stub: 10 failing / 8 passing tests. Final scoped command:

`pnpm --filter @baci/shared exec vitest run src/lib/piggyvest-policy-client.test.ts src/lib/piggyvest-policy-client-body.test.ts src/schemas/piggyvest-policy-client.test.ts`

Final result: 47 tests across 3 suites pass. Scoped Biome check covers all six TypeScript files plus index. Parent owns root checks and actual binder integration tests. No network requests were performed.
