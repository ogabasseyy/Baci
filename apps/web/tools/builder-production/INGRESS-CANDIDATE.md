# Contabo ingress candidate

`Caddyfile.candidate` is an uninstalled, unreviewed candidate, not a production
configuration or permission to open ports. Its four hostnames must be distinct,
operator-reserved, and matched to the private builder configuration. The delivery
host must also satisfy the existing separate-registrable-domain constraint.
Use bare DNS hostnames, not URL strings, in the four host variables. The auth
host must be `builder-auth.usebaci.com`; the MCP origin host is a separately
reserved upstream name, not the existing public `mcp.usebaci.com` hostname.
Each port variable must match its corresponding configured loopback listener.

The auth and MCP origin hosts forward only their fixed paths. The owner host
requires a client certificate trusted by a dedicated owner CA, and forwards only
the three owner paths. The execution host serves only GET output paths. Caddy
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

On 14 November, the synthetic smoke also passed on Contabo `vmi3734186` using
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
`BACI_OWNER_MTLS_KEY`. Missing or invalid configuration leaves preview and
approval disabled. These settings are not provisioned or deployed, and their
production hostname, certificate lifecycle, rotation, trust and live failure
behavior remain unqualified. Public MCP routing also requires a separately reviewed
Vercel rule for the exact MCP and protected-resource paths, preserving the
existing commerce connector. The forwarded IP observed through Vercel may be
an edge address shared by many users; validate rate-limit behavior rather than
trusting a spoofable forwarded header. The 600-second verifier path and graceful
shutdown need qualification against every actual proxy and application deadline.

Do not activate builder OAuth, owner routes, the runner or delivery merely because
the local smoke passes. Required reviews, CI, private-draft recovery, data and
grant inventory, production credentials, rollout and negative ingress tests are
separate release gates.
