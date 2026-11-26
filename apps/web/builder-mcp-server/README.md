# Baci merchant builder MCP — inactive source

Separate from Ogabassey buyer MCP and Muse. No existing resource, tool, submission
or deployment is changed by this source. The default listener advertises the
portable-homepage tools; full-code tools require explicit opt-in.

## Commands

From the repository root:

```sh
pnpm --filter @baci/web typecheck:builder-mcp
pnpm --filter @baci/web build:builder-mcp
pnpm --filter @baci/web exec vitest run builder-mcp-server tools/builder-contracts src/lib/builder-gateway
```

An explicitly requested local listener can use `pnpm --filter @baci/web mcp:builder
8790`. It binds loopback only. Public resource/issuer and the fixed Baci execution
origin are constants, not tool arguments. No listener starts merely by importing
`server.ts` or `node.ts`.

The builder authorization server's issuer is `https://builder-auth.usebaci.com`; its
OAuth discovery, authorization, token, JWKS, interaction and callback paths
must be routed to the separately deployed builder auth service. The MCP path
and protected-resource metadata route on `https://builder-mcp.usebaci.com` go
straight through Contabo Caddy to the MCP listener. The existing
`auth.usebaci.com` service remains the upstream Supabase identity provider.

The dedicated builder issuer and resource invalidate previously issued builder
tokens with old claims. Before activation, inventory any live builder clients and
grants, configure and verify the new issuer and callback, and coordinate
re-authorization and token reissue where needed. This listener accepts only
the configured builder issuer; it does not accept commerce connector tokens.
Do not redirect or replace the existing commerce issuer as part of this rollout.
Do not enable the new issuer until that inventory and cutover are complete;
if existing builder grants cannot be identified or safely reauthorized, keep
the builder integration disabled. The issuer change is not a transparent
dual-issuer migration.

The consent page limits the upstream response to the dedicated broker callback.
The broker binds the callback to the browser's saved transaction, and its
upstream adapter checks state, exchanges the code with the original PKCE
verifier and dedicated client credentials, and checks the returned nonce.
The [upstream integration test](../tools/builder-auth/upstream-integration.node.test.ts)
rejects corrupted state, nonce, and verifier values against disposable GoTrue.
The live callback and issuer still require qualification before activation.

The owner-preview and verifier v1 signatures cover canonical sorted-key JSON of the
schema-validated message, not raw wire JSON. Callers validate and serialize with
sorted object keys before signing; admission and downstream handlers validate the
message against the same strict schema and recompute the HMAC over sorted-key JSON.
The client/bridge tests cover reordered input and wire fields. Treat a signing-format
change as a coordinated protocol rollout.

Production ingress is not yet qualified, and a proxy's loopback address is not
proof that a request is private. Require an independently verified ingress boundary
that prevents public access to those routes. Preview transport now signals
cancellation on timeout or disconnect, and retains its concurrency slot until
the underlying work actually settles. The preview and verifier attestation
handlers check cancellation between operations; this does not cancel database,
runner or attestation work already in flight. End-to-end cancellation or a
separately qualified bounded-work strategy remains required before enabling
the owner bridge.

The owner transport also rejects duplicate signed nonces in a bounded,
expiry-aware per-process filter before reserving a long-running work slot.
That filter resets on restart and is not shared between replicas; the existing
durable verifier and preview nonce checks remain authoritative. A replay
rejected by the early filter receives an admission denial, and the filter
fails closed at capacity. This does not qualify the 600-second downstream work
deadline or replace production ingress and load testing. On the verifier,
attestation, public verification and build verification share two
long-running slots, with at most one operation per authenticated owner.
The owner preview route enforces a separate per-owner concurrency slot (at most
one active preview launch per authenticated owner) within its 16 global active slots.
Build verification and the public observer each allow one concurrent request.
Busy verifier requests receive 429. Build verification retries admission for
up to 75 seconds; a linked build can be reclaimed after its lease expires if
the verifier stays busy. Slots stay reserved until work settles, even on
disconnect. Verify remaining capacity and deadlines on the deployed topology.
Owner draft and publication preparation requests use slices of at most 100
seconds and reuse completed route evidence. The attestation relay retains its
600-second outer deadline. Verify that disconnected work settles and frees its
slot under concurrent requests, and that the durable nonce check rejects
replays across restarts and replicas before enabling the owner bridge.

`owner-internal-node.ts` provides a separate loopback-only owner listener.
The production composition requires a distinct configured owner port and does
not attach owner routes to the MCP listener. This source change does not
provide TLS, mutual authentication, or a private network path. The live
topology has not been updated or qualified; local separation tests are not
deployed ingress evidence. The candidate web preview and draft-approval
callers require the dedicated mTLS transport and fail closed without its
private configuration. The MCP-host URL in their clients is a fixed logical
route mapped by that transport, not a network fallback. Public verification
also requires an explicit transport and is not installed for publication.
Certificates, private ingress, deployment and live negative tests remain
unqualified, so owner preview and attestation must remain disabled.

Pass `--experience` before or after the port to advertise the full-code experience tools.
The default listener keeps those tools disabled. Discovery does not install the
web gateway or the isolated runner.

The standalone process has only public JWKS verification and an HTTPS forwarder. Serve
only the MCP endpoint and its metadata on the allowlisted MCP origin. Serve
merchant-authored pages on the separate execution origin.
It accepts the dedicated outer builder token, never a normal Supabase token. The
private gateway independently verifies issuer/audience/expiry and live canonical
consent, then resolves the dedicated upstream user session and normal RLS client.
Request-local stateless servers retain no bearer or identity across requests;
MCP session headers cannot establish authority.

## Contracts and SDK compatibility

`contracts.json` is generated from the canonical web Zod schemas. It avoids pulling
the web business-type template registry into the standalone process. Regenerate
only when the canonical schemas change:

```sh
BACI_GENERATE_BUILDER_CONTRACTS=1 pnpm --filter @baci/web exec vitest run tools/builder-contracts/contracts.test.ts
```

The same test, without that flag, checks parity and writes nothing. Runtime web
validation still performs transformations and semantic refinements that JSON
Schema cannot express. Wire validators reject unknown input/output fields; error
text is reconstructed from safe codes.

The installed SDK (`server`/`client` 2.3.1, `node` 2.1.1) omits unknown top-level
registration fields. Discovery therefore mirrors the same checked per-tool OAuth
policy at top-level `securitySchemes` and `_meta.securitySchemes` using a supported
low-level tools/list handler. Every result branch is an object. The SDK's Standard
Schema output adapter declares that object root explicitly to avoid legacy codec
`{ result: … }` wrapping inconsistencies with stateless HTTP. In-memory and real
HTTP SDK clients verify this behavior.

## Gateway and release gates

`createBuilderGatewayRuntime` composes Task 3 authentication/session dependencies
with Tasks 4–7 services. A release bootstrap must explicitly install it in the
Next process using `installBuilderGateway`. The production route also requires
both existing release flags; they remain false. Unconfigured/disabled routes return
503. No auth-storage credential, private key, environment variable or runtime
bootstrap was provisioned by this task.

The gateway applies process-local stable user/connection throttles, rechecks tool
scopes, and emits allowlisted best-effort telemetry. Durable mutation evidence and
AI quotas remain in the underlying SQL transactions. An uncertain response is not
retried automatically: read status/reconcile using the existing retry key.

Production builds require the linked owner connection. The database claims the
same job for a synchronous or background worker, with a ten-minute lease.
Renewal runs every two minutes and cannot extend past job expiry. Recovery rotates the attempt
nonce only after the lease expires. The enqueue key deduplicates creation.
Background finalization uses the persisted job ID as its retry key, while
synchronous finalization accepts a caller key. Both rely on the same locked
job and attempt for finalization. A retry after finalization recovers that job's
existing result.

The HTTP challenge handles token validation, including the broker's required
base read scope. A valid builder token missing a tool-specific scope receives
`insufficient_scope` with the required scopes in the MCP tool result's
`_meta["mcp/www_authenticate"]`. Use that challenge to request broader consent.

MCP request size is 64 KiB; HTTPS backend responses are bounded to 128 KiB with a
25-second timeout. Redirects, alternative origins, cookie fallback, unimplemented
tools and foreign browser origins are rejected. The existing proxy permits normal
server requests without Origin; neither proxy source nor its browser categories
were changed.

Actual provisioning, canonical DNS/TLS, private gateway/session bootstrap, staged
HTTP/owner QA, real ChatGPT linking and separate deployment remain Task 9 release
gates. Both existing submissions remain protected.

## Private homepage preview (Task 7)

Seven tools are now discoverable. Only `preview_storefront` owns UI metadata. It
requires the exact current homepage revision and returns a safe real-identity /
active-catalog projection, launch readiness, and inert rendering controls. Other
pages and unsupported layouts require the authenticated Baci editor. Publication
is not implemented. The service checks canonical consent and revision both before
and after projection reads using the normal linked-user client.

The explicit workspace package `@baci/builder-preview-widget` has independent
build, test, lint and typecheck scripts discovered by Turbo. `build:builder-mcp`
builds its self-contained HTML and copies it beside the standalone server. The
source CLI likewise requires building the widget first. A missing artifact fails
resource reading, never falls back to a stale buyer widget.

Resource `ui://baci-builder/home-preview-v1.html` is tenant-neutral code with
`text/html;profile=mcp-app`. Use a new URI for incompatible changes. Its CSP has
no API connections or embedded frames; images are restricted to the checked static
origins in `builder-preview-assets.ts`, with only public Supabase object paths
accepted by the projection. Signed/query-bearing URLs are rejected. No token,
customer data, persistent browser storage, or native `window.openai` bridge is used.

The bridge uses the installed MCP Apps 2.0.3 SDK, negotiates inline/fullscreen,
uses host theme, clears snapshots on input/error/cancellation/teardown, and reports
height after DOM changes and late connection even without ResizeObserver. The
only external action opens the fixed authenticated Baci editor through the host.
Production gateway activation and real ChatGPT host QA remain Task 9 gates.

The loopback listener trusts only the local reverse proxy (`127.0.0.1`/`::1`) for client-IP rate limits. Configure that proxy to **overwrite** `X-Forwarded-For` with the connecting client address (`proxy_set_header X-Forwarded-For $remote_addr`), never append a caller-controlled header. Other socket peers cannot select their limiter identity through forwarded headers.
