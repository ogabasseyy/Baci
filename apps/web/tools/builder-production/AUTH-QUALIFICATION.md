# Qualify builder authorization independently

The standalone broker runs the same OAuth provider, PostgreSQL authorization
store and Supabase user-session client as the co-located production stack. It
opens a private Unix socket. The runner, delivery listener and build verifier
are outside this qualification.

## Configuration

1. Use the approved Supabase project. Confirm the builder authorization
   migrations and narrow grants are present and the private schema is outside
   PostgREST. The broker uses the dedicated `baci_builder_auth_login` login
   with only `baci_builder_auth_storage` membership and `NOINHERIT`. Use
   a TLS-verified connection to database `postgres` over direct routing or
   session pooling on port 5432. Keep RLS enabled. Run the reviewed
   `provision-auth-login.sql` through `psql -X -f` from an authorized
   operator session. It prompts for the secret only when creating the login.
   Verify a fresh broker connection before using the credential. The running broker schedules
   bounded deletion of expired provider and transaction records.
2. Register a dedicated confidential Supabase OAuth app with the exact callback
   `https://builder-auth.usebaci.com/upstream/callback` and
   `token_endpoint_auth_method=client_secret_post`. The broker uses this
   method for code exchange and refresh. Confirm the project’s active
   authorization UI can handle this new app and show the actual consent
   screen while preserving the commerce client's current registration.
   [Supabase OAuth client registration](https://supabase.com/docs/guides/auth/oauth-server/getting-started)
3. Provision the broker's service-owned `/var/lib/baci-builder-auth` and
   `/run/baci-builder-auth` directories with mode 0700 under trusted ancestors.
   Store the configuration at `/var/lib/baci-builder-auth/auth.json` with mode
   0600. Use the schema in `../builder-auth/production-config.ts`. It requires
   the project URL and publishable key, upstream issuer and client credentials,
   the dedicated database URL, a socket path, separate cookie/signing/vault
   keys and the connection lifetime. Set `clientId` to
   `baci-chatgpt-builder-v1` and copy the exact callback assigned by the
   ChatGPT draft. For isolated broker qualification before that screen is
   available, the documented RFC 9207 callback for an eligible ChatGPT MCP
   server is `https://chatgpt.com/connector_platform_oauth_redirect`.
   Verify the discovery flag, exact issuer match and `iss` on both success
   and error redirects. Confirm the portal's actual redirect URI before the
   draft's first OAuth flow. Keep tokens, private config and query strings
   out of logs and evidence.
   [ChatGPT callback requirements](https://developers.openai.com/plugins/build/auth#redirect-url)
4. On the approved Linux host, install the isolated package with its frozen
   lockfile in the candidate checkout. Run as the dedicated non-root service
   account with the reviewed Node runtime. Use an idle socket path and coordinate
   shutdown before starting the full stack on that same path.

## Private socket check

From the repository root, after provisioning, start the existing broker entry
point in a separate service session. Install dependencies as part of candidate
preparation if they are not already present.

```sh
pnpm --dir apps/web/tools/builder-auth install --ignore-workspace --frozen-lockfile
node apps/web/tools/builder-auth/production-main.ts
```

From a second session as the same service account, set
`BACI_AUTH_SOCKET` to the configured socket path, then assert discovery and
verify that JWKS contains ES256 public keys.

```sh
set -o pipefail
curl --unix-socket "${BACI_AUTH_SOCKET:?set configured socket path}" \
  --silent --show-error --fail --max-time 10 \
  http://builder-auth.usebaci.com/.well-known/openid-configuration |
  jq -e '.issuer == "https://builder-auth.usebaci.com" and
    .authorization_response_iss_parameter_supported == true and
    (.code_challenge_methods_supported | index("S256")) != null and
    .authorization_endpoint == "https://builder-auth.usebaci.com/auth" and
    .token_endpoint == "https://builder-auth.usebaci.com/token" and
    .jwks_uri == "https://builder-auth.usebaci.com/jwks"' >/dev/null
curl --unix-socket "$BACI_AUTH_SOCKET" \
  --silent --show-error --fail --max-time 10 \
  http://builder-auth.usebaci.com/jwks |
  jq -e '(.keys | length) > 0 and
    all(.keys[]; .kty == "EC" and .crv == "P-256" and
        .alg == "ES256" and (.kid | type) == "string" and
        (.x | type) == "string" and (.y | type) == "string" and
        (has("d") | not))' >/dev/null
```

A pass confirms role and upstream discovery checks at startup and the issuer's
local metadata and keys. It takes no user through authorization.

## Loopback qualification

As the dedicated non-root service identity, start the same real broker and the
existing auth bridge together. Stop the private-only entrypoint first if it is
running. Choose the distinct loopback port assigned by the operator.

```sh
node apps/web/tools/builder-production/auth-qualification-main.ts "${BACI_AUTH_PORT:?set the operator-approved loopback port}"
curl --fail --silent --show-error --max-time 10 \
  "http://127.0.0.1:${BACI_AUTH_PORT}/.well-known/openid-configuration" |
  jq -e '.issuer == "https://builder-auth.usebaci.com" and
    .authorization_response_iss_parameter_supported == true' >/dev/null
```

Run the probe from another terminal while the service is running. When changing
to the full stack, stop the standalone process before reusing its port and
private socket.

## Public qualification gates

- For a separately authorized HTTPS broker test, supervise the broker and the
  existing auth loopback bridge in the same service context, and qualify only
  the builder-auth host. Test its certificate, both discovery documents, JWKS,
  path denials and exact upstream callback. Repeat the commerce discovery and
  `/api` baseline checks. The auth listener's private socket remains inaccessible
  to HTTPS clients.
- For the ChatGPT flow, also deploy the real MCP transport with the installed
  user/RLS gateway. Test that
  `/.well-known/oauth-protected-resource/builder/mcp` returns the exact
  `https://builder-mcp.usebaci.com/builder/mcp` resource and
  `https://builder-auth.usebaci.com` authorization server, and that an
  unauthenticated JSON-RPC POST with `Content-Type: application/json` and
  `Accept: application/json, text/event-stream` returns a 401 challenge
  referencing that metadata. Discovery and challenge alone exercise
  neither the linked account nor its gateway.
- In the ChatGPT draft, sign in with a designated synthetic Baci account, verify
  the consent destination and linked-store identity, then exercise
  `list_storefronts` and `get_storefront_status`. Verify revocation or disconnect
  rejects the previous connection. Save only redacted evidence with candidate
  SHA, time and scope. Qualify build, preview and delivery in the full-stack
  test.
