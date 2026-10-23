# Builder account linking: local implementation evidence

Date: 2026-10-22. Base: `324032be5c`. Review: independent Codex, replacing
CodeRabbit under the owner's instruction. Both existing submissions and all
production services remain untouched.

## Implemented

The isolated `apps/web/tools/builder-auth` package composes the accepted
`oidc-provider` 9.12.2 and `openid-client` 6.8.8 with PostgreSQL storage, encrypted
provider/pending records and a connection-bound AES-GCM upstream session vault.
Signing, cookie and vault configuration are separate. Normal TLS remains on.

The new broker implements dedicated upstream PKCE sign-in, verified subject,
explicit consent, exact resource/callback policy and canonical revocation.
Provider lookup IDs are hashes because opaque refresh/code IDs may be bearers.
Concurrent artifact consumption revokes the family before returning failure.
Refresh holds a distributed connection lock, commits a marker before exchange,
and requires reconnect after uncertainty. No browser refresh token is captured.

Web-side factories authenticate the builder JWT and hydrate current canonical
consent, resolve a normal upstream user client with `getUser()`, and recheck
owner membership under RLS. A disabled dashboard page offers owner disconnect
using SECURITY INVOKER/RLS RPCs. No proxy, environment, current Muse/buyer
manifest or submission configuration changed.

## Evidence scope

- Real PostgreSQL fixtures apply the new migration and test role/table access,
  cross-owner denial, lock contention, single-use/replay revocation, canonical
  target binding without a grant-version bump, owner disconnect and encryption.
- The actual new HTTP handler runs with the actual provider, HTTPS and a
  browser-style path-scoped cookie jar. Its upstream boundary is a deterministic
  stub for callback/consent/refresh/recovery checks. It exposes only builder
  tokens; persisted records and consent HTML do not contain the upstream bearer.
- A separate real Supabase Auth 2.197.0 fixture exercises the production upstream
  adapter: code/PKCE, state and nonce negatives, `getUser()`, concurrent browser
  and two-link refreshes, and local disconnect isolation.
- A real PostgREST fixture accepts a normal owner token under RLS, rejects the
  separately signed builder resource token with HTTP 401, and rejects access to
  the private schema. This is a synthetic authority boundary, not a production
  Data API probe.
- Web fixtures cover issuer/audience/algorithm/expiry/connection/version,
  ignored user metadata, current consent hydration, ownership removal and the
  disabled release gate. Existing Muse and mobile bearer/cookie tests run too.

Codex reviewed source and tests and found no remaining actionable findings.
The reviewer did not independently execute the suites; execution results are
recorded by the implementing session.

## Validation results

- Web compatibility: 21 files / 142 tests passed, including Muse and mobile auth.
- Isolated auth package: 15 tests passed, including real PostgreSQL, PostgREST,
  Supabase Auth and broker HTTP fixtures.
- Web typecheck, isolated auth-package typecheck and targeted Biome passed.
- Validation scope: affected web/backend package and isolated SQL/runtime. No
  shared package or root dependency changed. Full monorepo tests were not run.
- Optional dependency-registry audit did not complete within the bounded wait;
  no advisory-free claim is made.
- Node reported the documented module-type warning for the existing shared
  sanitizer; no package mode change was made to silence it.

## Limits and handoff

This is local implementation evidence, not live account linking. The migration
has not been applied to a deployed project or replayed across the complete
historical release schema in this task. Full release replay remains required.
Its role safety assertion intentionally fails if existing public table grants
would give the broker commerce authority.

Task 4 must prove actual private store/domain provisioning and the next
same-token authenticated status/edit request through its real business RPC.
Current canonical materialization and auth hydration tests do not replace that
journey. No store, page or domain is provisioned by account linking itself.
Task 6 wires the new protected execution gateway. Task 9 owns staging/host QA,
retention operations and release packaging. Secret/DNS/client/OAuth provisioning
and dashboard activation need their exact authorization.

The vault holds ordinary linked-user RLS authority. Its compromise is broader
than builder scopes; it is trusted backend infrastructure, never MCP state.

Current references: [Supabase OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows),
[token security](https://supabase.com/docs/guides/auth/oauth-server/token-security),
[modern TLS requirement](https://supabase.com/changelog/cbc-tls-ciphers-deprecated).
