# Baci merchant builder MCP — inactive source

Separate from Ogabassey buyer MCP and Muse. No existing resource, tool, submission
or deployment is changed. Only six implemented tools are advertised. Preview and
publication are not registered yet.

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

The standalone process has only public JWKS verification and an HTTPS forwarder.
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
BACI_GENERATE_BUILDER_CONTRACTS=1 pnpm --filter @baci/web exec vitest run tools/builder-contracts/contracts.test.ts && pnpm exec biome format --write apps/web/builder-mcp-server/contracts.json
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
