# S-02 design: Oxygen login transport + token cache (v2.1, hardened)

Dated 6 October 2026. Status: v2 APPROVED pre-coding; v2.1 adds the
post-implementation hardening findings (H1–H3, H5–H7 addressed; skew floor;
H4 whitespace-token deferred with reason below); delta recheck ACCEPTed.
CodeRabbit timeout-read finding fixed with TDD and re-ACCEPTed; final
CodeRabbit snapshot clean (0 findings).
(H-labels are hardening findings; F1–F7 remain the later-slice follow-ups.)
Parent docs: `CONTRACT-REGISTER.md` (CR-01, CR-02), `EXECUTABLE-HANDOFF.md`,
`REVIEW-2026-10-06.md`, `RESEARCH-2026-10-06.md`. No provider calls; synthetic
fixtures only, distinct from any real sample.

## Goal

Server-only, dependency-injected modules that perform the documented partner login
(`POST /v1/partner/login`, CR-02 sample) and cache the returned token per
connection with returned-expiry enforcement. No refresh endpoint is invented:
expiry leads to re-login through the documented endpoint. No
environment→URL mapping is hardcoded (CR-01 open): `baseUrl` is pinned per
connection at composition time.

## Disjoint file set (implementer owns; nothing else may be touched)

- NEW `apps/web/src/schemas/oxygen-login.ts` — Zod v4 login response schema.
- NEW `apps/web/src/schemas/oxygen-login.test.ts` — schema accept/reject cases.
- NEW `apps/web/src/lib/payments/oxygen/transport.ts` — login transport.
- NEW `apps/web/src/lib/payments/oxygen/transport.test.ts`
- NEW `apps/web/src/lib/payments/oxygen/token-cache.ts` — cache.
- NEW `apps/web/src/lib/payments/oxygen/token-cache.test.ts`

Docs/evidence stay with the orchestrator. Existing oxygen files are read-only.

## Transport contract

- `loginOxygenPartner(deps, input)` with
  `deps = { fetchImpl, clock?, timeoutMs = 30_000, signal?, now? }` and
  `input = { baseUrl, reference, secret }`. Default clock is `Date.now`.
  `timeoutMs` default 30s matches the `fetchWithTimeout` precedent.
- Reuse: reuse `isAbortError` from `@baci/shared/lib` for abort mapping.
  Divergence from `fetchWithTimeout` is recorded: it has no `fetchImpl`
  injection point, and this slice mandates dependency injection with synthetic
  transports while staying app-scoped (no shared-runtime change). Revisit the
  shared helper when a second consumer needs injectable fetch.
- Server-only: `import 'server-only';` is the FIRST line of `transport.ts` and
  `token-cache.ts`, following the 239-file repo convention (verified by source
  search; declared in no manifest — pre-existing phantom dependency, out of
  slice scope). The schema file carries no marker: it is pure, holds no
  secrets, per the S-01 precedent.
- Guards: `baseUrl` must parse as `https:` (fail closed, no fetch attempted);
  `reference`/`secret` must be non-empty strings (whitespace-only credentials
  are literal-compliant and fail closed at the provider with `auth_failed`).
  `baseUrl` containing `?`/`#` or userinfo is rejected: concatenation would
  post to the wrong path on the same host (`?`/`#`), while userinfo risks
  credential-leak/host-confusion. `deps`/`input` must be objects,
  `fetchImpl` must be a function and `now` must be a function when provided
  (else `invalid_input`, never a raw throw). URL join is string concatenation
  only: strip trailing `/`s from
  `baseUrl`, append `/v1/partner/login`; leading-slash `new URL` resolution is
  forbidden (it drops path-bearing bases). Pinned fixture:
  `https://api.theoxygen.com/services/partners/` (± trailing slash) →
  `https://api.theoxygen.com/services/partners/v1/partner/login`.
- Request: POST JSON `{ reference, secret }`, JSON accept header,
  `cache: 'no-store'` (installed Next 16.3.0 fetch docs: forces remote fetch
  every request), `redirect: 'error'` (any redirect is `upstream_error`;
  secrets must never follow a redirect). Timeout composes an internal timer
  with the optional external `signal` via `AbortSignal.any`. The timer stays
  alive through body parsing: the 2xx body read races the composed abort
  signal (transport-agnostic, so injected `text()` stubs that ignore signals
  still time out); an abort during the read is `timeout`. One attempt per
  call, no automatic retry — retry policy belongs to future orchestration.
- Credential sourcing (MUST): credentials are resolved server-side from trusted
  config/secret store only, never accepted from client input; future callers
  must authorize via the merchant/staff or worker model before invoking login.
  A route that forwards client-supplied credentials would make Baci a
  credential-forwarding oracle.
- Response: non-2xx maps to coded errors (`auth_failed` for 401/403,
  `upstream_error` otherwise; `status` preserved on all non-2xx for future
  backoff). With `redirect: 'error'`, a live redirect surfaces as a fetch
  rejection, so redirect rejections map to `network_error`; a synthetic 3xx
  `Response` (should a transport return one) still maps to `upstream_error`.
  Body parsed defensively: empty/non-JSON bodies
  are `invalid_response`, never a throw; `fetch` TypeError is `network_error`;
  genuine `AbortError` is `timeout`.
- Login-response schema: `token` non-empty string (`±Infinity`
  `expires_in` pinned rejected; whitespace-only tokens are literal-compliant
  and fail closed downstream — see deferred item below); `expires_in` integer
  1..86_400 (fractional, zero, negative, or huge values are `invalid_response`);
  extra fields (including any amount-ish ones) are ignored and must never
  surface as money. `issuedAtMs`/`expiresAtMs` anchor at request start
  (`expiresAtMs = requestStart + expires_in * 1000`), so RTT cannot extend
  apparent validity. `issuedAtMs` is returned for future observability; the
  cache does not consume it.
- Errors: `OxygenTransportError` carries `code` (+ `status`) only, no `cause`.
  The partner `reference` is confidential per CR-02: messages, logs, `cause`,
  and cache keys must never contain `reference`, `secret`, `token`, or raw
  request/response bodies (provider error bodies may echo credentials).
  `accountLabel` is an opaque caller-chosen label and MUST NOT equal the
  provider `reference`. Both modules perform no logging; the caller decides.
- Login is non-financial: re-attempting after timeout/failure is permitted and
  does not violate the no-blind-replay rule (that rule governs mutations).

## Cache contract

- `createOxygenTokenCache({ login, clock, expirySkewMs = 60_000 })` returns
  `{ getToken, invalidate }`. `login` is an injected
  `(key, credentials) => Promise<{ token, expiresAtMs }>`; the cache never
  imports the transport. The 60s skew follows the `google-ads/access-token`
  repo precedent. Transport and cache MUST share one clock instance
  (composition rule; disagreeing clocks corrupt freshness math).
- Scoping: one cache instance per resolved connection
  (merchant/account/environment). Sharing one instance across merchants is
  forbidden (composition MUST). Key within an instance:
  `{ accountLabel, environment }` — stable non-secret labels. The secret is
  passed through to `login`, never stored, never part of the key.
- `baseUrl` is pinned per key inside the injected `login` closure at
  composition time; it is never a `getToken` parameter, so a caller bug cannot
  POST one environment's secret to another environment's host.
- Keys are validated: non-empty, non-whitespace-only strings; comparison is
  exact (case/whitespace significant). Storage uses nested Maps
  (`Map<environment, Map<accountLabel, entry>>`) so separator/unicode content
  cannot collide.
- Hit: stored entry with `clock() < expiresAtMs - effectiveSkew`, where
  `effectiveSkew = max(0, min(expirySkewMs, floor(lifetimeMs / 2)))` and
  `lifetimeMs = expiresAtMs - storedAtMs`. The clamp keeps sub-skew tokens
  briefly usable instead of causing a login storm; the floor at 0 keeps
  already-spent lifetimes fail-closed. `expirySkewMs` must be a finite number
  ≥ 0 at construction (else throw). Miss/expired: call `login`, store on
  success. Failed logins (including synchronously-throwing `login`) are never
  stored and always clear the flight entry; the next call re-attempts.
- Singleflight: concurrent `getToken` calls for one key share a single
  in-flight login; different keys proceed independently. All singleflight
  awaiters receive equal resolutions (per-awaiter copies, so one caller cannot
  mutate another's result) and the same rejection, with no unhandled
  rejections. Tests use deferred promises, no sleeps.
- `invalidate(key)` drops the stored entry AND detaches the flight:
  pre-invalidate awaiters still resolve (documented), post-invalidate callers
  start a new login. `invalidate` is idempotent on absent keys. Rotation
  requires `invalidate`; a cached token is returned without re-checking the
  secret — this pins an assumption that provider tokens survive secret
  rotation, which is SPECULATIVE while CR-02 rotation semantics are
  undocumented (see F1).
- No cross-key leakage: a token stored under key A is never returned for key B.
- In-memory only: per-instance login is intentional non-persistence for S-02.

## Acceptance criteria

- Behavioural RED per module: tests written first, then a compiling stub that
  fails assertions (import/setup failures do not count); RED output recorded
  with counts; minimal GREEN; refactor; affected tests re-run.
- Transport cases: invalid inputs; http/uppercase/whitespace `baseUrl` rejected
  with no fetch call; trailing-slash join incl. the path-bearing fixture;
  `redirect: 'error'` asserted on captured init; 401/403/500/429 (status
  preserved)/204/empty-body/non-JSON/`fetch`-TypeError mapping; genuine
  `DOMException(…, 'AbortError')` → `timeout` (a fake sentinel signal proves
  nothing — T1); configured `timeoutMs` asserted via capture; invalid-shape
  responses incl. fractional/huge/zero `expires_in`; extra amount-ish fields
  ignored with no money surface.
- Cache cases: skew boundaries with hardcoded wall-clock arithmetic, never
  importing implementation constants (e.g. issued T, `expires_in: 300`, 60s
  skew → hit at T+239_999ms, miss at T+240_000ms — T2); sub-skew clamp
  boundary (`expires_in: 30` usable, pinned); singleflight same-key (one login,
  all resolve) vs independent keys; sync-throw clears flight; shared rejection
  across 3 callers; failure-no-store; invalidate semantics incl. in-flight
  detach and idempotence; cross-key isolation incl. deferred independence;
  key-validation rejections without `login` calls.
- Redaction: `JSON.stringify` sweep over every error code asserting absence of
  fixture `reference`/`secret`/`token`/raw bodies; `console.*` spy asserting
  zero calls across all failure modes (T3); 401 body echoing the secret stays
  out of the message.
- Static: first-line `server-only` marker asserted per file for
  `transport.ts` and `token-cache.ts`, following
  `server-credential-client.test.ts` (T4).
- Unwired gate (exact command, must print nothing):
  `rg -l 'oxygen/(transport|token-cache|login)' apps/web/src/app apps/web/src/components`
  (B11).
- `pnpm biome check` clean on owned files; `vitest run` green on owned tests.
- Exact commands, counts, and failure summaries reported back (evidence file
  stays with the orchestrator; implementer does not edit docs).

## Deferred hardening item

- H4 whitespace-only provider `token`: literal design compliance (non-empty
  string) is kept. Zero security impact: tokens are server-side, the provider
  401s a bad token, and later-slice F1 (downstream-401 invalidate+retry)
  covers revocation. Revisit only if a later slice wants stricter token
  hygiene.

## Follow-ups for later slices (do NOT block S-02)

- F1: downstream-401 feedback — cache has no auto-invalidate; later
  orchestration must `invalidate` + retry once on provider 401.
- F2: distinct `rate_limited` code / `status: 429` backoff + bounded retry
  (needs CR-15).
- F3: richer caller-cancellation composition (basic `signal` passthrough is
  in S-02 scope).
- F4: multi-instance login amplification; revisit for serverless/edge
  (SPECULATIVE).
- F5: strict numeric `expires_in` vs possible provider string (fail closed
  now; revisit after sandbox, CR-02; SPECULATIVE).
- F6: disconnect semantics — pre-invalidate awaiters still resolve; later
  callers must recheck authorization after `getToken`.
- F7: `issuedAtMs` unused by the cache — later slices drop it or assign a
  purpose.

## Out of scope

Refresh endpoint, retry/backoff policy, persistence, settings flags, checkout or
chat wiring, availability boundary (S-03), orchestration (later). Provider-amount
conversion stays absent (CR-06).


## Independent review correction

The original clean automated-review snapshot did not cover all defects. A later
independent pass reproduced and fixed mutable-key flight retention and delivery of
already-expired tokens. The cache now snapshots identity and passes a separate adapter
copy; the transport checks expiry at completion. Current behavior/evidence supersedes
the earlier 158-test summary: see [independent review](INDEPENDENT-S02-REVIEW.md).
