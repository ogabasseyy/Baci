# READY FOR PARENT REVIEW — connected local HTTP composition

## Scope and callable entry

Actual entry: `apps/web/src/lib/piggyvest/runtime-composition-server.ts`
exports `startPiggyvestRuntimeCompositionServer(options)` returning
`Promise<{ origin: string; close(): Promise<void> }>`.
The listener hard-binds `127.0.0.1`; port is 0 or 1024..65535.

The Fetch adapter remains `runtime-composition.ts#createPiggyvestRuntimeComposition`.
It takes `origin` instead of `port`, returning a native
`Request => Promise<Response>`. Validate the native URL before constructing
NextRequest, which normalizes loopback hosts.

Common explicit options, defined in `runtime-composition.types.ts`:

- `configuration: {mode:'local_test',goalId,context,termsDocument}`, strictly parsed.
- `context`: existing customer-policy configuration, including matching
  expected/actual project, integration/business/merchant and allowlists.
- `termsDocument: {version,hash,text}`: existing strict Unicode/32768-byte
  contract; the actual policy handler validates SHA256 against persisted terms.
- `execute`: existing restricted PostgreSQL executor.
- Exactly one of `authentication` or `createRlsClient`.
- `authentication: {url,publicKey,syntheticLoopback?:true}`: actual request-scoped
  Supabase SSR construction; HTTPS must use the canonical configured project
  hostname. Loopback auth fixtures require the explicit synthetic flag.
- `authenticationFetch?`: explicit synthetic HTTP dependency for tests, not an
  authenticated actor callback. No network runs in auth tests.
- `createRlsClient(NextRequest)`: retained explicit synthetic test seam.
  It must construct a request-local RLS client without protected operations.
  Authentication/identity still comes from getUser and the existing resolver.
- `browserOrigin?`: exactly one configured loopback browser origin; defaults to
  listener origin. No origin is inferred from forwarded headers.
- `csrfCookiePath?`: fixed `/` or canonical `/scenario/<1..6 decimal digits>`.
- `csrfSecret?`: server-only deterministic-test injection; 32 bytes with obvious
  low-diversity values rejected. Default is process-lifetime CSPRNG material.
  A shape check cannot prove the randomness of supplied material.
- `services?`: explicit capabilities:
  `funding:{fundingConfiguration,fundingExecute,mappingExecute,fetchImplementation}`;
  `purchase:{enabled:true}`, `lifecycle:{enabled:true}`,
  `schedule:{enabled:true}`. Missing services return 503, never legacy fallback.

No environment, credential file, provider client or service/admin Supabase client
is loaded by this composition. Existing CSRF code uses NODE_ENV only for cookie
name preference. Public keys are restricted to anon JWT-role or publishable-key
shape; this is not local signature verification or proof of a genuine session.

## Fixed routes — actual handlers connected

| Route | Method and body/query |
| --- | --- |
| `/csrf` | GET, no query; verified authenticated goal context; returns `{csrfToken,expiresAt}` (Unix milliseconds) |
| `/screen` | GET `?goalId=<fixed>`; actual readScreen, strict SavingsScreenSource; optional actual funding builder |
| `/policy` | GET `?goalId=<fixed>`; POST no query, existing exact draft/terms/duration acceptance |
| `/funding` | GET `?goalId=<fixed>`; actual customer-funding-http, returning validated screen DTO |
| `/purchase/quote` | POST `{goalId,quoteId,shippingRateId,savingsKobo,fulfilmentMode:'pickup'}` |
| `/purchase/prepare` | POST `{goalId,operationId,accepted:true,quote:<existing exact quote>,fulfilmentMode:'pickup'}` |
| `/purchase/status` | GET, both `goalId` and `operationId` REQUIRED |
| `/lifecycle/terms` | POST `{goalId,revisionId,durationMonths}`, integer 1..6, prepares terms only |
| `/lifecycle/activate` | POST `{goalId,revisionId,operationId}` |
| `/schedule` | GET `?goalId=<fixed>[&operationId]`; POST strict `{operationId,command}` |
| `/cancel` | GET `?goalId=<fixed>`; POST existing exact public confirmation, no query |
| `/recovery` | GET `?goalId=<fixed>[&operationId]`, never retry authorization |

There is NO generic lifecycle endpoint. Purchase/lifecycle/schedule/funding
dispatch imports other owners' actual handlers; their parsing, bounds, context,
store, revalidation and exact registered statements remain authoritative.

## Auth, cookies, CSRF and abort boundaries

The concrete `runtime-composition-auth.ts` wrapper uses actual
`@supabase/ssr#createServerClient`, constructs one client per request, and uses
getUser rather than trusting decoded session/user data. All auth HTTP is pinned
to the configured origin with redirects rejected and combined request signals.
Canonical remote project B cannot be used with context A. Unsupported custom
domains fail closed. Loopback synthetic mode is explicitly separate.

SSR cookie refresh/removal writes update request-local cookies and are appended
as real Set-Cookie headers on the final HTTP response. The listener preserves
those headers; no tokens/configuration are put into public JSON. Cookies are
host-only, HttpOnly, SameSite Strict and configured-path scoped for this local
HTTP application. No login/bootstrap of Supabase credentials is implemented.

CSRF bootstrap verifies getUser/current actor and the existing fixed-goal
context. It requires the explicit browser Origin or same-origin fetch metadata;
there is no unauthenticated read-bootstrap bypass. It emits an HttpOnly
`piggyvest-csrf` cookie and a 15-minute token. The HMAC binds fixed goal, explicit
browser origin, canonical cookie path, verified actor and current non-CSRF
session cookies. The signed token/cookie must match before the existing actual
double-submit checker runs. No unsigned/raw-checker compatibility mode remains.

For QA, a fixed frontend may proxy to explicit backend targets: original Origin,
Cookie and Set-Cookie MUST remain unchanged; only Host targets the exact backend.
Forwarded/X-Forwarded-* authority is rejected. Each scenario uses its own
configured cookie path and server-issued HttpOnly synthetic-session cookie.
Static assets/proxy/session fixtures are owned by Sartre/Russell, not this router.

Bodies reuse the existing 4096-byte/64-chunk/two-second parser. Listener limits
are 8192 header bytes, 64 headers, 262144 response bytes and an eight-second
application deadline. Host, peer, absolute/protocol-relative/backslash targets,
cross-origin requests, bearer headers and unknown methods fail closed.
Responses are generic/no-store/nosniff; no CORS permission is emitted.

Every funding effect is separately fenced in `runtime-composition-funding.ts`:
funding SQL, mapping SQL and fetch check before dispatch and after await; fetch
combines request, caller and Request-input signals and cancels a late body.
The projection prevents service fields from overwriting common authenticated
options. Both /screen and /funding use it. An abort never proves already
dispatched SQL rolled back, never releases a reservation and never permits retry.

## Retained regression evidence

- Funding abort P2: exact RED two failures — delayed capability authentication
  still dispatched SQL, and delayed mapping still dispatched two synthetic
  provider reads after abort. Same `runtime-composition-funding.test.ts` cases
  GREEN after fencing every effect.
- SSR project P2: exact retained RED in `runtime-composition.test.ts`,
  “rejects a different Supabase project before constructing any request client
  or fetch”: A context/B URL wrongly constructed. GREEN rejects B with zero
  fetch, accepts matching A without fetch, rejects implicit loopback and accepts
  explicitly synthetic loopback without fetch.
- Real HTTP `runtime-composition-bootstrap.test.ts` verifies identical-actor
  701 token+cookie copied to 702 fails, plus wrong path, origin, session, actor,
  cookie/token tampering, untrusted forwarding headers and unauthenticated
  bootstrap. No replay acquires SQL authority.
- Existing TRACE 503->405 and privileged port rejection regressions are retained.
  Old raw-CSRF fixtures now actually bootstrap; no test bypass was added.

Hooke's latest `docs/piggyvest-final-gap-audit.md` independently closes the funding
abort and SSR project-binding P2 findings, verifies the retained A/B test, and
reports auth/CSRF/bootstrap checks passing. This is local boundary review only.

## Runnable verification and actual results

From `apps/web`:

```sh
pnpm exec vitest run src/lib/piggyvest/runtime-composition*.test.ts src/schemas/piggyvest-runtime-composition*.test.ts --maxWorkers=1
```

**41 passed, 3 opt-in PostgreSQL cases skipped** in the ordinary run.
Those same opt-in cases were executed through the harness below, not left untested.

From the worktree root:

```sh
bash tools/test/runtime-composition-local.test.sh
bash tools/test/runtime-journey-local.test.sh http
PIGGYVEST_RUN_CUSTOMER_PURCHASE_HTTP=1 bash tools/test/purchase-pricing-local.sh
pnpm exec biome check apps/web/src/lib/piggyvest/runtime-composition*.ts apps/web/src/schemas/piggyvest-runtime-composition*.ts
```

- Owned harness: **3 before + 3 after PostgreSQL restart pass**, plus SQL
  invariants. Actual SSR cookie client/query builder -> synthetic auth/RLS HTTP
  transport -> real listener -> existing resolver -> actual restricted PG screen
  reads; actual shared policy client consent; lost committed cancellation
  response, original reservation recovery and exact-command replay. Goal 301 has
  one consent/no ledger operations; goal 302 has one retained principal
  reservation and unchanged paid/pending interest. No terminal operation.
- Russell's actual packaged connected harness was independently run here:
  **abort 1 pass, HTTP journey 2 pass, restart 1 pass**, SQL assertions before and
  after restart. Actual funding, duration consent, lifecycle, schedule and
  cancellation/recovery paths; synthetic auth/provider responses and real PG.
- Actual pickup pricing/purchase/lifecycle HTTP harness independently passed:
  pricing 5 tests, HTTP 3 before restart + 1 after restart, plus SQL source-change
  and retained-reservation assertions. No payment/order/provider dispatch.
- Scoped Biome **23 TS files clean**; scoped strict TypeScript diagnostics **0**
  in those owned files (transitive/root diagnostics excluded).
- Largest runtime file is 216 lines; all runtime files remain under 300.
- Parent owns root checks, global registrations and final full-candidate review.
  Sources are stable for that final broad review; scoped Hooke findings above
  are closed, not a claim that the entire candidate has completed review.

Both harnesses use disposable Unix-socket PostgreSQL and loopback HTTP; no remote
database/provider/authentication connection is made. Registered frozen SQL is
reused, never edited. Real Supabase getUser network is replaced only by explicit
synthetic transport in tests; this is NOT genuine login evidence.

## Exact owned files

All paths are relative to /Users/mac/Baci-worktrees/cursor-savings-phase1:

- apps/web/src/lib/piggyvest/runtime-composition.ts
- apps/web/src/lib/piggyvest/runtime-composition.test.ts
- apps/web/src/lib/piggyvest/runtime-composition.types.ts
- apps/web/src/lib/piggyvest/runtime-composition.constants.ts
- apps/web/src/lib/piggyvest/runtime-composition-server.ts
- apps/web/src/lib/piggyvest/runtime-composition-server.test.ts
- apps/web/src/lib/piggyvest/runtime-composition-routes.ts
- apps/web/src/lib/piggyvest/runtime-composition-routes.test.ts
- apps/web/src/lib/piggyvest/runtime-composition-auth.ts
- apps/web/src/lib/piggyvest/runtime-composition-auth.test.ts
- apps/web/src/lib/piggyvest/runtime-composition-auth.integration.test.ts
- apps/web/src/lib/piggyvest/runtime-composition-csrf.ts
- apps/web/src/lib/piggyvest/runtime-composition-csrf.test.ts
- apps/web/src/lib/piggyvest/runtime-composition-bootstrap.test.ts
- apps/web/src/lib/piggyvest/runtime-composition-funding.ts
- apps/web/src/lib/piggyvest/runtime-composition-funding.test.ts
- apps/web/src/lib/piggyvest/runtime-composition.integration.test.ts
- apps/web/src/lib/piggyvest/runtime-composition.report.md
- apps/web/src/schemas/piggyvest-runtime-composition.ts
- apps/web/src/schemas/piggyvest-runtime-composition.test.ts
- apps/web/src/schemas/piggyvest-runtime-composition-auth.ts
- apps/web/src/schemas/piggyvest-runtime-composition-auth.test.ts
- apps/web/src/schemas/piggyvest-runtime-composition-csrf.ts
- apps/web/src/schemas/piggyvest-runtime-composition-csrf.test.ts
- tools/test/runtime-composition-local.test.sh

The existing owned SQL fixtures runtime-composition-fixture.sql and
runtime-composition-fixture.test.sql are reused unchanged in this continuation.
No other owners' handlers, UI, frozen migrations, manifests, catalogs,
package/lock/env files or production routes changed.

## Honest remaining gaps

This batch connects runnable local HTTP operations, not the entire product.
Genuine Supabase session establishment, deployed infrastructure, provider sandbox
approval and live customer/provider evidence remain outside this execution.
Funding reads do not post money; purchase preparation does not create a paid
order or fulfillment; local activation/schedule consent does not authorize
provider collection. Refund/cancellation dispatch, interest disposition,
settlement/finality and reservation release remain disabled without their
specific contracts/evidence. Browser/client/device acceptance belongs to its
owners. No deployment, production login, provider mutation or live funds claim.
