# Direct Contabo ingress for builder MCP

The builder resource is `https://builder-mcp.usebaci.com/builder/mcp`. The public
MCP and OAuth protected-resource URLs terminate HTTPS at Contabo Caddy and
forward to the dedicated loopback MCP listener. The resource metadata advertises
`https://builder-auth.usebaci.com` as the authorization server. The commerce
connector continues to use `mcp.usebaci.com`. The owner bridge retains the
`owner.baci-internal.invalid` logical Host through the separate owner mTLS vhost.

`Caddyfile.candidate` routes only these two paths on the public MCP host:

- `/builder/mcp`
- `/.well-known/oauth-protected-resource/builder/mcp`

Caddy forwards the builder Host, replaces client-supplied forwarding IPs,
and sets `Cache-Control: no-store`. The listener still validates the Host,
origin, bearer issuer and exact resource audience.

## Qualify before activation

1. Inventory builder authorization connections, sessions, provider records
   and registered clients. November 13 evidence found zero connections,
   sessions and provider records with a non-exhaustive client search. Obtain
   a current inventory and reconcile any existing grants or clients against
   the dedicated resource before switching registration.
2. Review and validate the assembled Caddy candidate with the production
   ports and owner CA on Contabo. Check the listener and firewall boundaries.
   Confirm that both service hostnames point at the approved ingress and have
   valid TLS. November 15 DNS still returned Vercel addresses for both names.
3. Check the protected-resource document, matching challenge URL, dedicated
   issuer discovery and JWKS, and transport response. Check that the commerce,
   owner and execution paths on the builder public host return 404. Verify
   that the actual commerce connector still has the same discovery and tools.
4. Reconnect a synthetic ChatGPT client once the authorization broker and app
   configuration use the same resource. Confirm the old audience is rejected.

The earlier Vercel candidate evaluated two exact project rewrites. The
authenticated CLI observed zero published project routes and bulk redirects
on November 15. Direct Contabo ingress removes Vercel CDN requests and
transfer from this builder API path.

## Local qualification

```sh
python3 apps/web/tools/builder-production/ingress-routing-check.py
python3 apps/web/tools/builder-production/ingress-candidate-check.py
```

The tests run disposable loopback HTTPS using the candidate MCP vhost and
the assembled four-vhost candidate, including the Worker-authenticated
output origin. They check metadata forwarding, request bodies, no-store, exact
paths, host isolation, the origin key and owner certificate admission.
Production DNS, TLS, firewall, OAuth and release gates remain pending.
