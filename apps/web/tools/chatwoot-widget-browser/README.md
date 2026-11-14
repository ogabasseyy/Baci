# Synthetic Chatwoot browser lifecycle check

This disposable browser fixture imports the real `ChatwootWidget` from
`src/components/storefront/chatwoot-widget.tsx` and loads the SDK from the
locally running synthetic Chatwoot server. It checks that tenant A reaches
`chatwoot:ready`, a tenant switch on checkout defers reload, and the actual
SDK reset removes tenant A's conversation binding before tenant B becomes
ready on a safe route. In an isolated browser context, the fixture sends one
uniquely tagged synthetic message through tenant A's widget and verifies that
the message is visible in A but absent from B's widget. It also checks that a
fresh context has no stale Chatwoot cookies and that B's initial document
does not carry A's inbox cookie.

The cart bridge is replaced with a display-only fixture because its real
adapter requires a hydrated storefront cart and server bridge endpoints. The
test does not exercise the cart bridge API. The message uses only the named
disposable Chatwoot runtime and contains no customer data. Production origin
validation is unchanged: both rendered storefront and platform origins use
strict HTTPS.

The harness expects the isolated synthetic Chatwoot server at
`http://127.0.0.1:43119` and two different public website tokens for its seeded
synthetic tenants. Supply them through `CHATWOOT_SYNTHETIC_TOKEN_A` and
`CHATWOOT_SYNTHETIC_TOKEN_B`, or through `CHATWOOT_SYNTHETIC_TOKENS_FILE` with
a private temporary JSON file shaped as `{ "a": "...", "b": "..." }`.
They are embedded only in the local fixture's browser bundle and are not logged
or written to the repository.

Run with the repository's existing Node dependencies and local Caddy binary:

```sh
CHATWOOT_SYNTHETIC_TOKEN_A=... \
CHATWOOT_SYNTHETIC_TOKEN_B=... \
node apps/web/tools/chatwoot-widget-browser/run.mjs
```

The runner uses `https://localhost` origins on separate ports 43128/43129,
with listeners bound only to IPv6 loopback `::1`. This avoids stopping or
replacing the existing HTTP harness/runtime on `127.0.0.1:43118` and
`127.0.0.1:43119`. It creates and deletes a one-day self-signed localhost
certificate under a temporary directory and uses
Playwright's isolated `ignoreHTTPSErrors` browser context only for that local
test. It makes no OS trust-store changes, external browser tab, production
request, deploy, or production configuration change. Browser requests to any
host other than `localhost` are blocked and cause the test to fail.

The test should run only against the named disposable Chatwoot runtime. It
creates one synthetic message in tenant A through the real SDK widget; it does
not create orders or payments. The SDK's widget-ready flow also creates
synthetic visitor session cookies used to verify tenant isolation.

For reset-race diagnostics, `CHATWOOT_FIXTURE_RESET_DELAY_MS` accepts an
integer from 0 to 2000 and delays only the fixture's document reload after
the SDK reset call. The default is 0, matching the normal lifecycle. The
fixture records whether a post-reset SDK `loaded` or `setAuthCookie` message
restores tenant A's cookie, without recording cookie values or message
payloads. It also sends a harmless synthetic `loaded` message from a sandboxed
opaque-origin iframe and reports whether the SDK handler accepts it. These
diagnostics exercise the local SDK and fixture CSP; they do not change
production code.
