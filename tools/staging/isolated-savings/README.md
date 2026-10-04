# Isolated savings infrastructure — local parent-review bundle

## Private routing generator (2026-09-14, not deployed)

Parent reports all four services healthy, host-direct Auth `172.23.0.4:9999` and
REST `172.23.0.3:3000` returning HTTP 200, and Auth requests to synthetic host
listeners at both bridge gateways (`172.23.0.1:15999`, `172.22.0.1:15999`) blocked.
Those listeners were closed. These are parent-supplied results, not tests performed
by this generator. Docker's internal-only port-publishing behavior is also reported
in [Moby discussion 53256](https://github.com/moby/moby/discussions/53256).
The generated nginx connects directly to validated container IPs; no network or
firewall changes are needed or performed. Existing Compose remains unchanged.

`generatePrivateRouting(receipt, inventory, now, 'unprivileged-test')` in
`private-routing.mjs` is pure: no Docker, network, filesystem writes or implicit
clock. The CLI reads sanitized JSON from stdin, uses the current clock and prints
`{config, receipt}`. It cannot install, reload, start nginx or invoke sudo.

```sh
node --test tools/staging/isolated-savings/private-routing*.test.mjs
node tools/staging/isolated-savings/private-routing-cli.mjs --unprivileged-test < verified-routing-input.json
```

Save stdout as `routing-output.json` in the owner-only test directory. Extract
`config` with `jq -r '.config' routing-output.json > nginx.conf`, retain the output
receipt, then use the unprivileged nginx commands below. No live IDs are embedded
in the generator; the parent must recapture the complete projections.

### Evidence input contract

Input has exactly two fields, `receipt` and `inventory`. Use the shape in
`private-routing.test-support.mjs` as a synthetic example, never as deployment
evidence. Parent must collect fresh **projections**, not full Docker inspect output
(which contains secrets). Required Docker projection fields are enforced by
`private-routing-inventory.mjs`:

- Inventory `observedAt`, exactly Auth/REST `containers`, and both `networks`.
- Container `Id`, `Name`, `Config.{Image,Labels}`, `State.{Running,Health.Status}`,
  `HostConfig.{NetworkMode,RestartPolicy,Privileged}` and
  `NetworkSettings.Networks[networkName].{NetworkID,EndpointID,IPAddress,IPPrefixLen}`.
- Network `Id`, `Name`, `Driver`, `Internal`, `EnableIPv6`, `Labels`, `Options`,
  `IPAM.Config` (one `Subnet`/`Gateway` entry), and `Containers` membership entries
  with `Name`, `EndpointID`, `IPv4Address` (unrelated member fields are unused).
- Receipt `version:1`, exact `host:'staging-auth.ogabassey.com'`, `verifiedAt`,
  `firewallVerified:true`, `hostReachabilityVerified:true`, `containers.auth/rest`
  each containing independently verified `{id,ip,endpointId}`, `networks.database/mail`
  each containing `{id,subnet}`, and explicit `restRoutes:[{path,methods}]`.

Receipt and inventory must be no older than five minutes, not future-dated, and
inventory must be collected at or after receipt verification. Only healthy owned
containers with the pinned images, restart disabled and the exact two internal
bridges are accepted. Container/network endpoint membership, private subnet,
gateway exclusions, IDs and addresses must agree. Additional container networks,
injected config text, full Config.Env payloads and alternate hostnames are rejected.
Receipt booleans and labels do not cryptographically prove ownership: the parent
collecting evidence and controlling Docker remains the trust boundary.

### Unprivileged nginx test boundary

Only `unprivileged-test` mode is implemented. Output is a standalone nginx config,
with foreground operation, no master privilege transition, relative PID/temp
paths, and **one listener: `127.0.0.1:15440`**. No public TLS listener, certificates,
DNS, site installation or permission grant exists. The owner-run firewall helper
does not grant nginx or this generator sudo access.

Parent can save `config` as `nginx.conf` inside a newly created, owner-only writable
test directory, with its paired receipt beside it. Verify port 15440 is unused.
Using an already installed nginx, run these as the ordinary user, replacing the
absolute directory path; `-e /dev/null` also suppresses startup/parser payload logs:

```sh
nginx -p /absolute/private-test-directory/ -c nginx.conf -e /dev/null -t
nginx -p /absolute/private-test-directory/ -c nginx.conf -e /dev/null
```

The second command stays in the foreground; stop that process after testing.
Do not use `sudo`, `systemctl`, `nginx -s reload`, existing nginx PID files or
existing site directories. Test requests must carry `Host: staging-auth.ogabassey.com`;
other hosts close with 444. Full public-TLS integration remains a separate review.

Exact allowed Auth locations: POST `/auth/v1/otp`, `/verify`, `/token`, `/logout`
(all under `/auth/v1`), and GET/PUT `/auth/v1/user`. `/auth/v1/admin*` and `/signup`
are denied; every other path is denied. Auth's existing server-side signup disable
must remain enabled: OTP cannot be used to create unseeded identities. Verify uses
POST only; emailed GET links, OAuth, browser CORS preflight and signup are not enabled.
REST only exposes receipt-approved exact table or `rpc/name` paths and methods;
there is no wildcard REST forwarding or schema-discovery root. Approving a route
does not replace PostgREST JWT/RLS or RPC authorization. The generator never creates
API keys and does not provide gateway API-key validation; send only staging client
credentials, never service-role keys, through the client route.

Body size is capped at 64 KiB; connect timeout is 2 seconds, body/send timeouts 10
seconds and upstream read/client send timeouts 15 seconds. These are nginx inactivity
timeouts, not a total request deadline. Retries, cache, disk buffering, access logs
and error-log output are disabled. Incoming headers are dropped by default; only
explicit auth/content/range/preference headers pass. Host/proto/forwarded headers
are overwritten; client forwarding chains and cookies are not trusted. Behavior
follows the official [proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
and [HTTP core](https://nginx.org/en/docs/http/ngx_http_core_module.html) contracts.

### Mandatory lifecycle gate

Output receipt binds exact container and network IDs, config/evidence SHA256 hashes
and a five-minute pre-install verification deadline. Re-run generation with a fresh
inventory immediately before parser/runtime activation and compare the paired
config hash. Never activate an old artifact against a refreshed receipt alone.
Recreated containers—even with reused names/IPs—reject the previous input receipt.
Changed network IDs, endpoint IDs or IPs likewise require new verified evidence and
regeneration. Hold the parent lifecycle lock throughout verification/activation.

**Static nginx does not watch Docker and cannot revoke stale routes automatically.**
Before stopping/recreating/disconnecting staging containers or networks, stop this
test nginx process and disable any future staging ingress. Only regenerate/restart
after new verified identities. The receipt deadline is enforced by the generator,
not nginx. Unattended routing remains blocked until a staging-only lifecycle owner
can withdraw ingress on identity/health changes; no such supervisor is installed.
This limitation also applies to unexpected failures and possible IP reuse.

Tests use synthetic inventory only and make no network requests. Local nginx is
unavailable, so nginx parser/runtime behavior still requires the parent's ordinary-
user check. No route has been deployed by this task.

Automatic container restart is deliberately disabled. The private firewall setup
installs only staging INPUT rules and a root-owned service; it neither starts nor
reorders the shared Docker daemon. Before unattended operation, a separate
staging-only supervisor must require successful firewall verification. Do not
enable Docker restart policies as a substitute. For the initial private rehearsal,
verify isolation immediately before explicitly starting owned containers.

This renders an executable Docker Compose **template**, not a deployed or tested
hosted backend. No containers, secrets, DNS, providers or remote resources are
created by these tools. Node 22+ and Docker Compose v2 supporting
`config --no-env-resolution` are required for the local tests.

```sh
node --test tools/staging/isolated-savings/*.test.mjs
node tools/staging/isolated-savings/render.mjs --template
```

The renderer prints JSON, which Compose accepts directly. It always retains
required-variable placeholders, even when the calling shell has credentials.
It accepts no destination, deployment, shell command or environment-file argument.
The bootstrap bind source is absolute: render again from the final installed
bundle location before later deployment. Missing bind sources fail rather than
silently creating a directory. Do not execute containers before parent review.

## Official contracts checked 2026-09-13

- [Supabase Docker guide](https://supabase.com/docs/guides/self-hosting/docker)
- [Official release Compose](https://github.com/supabase/supabase/blob/8c7a4d9dbbaf8b552893822e89d7bf06f33f9220/docker/docker-compose.yml)
  (`self-hosted/v0.8.1`, commit `8c7a4d9dbbaf8b552893822e89d7bf06f33f9220`)
- [Role password initialization](https://github.com/supabase/supabase/blob/8c7a4d9dbbaf8b552893822e89d7bf06f33f9220/docker/volumes/db/roles.sql)
  and [JWT database settings](https://github.com/supabase/supabase/blob/8c7a4d9dbbaf8b552893822e89d7bf06f33f9220/docker/volumes/db/jwt.sql)
- [Auth configuration](https://supabase.com/docs/guides/self-hosting/auth/config)
- [Mailpit official image](https://mailpit.axllent.org/docs/install/docker/)
  and [release v1.31.1](https://github.com/axllent/mailpit/releases/tag/v1.31.1)
- [Docker internal networks](https://docs.docker.com/reference/compose-file/networks/#internal)

Version tags are pinned to official published images, not mutable `latest` tags;
registry digests and target architecture still require verification before launch.
The pinned official release Compose above declares `supabase/postgres:17.6.1.136`,
`supabase/gotrue:v2.196.0` and `postgrest/postgrest:v14.17`. The Mailpit official
release and image documentation establish `axllent/mailpit:v1.31.1`; its pinned
[Dockerfile](https://github.com/axllent/mailpit/blob/v1.31.1/Dockerfile) establishes
the `/mailpit readyz` health command.
No images have been pulled or executed. The official Postgres image supplies base
roles/schemas; Auth performs its own migrations. The additional first-boot SQL
sets passwords for Auth/PostgREST, disables unused service logins, and sets JWT
settings. It does not install Baci schema or replay migrations. First-boot SQL does
not rerun on existing volumes; never rotate secrets by simply changing variables.

## Minimal closure and boundaries

Postgres, Auth, PostgREST and Mailpit are the only services. Omitted services include
Studio, postgres-meta, poolers, Storage, Realtime, Functions, analytics and gateway.
Auth and REST depend on healthy Postgres; Auth additionally waits for mail startup.
All four services have health checks. OTP delivery must still be verified later.
Public signup is disabled. Synthetic identities must be created through a separately
reviewed internal Auth admin setup; there is no new-account signup surface.

Postgres and mail have no published ports. REST's admin listener binds container
localhost. Auth and REST publish only VPS loopback 15439 and 15430 respectively.
There is no public route, admin dashboard or mail UI route. A later host reverse
proxy can strip `/auth/v1/` to Auth port 15439 and `/rest/v1/` to REST port 15430.
This is not the Supabase CLI development stack and is not a complete API gateway.
Before public ingress, parent review must supply TLS, access control, API-key
handling, CORS, request limits, and explicit blocking of Auth `/admin` routes.
Do not forward arbitrary paths or publish these ports on all interfaces.

Both bridges are internal, IPv6 disabled, with no external/shared networks, host
networking, Docker socket, or external endpoint inputs. Mail only shares a network
with Auth. Explicit loopback DNS prevents upstream DNS forwarding while Docker's
embedded DNS resolves service names. No SMTP relay/forwarding, SMS, OAuth, hooks,
payment clients, production DSNs or app processes are configured. Email confirmation
stays enabled; messages are captured internally and are ephemeral/bounded.

Docker internal networks isolate routed external traffic, **not the Docker host**.
Before launch, host firewall review must deny new container-to-host connections
(including host proxies/production listeners) while permitting established replies
to loopback ingress. Verify DNS and HTTP/SMTP egress failure on the target engine.
Do not attach these services to an existing VPS proxy network. Host root/Docker
administrators remain trusted. This bundle cannot attest to an uninspected VPS.

## Later secure setup — explicitly not performed

After parent review and explicit authorization, a secure setup must supply four
independent staging-only values through a controlled process environment:

| Required variable | Recipients / purpose |
| --- | --- |
| `ISOLATED_POSTGRES_PASSWORD` | Postgres only; root database credential |
| `ISOLATED_AUTH_DB_PASSWORD` | Postgres bootstrap and Auth; `supabase_auth_admin` only |
| `ISOLATED_REST_DB_PASSWORD` | Postgres bootstrap and REST; `authenticator` only |
| `ISOLATED_JWT_SECRET` | Postgres JWT setting, Auth signing and REST verification |

Use independently generated high-entropy 64-character lowercase hexadecimal
values; never reuse production values. Role passwords are assigned using distinct
psql variables, not the root password. Auth/REST never receive the root credential.
Hexadecimal passwords avoid URI and shell encoding ambiguity. There
are no defaults and no secret generation command in this bundle. Compose enforces
presence; `preflight.mjs` additionally enforces format and pairwise inequality.
Neither can prove entropy or provenance: later secure setup must validate those.
Repeated test-only strings in unit tests are not usable provisioning credentials.

`ISOLATED_API_ORIGIN` is the dedicated HTTPS root origin, without a trailing slash.
The renderer derives server `API_EXTERNAL_URL` as that origin plus `/auth/v1`, per
the pinned official `.env.example` (not the root URL used by older examples).
`ISOLATED_AUTH_ISSUER` is separately required and validated to equal the same
`/auth/v1` URL. Mobile `supabaseOrigin` receives the root origin and
`expectedAuthIssuer` receives `/auth/v1`, matching the existing mobile contract.
`staging-auth.ogabassey.com` is a proposal, **unverified**. `ISOLATED_SITE_URL` must
be a separately reviewed exact staging client redirect URL; do not use wildcards,
production redirects or assume existing registration hosting is the client.
The existing `staging.ogabassey.com` Vercel registration endpoint remains untouched.
This template uses official legacy HS256 support; signed public anon keys and any
server-only service-role key require later secure setup. New opaque API keys need
a reviewed gateway and are not interchangeable with bearer JWTs here.

Later, render to a private new directory and run Compose with explicit `-f`, fixed
project `baci-isolated-savings`, and `--env-file /dev/null` in a sanitized environment.
Never let ambient `COMPOSE_FILE`, project overrides or repository dotenv files
select a different stack. Avoid printing interpolated `compose config` or inspect
output: runtime container environment is visible to Docker administrators.
After all launch blockers are closed, normal lifecycle is `up -d --wait`, `ps`,
and `stop` using that explicit Compose invocation; this bundle runs none of them.

### Required ownership preflight

On the VPS itself, immediately before any first launch, run
`node tools/staging/isolated-savings/preflight.mjs --fresh-private` in the same
controlled environment. `ISOLATED_PARENT_REVIEW=private-services-reviewed` records
the already-obtained review; setting this string is not itself approval. The tool
requires the local `/var/run/docker.sock` context and working Compose, and inspects
all containers (including stopped), volumes and networks for the fixed project
name or Compose project label. Any collision or inventory failure rejects setup.
It never deletes, adopts, starts or changes resources. Run it under an operator
deployment lock through launch to avoid a race with other provisioning processes.
Do not override the project name to evade a collision. Existing-resource restarts
need separate ownership/volume identity review; the fresh preflight rejects them.

## Capacity, persistence and remaining blockers

Hard service memory limits total 2.875 GiB, plus 256 MiB shared memory allocation;
CPU limits total 2.75 cores. Host availability/core count are unverified. Postgres
has 60 connections, REST pool 10, 256 MiB buffers and 1 GiB WAL target (not a disk
quota). Two project-owned volumes persist PGDATA and pgsodium configuration.
Payload-bearing stdout/stderr is not retained (`logging.driver=none`) for any
service. Postgres also disables SQL, duration, parameter and statement-on-error
logging and its file logging collector. Docker health state, exit codes, restart
counts and OOM status remain available; use status-only monitoring, never dump
container environments or SQL/mail/HTTP bodies. Each service retains its health
check. Mail retains at most 100 messages.

The stated 16 GiB RAM / 45 GiB disk is not verified free capacity. Reserve at least
6 GiB available RAM and 15 GiB free disk for this staging workload/images/maintenance
before launch; configure a dedicated volume quota and disk alerts. Named volumes
have no automatic quota. Agree on encrypted backup/restore and retention for both
volumes before persistent use; do not run `down -v` or reuse a production volume.

Existing `tools/test/hosted-savings-bootstrap*` already owns schema manifest and
disposable replay checks; `hosted-storefront-environment.mjs` owns client planning.
They are not duplicated or invoked for deployment. Their disposable CLI runner
cannot target this persistent server. A reviewed schema materialization/installation
path, PG17 compatibility, synthetic-only seed,
RLS tests, OTP/JWT/REST smoke checks, egress checks and restart persistence checks
remain prerequisites. Never bulk-replay historical SQL or restore production data
into this instance without a separate review of external effects.

## Review result and exact launch approvals

**Ready for parent bundle review; not ready for launch.** Local configuration
tests do not prove first boot or hosted savings readiness.
Final local result: 17 tests passed, 2 Compose-parser checks skipped because the
plugin is unavailable. Targeted Biome passed. Repository lint and typecheck passed
from Turbo cache (lint reports existing warnings). No full database suite or
containers were run; this is configuration validation only.

1. Approve this four-service private-only template and official image pins. Supply
   working Compose and verify the template with `config --no-interpolate
   --no-env-resolution`; local Compose is missing, so those two tests are skipped.
   Verify image architecture/digests before pulling on the target.
2. Explicitly authorize secure creation of the four independent staging secrets,
   and approve the origin, exact redirect and issuer configuration. The proposed
   auth hostname remains unverified; this does not authorize DNS or public ingress.
3. Approve fresh resource ownership after the preflight, host egress firewall,
   loopback port availability, available capacity, volume quota and backup policy.
4. Then explicitly authorize the parent/operator's private-only provisioning and
   first-boot/health/egress/persistence tests. This agent has not deployed anything.

Public exposure, synthetic identity setup, Baci schema installation and app
connection remain separate reviews. Existing migration plan validation now passes
(`125` bootstrap, `427` historical including bootstrap, `12` post-replay, `738`
pending sources); this is not a PG17 replay or persistent installation approval.
