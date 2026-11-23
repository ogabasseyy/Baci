# Contabo ingress candidate

`Caddyfile.candidate` contains the auth, public MCP and owner vhosts. Use bare
DNS hostnames for `BACI_AUTH_HOST` and `BACI_OWNER_HOST`. Set the auth host to
`builder-auth.usebaci.com` and the owner host to `builder-owner.usebaci.com`.
The public MCP host is fixed to `builder-mcp.usebaci.com` and terminates TLS directly at Contabo. Each port
variable must match its corresponding configured loopback listener.

Combine those vhosts with the output-only site from the
[execution proxy candidate](../../../builder-execution-proxy/Caddyfile.candidate).
Retain one global log filter when assembling the configuration. The output
origin requires the Worker origin key, and browser execution uses the
separate Workers hostname.

The auth and public MCP hosts forward only their fixed paths. The owner host
requires a client certificate trusted by a dedicated owner CA, and forwards only
the three owner paths.
The owner vhost sends a fixed `owner.baci-internal.invalid` Host to the loopback listener.
It is an internal protocol identifier. Owner HTTPS traffic dials the configured
mutual TLS origin, and public MCP listens on `builder-mcp.usebaci.com`. Caddy
overwrites forwarded IP information instead of trusting arbitrary client input.
There is no access-log directive; deployment must independently confirm that
the proxy and every upstream avoid logging bearer tokens, request bodies and
private URLs.

Run the disposable HTTPS and client-certificate smoke test with:

```sh
python3 apps/web/tools/builder-production/ingress-candidate-check.py
```

It requires locally installed Caddy 2.11, curl and OpenSSL. It uses synthetic
certificates and temporary loopback listeners. It tests routing and the owner
TLS client certificate boundary, not the real builder, Vercel, DNS, certificate
issuance, provider callback, rate limits or rollout. It intentionally disables
server-certificate verification only for its disposable local Caddy CA.

Before any deployment, independently review and qualify the exact Caddy binary,
hostnames, certificate lifecycle, source allowlists, firewall and rollback.
Current Contabo inspection found Caddy absent, only SSH allowed through UFW, and
the Ubuntu repository offering Caddy 2.6.2; the local smoke used Caddy 2.11.4.
Do not assume the older package supports this configuration. Confirm automatic
TLS issuance without interfering with existing services.

On 14 November, the previous ingress candidate passed the synthetic smoke on Contabo `vmi3734186` using
a temporary loopback-only listener and Caddy 2.11.4. The downloaded official
Linux AMD64 archive matched SHA-256
`527fbf917c39189a1e3b31d34fa955601680b2d5c8055d2a87b8b9588dec7bb9`.
The Caddyfile SHA-256 was
`18a28e348e2346d4ed4084838cc74e3d250ee3a38e72f7509dd3227c1cf6c61a`
and the smoke script SHA-256 was
`af8dc942516e6804bc735b2f189feac71bf67a7e80f51d80ad83b39b16d6b5af`.
The temporary directory and processes were removed after testing. No public
port, firewall rule, DNS record, persistent installation or production service
was changed. This is not live OAuth or deployment qualification.

The candidate web clients can use a fixed, mutually authenticated owner HTTPS
transport configured by `BACI_OWNER_MTLS_ORIGIN`, `BACI_OWNER_MTLS_CERT` and
`BACI_OWNER_MTLS_KEY`. Set `BACI_OWNER_MTLS_ORIGIN` to
`https://builder-owner.usebaci.com`. Missing or invalid configuration leaves
preview and approval disabled. Certificate lifecycle, rotation, trust and live
failure behavior remain unqualified. The direct public MCP host has exact MCP and
protected-resource paths. Caddy sends the actual connecting address to the loopback listener.
Validate rate-limit behavior through the direct production connection. The
600-second verifier path and graceful shutdown need qualification against
every actual proxy and application deadline.

The builder also requires a private `rendererDatabaseUrl` for the same
PostgreSQL host as `previewDatabaseUrl`. Use [the restricted login provisioner](./provision-renderer-reader-login.sql)
to create `baci_experience_renderer_reader_login` with only the
`baci_experience_renderer_reader` role after the renderer migration. The connection uses verified TLS,
and the role can resolve renderer bytes only for the exact current published
binding. The independent verifier stores new renderer bytes with its
evidence, and linked owners read through their normal data API authority.
Keep the existing artifact volume available for legacy builds and recovery
until all protected rollback targets have durable renderer evidence.

The public MCP listener exposes full-code tools only with the background build
worker and independent verifier configured. With `"backgroundBuilds"` absent,
the listener can serve OAuth and legacy builder discovery during qualification.
Enable `"backgroundBuilds": true` after the worker, verifier and recovery path
are qualified.

Do not activate builder OAuth, owner routes, the runner or delivery merely because
the local smoke passes. Required reviews, CI, private-draft recovery, data and
grant inventory, production credentials, rollout and negative ingress tests are
separate release gates.

Before the direct Contabo ingress decision, 15 November read-only checks
found that `mcp.usebaci.com/builder/mcp` redirected to the marketing site and
the old builder protected-resource metadata path returned 404. The existing commerce `/api` returned 200. The
proposed `builder-auth.usebaci.com` hostname currently reaches Vercel and its
authorization-server metadata returns the existing Supabase issuer, rather
than proving that the separate builder issuer is live. Treat this as an
unconfigured hostname, not a successful builder OAuth discovery. These checks
did not authorize a user, obtain a token or exercise MCP tools.

## Isolated execution hostname

The production origin validator requires a different registrable cookie site
from the merchant and Baci hosts. An `output.usebaci.com` subdomain therefore
does not satisfy the contract. Locally, `tldts` with private suffixes enabled
classifies a dedicated `*.vercel.app` or `*.workers.dev` hostname separately,
but that classification alone does not establish ownership, routing, cost,
privacy or production readiness.

The current private preview places random bearer-like resource tickets in URL
paths. Vercel documents that runtime logs can include the actual request path
and rewrite activity ([runtime logs](https://vercel.com/docs/logs/runtime)).
Do not route private preview traffic through an assumed free Vercel rewrite
until request logs, drains, access controls, retention, caching, and any ticket
redaction are independently verified for the exact deployment. Nor should an
unrelated existing domain be repurposed solely because it appears in the same
account. A dedicated owned domain with access-controlled DNS and a direct,
qualified no-path-logging ingress remains an option; no such domain has yet
been selected for this candidate.

Cloudflare's `workers.dev` host is another separately classified candidate,
but Cloudflare describes it as intended for personal or hobby projects rather
than business-critical production. Its Workers Logs documentation also says
fetch invocation messages can contain the request URL; disabling invocation
logs alone does not establish that all other logging, drains, traces and caches
are safe. It may be evaluated for isolated synthetic QA after account access,
limits, origin authentication and logging are verified, but it is not yet a
qualified production delivery domain. See [workers.dev guidance](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
and [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

For either provider, preserve the public execution hostname when validating the
browser origin; a proxy may need a separate authenticated upstream hostname on
Contabo with its own valid TLS certificate. Do not assume a provider can issue
an origin certificate for its shared platform hostname. Verify end-to-end Host
handling, cache bypass, no ticket disclosure, ownership and actual account
costs before routing even synthetic traffic; do not expose private previews or
enable merchant delivery based only on public-suffix classification.
