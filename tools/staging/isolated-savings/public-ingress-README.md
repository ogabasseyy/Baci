# Public HTTPS ingress preparation

`public-ingress.mjs` exports the pure function
`generatePublicIngress(receipt, inventory, now, enabled = false)`.
It returns `{config, receipt}` in memory, performs no I/O and installs nothing.
Inputs are the existing reviewed private-routing receipt and inventory plus an
explicit current epoch timestamp in milliseconds. Synthetic examples belong only
in tests. Passing `true` produces an enabled review candidate, not authorization
to install it. Non-boolean activation values are rejected.

The output is a single `server` block for inclusion in the shared nginx `http`
context. It listens on TLS port 443, checks the exact SNI and Host
`staging-auth.ogabassey.com`, and proxies only to `127.0.0.1:15440`.
No direct Docker destination, alternate upstream, resolver, port 80 listener,
certificate provisioning, shared include, root command or reload is generated.
Certificate paths are fixed:

- `/etc/letsencrypt/live/staging-auth.ogabassey.com/fullchain.pem`
- `/etc/letsencrypt/live/staging-auth.ogabassey.com/privkey.pem`

## Routes and authorization

The five Auth paths/methods match the current private generator: POST `otp`,
`verify`, `token`, `logout`; GET/PUT `user`, under `/auth/v1/`. REST routes and
methods come only from the validated receipt. No draft RPC or catalogue route is
added implicitly. The receipt is an operator-reviewed capability list, not proof
that an arbitrary REST table/RPC is safe to publish. Review the actual receipt
for the exact synthetic draft/catalogue scope before any enabled candidate.
Admin and signup paths are denied; all other paths return 404. OPTIONS is handled
locally for listed paths only and is never forwarded.

CORS is **not authentication**. Native clients may omit Origin for every approved
non-OPTIONS method, including POST OTP/verify/draft commands. Nonempty Origin must
be exactly `https://staging.ogabassey.com`; literal `null`, foreign origins, suffix
matches and multiple origins are rejected. OPTIONS requires that exact Origin,
an approved requested method and only allowlisted request headers. Responses
advertise the fixed origin, Vary, explicit methods/headers and zero preflight cache
age. No credentialed-cookie CORS is offered. Bearer authorization is forwarded
unchanged; Auth, server-derived identities and database RLS remain authoritative.
Cookies are neither forwarded nor returned. SDK metadata headers are permitted
in preflight but remain stripped by the existing private header whitelist.

Request/response buffering, cache/store, retries and payload logs are disabled.
Upstream CORS, cookies and redirects are suppressed; errors use constant JSON
bodies. Expected 401/403/404/405/409/422/429 statuses are retained; other configured
errors and redirects become 503. Nginx 1.30.3's parser accepts error-page status
codes 300–599 except 499, which is explicitly excluded; 444 also remains excluded
for connection-close host rejection. See the pinned
[nginx parser source](https://github.com/nginx/nginx/blob/release-1.30.3/src/http/ngx_http_core_module.c#L4674).
Custom error bodies intentionally hide upstream diagnostic details, including
Auth/PostgREST error codes; clients must tolerate generic failures. A 204 preflight
does not establish backend health or authenticated draft availability.

## Receipt lease and lifecycle

Output metadata hashes both this snippet and the exact private config/evidence;
it preserves the original five-minute expiry without renewal. Generation at or
after expiry is rejected. The snippet does not poll Docker or enforce wall-clock
expiry itself: withdrawal belongs to the existing private supervisor. It must run
with the matching reviewed private config and exclusive ownership of port 15440.
After withdrawal, proxied requests must return generic 503; local denial/preflight
responses can still succeed and must not be counted as backend readiness.

Container recreation, endpoint changes, unhealthy/stopped services, inspection
failure or lease expiry require supervisor withdrawal and fresh reviewed evidence.
No automatic renewal, container restart or persistent service is supplied here.
Retain the parent's lifecycle lock and supervisor parent-death protections.
Polling has a bounded detection/termination delay rather than atomic revocation;
in-flight requests may finish. Loopback does not authenticate its listener:
exclusive port/process ownership and the persistent supervisor lifecycle remain
deployment blockers, not properties this static snippet can prove.

## Validation and readiness

Run synthetic tests without network, Docker, nginx or new dependencies:

```sh
node --test tools/staging/isolated-savings/public-ingress*.test.mjs
```

Tests check emitted configuration, route/method/preflight regex matrices, disabled
default, exact origin/native behavior, header boundaries, receipt tampering and
lease expiry. They are not an nginx interpreter or live TLS verification.

Parent-reported prerequisites: VPS nginx 1.30.3; no staging-auth DNS A record, no
staging-auth certificate in the fixed directory, and no noninteractive sudo.
The owner agreed to run a reviewed root command later. No runnable installation
command is provided before DNS/certificate prerequisites and lifecycle review.

Parent's next parser/runtime rehearsal must use an isolated owner-only temporary
directory, a temporary self-signed certificate/key and an unprivileged loopback
TLS port. In a test-only copy, replace only the fixed certificate paths and listen
address, keeping all routing, headers and error handling unchanged. Wrap the
snippet in a minimal standalone `events`/`http` config with temporary PID/temp
paths, no system includes and no shared access log. Parse with the installed
nginx 1.30.3 using `-t -p <temporary-directory> -c <temporary-config>` as an
unprivileged user. Never read/copy a production key or reload shared nginx for this
test. Self-signed test artifacts must never replace the fixed deployment paths.

After parsing, parent-controlled temporary TLS checks must cover native originless
GET and POST, exact-origin preflight 204, requested-method/header denial, foreign
and missing-preflight Origin 403, user 401, admin/signup 403, unknown path 404,
bearer preservation, cookie suppression, generic errors, disabled candidate and
loopback-listener withdrawal. Use synthetic payloads only and stop the owned test
processes afterward. The separately owned `hosted-access-check.mjs` retains its
expected user 401/admin 403/signup 403/unknown 404 results; do not relabel backend
unavailability as success. Full shared-config parsing, real DNS/certificate chain,
actual TLS/CORS checks, persistent supervision and public authenticated browser/
native journeys remain separate readiness gates. No public readiness is claimed.
