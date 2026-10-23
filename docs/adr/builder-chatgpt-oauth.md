# Builder ChatGPT OAuth provider decision

Date: 21 October 2026. Scope: local Task 1 feasibility, following Task 0.

## Decision

**GO for local provider/SDK feasibility.** At the owner's explicit request, independent Codex review replaces the unavailable CodeRabbit gate. Codex verified both P2 fixes and issued a clean verdict, including the final database-readiness delta.

The local provider/SDK choice is to pin
`oidc-provider@9.12.2`, `openid-client@6.8.8`, and `jose@6.2.12` for the broker.
The [acceptance evidence](../connectors/evidence/builder-oauth-acceptance.md)
records the tested boundaries. This does not authorize or establish production
OAuth, a credential vault, new environment configuration or a new app submission.

Candidate dependencies are isolated in the tool fixture's package/lockfile.
The web and buyer MCP manifests and lockfile are unchanged. Node 24.11.1 and
repository MCP server 2.3.1 / Node transport 2.1.1 passed local HTTPS checks.

## Registration and identity

Use a predefined public OAuth client with S256 for the first staging integration;
keep DCR disabled. Register only the exact callback shown for the new builder app.
The fixture uses the documented stable ChatGPT callback and provider-issued `iss`
responses; it does not reuse the submitted Ogabassey app's registration.

CIMD is an optional later configuration, not advertised by the default fixture.
The candidate feature is experimental. Its default metadata handling does not
select from OpenAI's plural authentication-method choices. A narrowly scoped
selection adapter was tested for the exact stable OpenAI document, exact callback,
compatible singular preference, plural-only choices and rejection of other URLs
and metadata redirects. Production CIMD fetching and DNS protections must retain
the provider's safe dispatcher; the test metadata fetch is synthetic. Do not turn
on broad dynamic registration or arbitrary metadata URL fetching.

The outer issuer is planned as `https://auth.usebaci.com`; the accepted resource
for both adapter and gateway is `https://mcp.usebaci.com/builder/mcp`. Actual local
issuers are ephemeral loopback HTTPS URLs. Tokens carry subject, connection ID,
grant version, scope, issuer, audience and expiry. The fixture's connection ID is
its opaque grant ID and its grant version is 1; Task 3 must replace these fixture
values with durable connection/grant records and live authorization checks.
No authorization decision may use email to merge accounts.

## Separate upstream grant

Use a separate predefined confidential Supabase OAuth client with
`client_secret_post`, an independent broker callback, fresh inner state/nonce/S256
verifier, and `openid email profile`. These are upstream identity scopes; they do
not restrict the normal Supabase JWT's Data API authority. Keep upstream tokens
inside the broker/execution boundary and use normal RLS clients for business data.
Never send those credentials to ChatGPT, the MCP adapter or widget.

The maintained client completed actual code, ID-token/UserInfo validation,
refresh and revocation flows against disposable Supabase Auth 2.197.0. An earlier
2.196.0 Basic-auth attempt failed its client-ID validation; this decision qualifies
POST authentication, not every advertised upstream authentication method.

Local disconnect uses the linked session's local logout and must also revoke its
outer connection/grant. Supabase whole-client grant revocation intentionally
invalidates all links for that client; do not use it for a single-link disconnect.
Reauthorization creates a fresh outer grant. Do not reuse the browser's refresh
token or silently share an outer grant between independent connections.

## Durable execution obligations

The fixture proves atomic code consumption across two provider processes and
restart/revocation semantics with local SQLite. Production needs a reviewed,
durable adapter with equivalent atomic consume and grant-family revocation on the
real shared datastore; in-memory storage is forbidden. Task 3 also owns encrypted
upstream-token storage, refresh serialization, disconnect reconciliation, consent
binding, key management and current owner/grant checks. Task 9 owns staging and
actual ChatGPT linkage. Local feasibility does not satisfy those later gates.

## Alternatives

Direct Supabase token exposure was rejected: OAuth identity scopes do not narrow
its normal user-data authority. A handwritten authorization server was rejected:
the maintained provider already supplies PKCE, issuer/resource binding, rotation,
UserInfo, revocation and client validation. No alternative provider is required by
these passing local protocol results; revisit this decision if staging or the
production storage adapter fails the same contract.

## Primary references checked

- [oidc-provider 9.12.2 release](https://github.com/panva/node-oidc-provider/releases/tag/v9.12.2)
- [Provider configuration](https://github.com/panva/node-oidc-provider/blob/v9.12.2/docs/README.md)
- [openid-client 6.8.8](https://github.com/panva/openid-client/releases/tag/v6.8.8)
- [OpenAI authentication contract](https://developers.openai.com/plugins/build/auth)
- [Supabase OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)
- [Supabase token security](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [Supabase Auth 2.197.0](https://github.com/supabase/auth/releases/tag/v2.197.0)
