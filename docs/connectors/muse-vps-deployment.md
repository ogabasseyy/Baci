# Muse Connector VPS Deployment Preparation

Status: **gateway healthy on production HTTPS; merchant dashboard/privacy release and authenticated reviewer proof remain pending** (4 October 2026).

See [the current release status](muse-release-status-2026-10-04.md) for the latest
CodeRabbit override, runtime checks, and migration versions. Earlier status
statements below are historical deployment notes.

The owner has approved the read-only production rollout in this conversation.
The production migration set is `20261003214512_connector_readonly_production.sql`,
`20261004030500_connector_grant_management_ownership.sql`, and
`20261004062820_connector_retention_one_year.sql`, followed by
`20261004134356_assert_connector_gateway_role_safety.sql`. The first
combines grants, audit, credential reissue, and owner-only inventory visibility;
the second requires the grant's linked user for reissue and limits revocation. The original proof
migration version collides with production `product_variant_recall`; do not
push this legacy proof checkout directly. A separate deployment bundle rebuilt
from current main plus the 41 recovered production SQL histories excludes four
unrelated local migration files and all legacy connector proof migrations.
The prior Supabase CLI dry run proposed the first two production migrations,
with no seed or role changes. The first three migrations and a later
role-safety assertion are now present in the production migration ledger. The
owner-only inventory policy is created in the first production migration, so
there was no staff-read interval. A new three-migration CLI dry run was not
performed; see the reconciliation record before any future migration work.
Hosted validation on the restored proof branch and all four SQL regression suites pass. Current production dependency
comparison matched gateway-relevant policies, functions, and table shapes except
one unrelated products metadata column. The owner selected one year for audit
rows and revoked/expired grant metadata. The daily purge function and schedule
are installed in production and were verified read-only; its transactional
regression passed and rolled back its synthetic rows.

The public host is `muse-api.usebaci.com`, with OpenAPI URL
`https://muse-api.usebaci.com/openapi.json` and docs URL
`https://muse-api.usebaci.com/docs`. DNS points the host to `82.29.190.219`;
Let's Encrypt issued a certificate valid through 2 January 2027. The HTTPS
Nginx allowlist is installed and verified. Until the gateway starts, discovery
returns 502; `/health`, grant administration and unlisted paths are blocked by
Nginx.

## Prepared files

- `apps/web/tools/connector-gateway/Dockerfile.production` — Node 24 runtime,
  non-root process, health check, bundled gateway from the reviewed source.
  Run `pnpm --filter @baci/web build:connector-gateway` before building the image.
- `apps/web/tools/connector-gateway/compose.production.yaml` — gateway bound
  only to `127.0.0.1:3211`, no fixed owner/grant-management secrets, separate
  environment file at `/etc/baci/muse-connector.env`.
- `apps/web/tools/connector-gateway/nginx.muse-api.conf` — HTTPS vhost for the
  planned name. It allows only `GET /docs`, `GET /openapi.json`, and POSTs to
  the four declared tools; every other path returns 404.
- `apps/web/tools/connector-gateway/nginx.muse-api.acme.conf` — temporary
  HTTP-only ACME challenge vhost; it serves challenge files and returns 404 for
  API paths until the TLS certificate exists.
- `apps/web/tools/connector-gateway/docs-page.ts` — public operator docs
  served by the gateway.

The Compose file intentionally does not set
`CONNECTOR_GATEWAY_PRODUCTION_APPROVED=1`. The gateway will fail closed until
the owner authorizes the production scope and adds that flag to the protected
runtime environment. No database URL, password, or API token belongs in this
repository.

The Baci Supabase Connect panel identifies the shared IPv4 transaction
pooler as `aws-1-eu-west-1.pooler.supabase.com:6543`. The gateway database
username format is `connector_gateway.aivqthbxdshhltbwipbr`; the password
must be freshly set through an owner-authorized secure flow and written only
to the protected VPS environment file. The authenticated Supabase CLI can run
the role SQL through its Management API; recovering or resetting the main
postgres password is unnecessary. No gateway password has been set or copied.
The Supabase Database Roles page currently shows `connector_gateway` with
`User can login` disabled and zero active connections. A read-only VPS check
on 4 October 2026 found no connector image or source checkout and no listener
on the gateway ports; Nginx is ready to proxy to `127.0.0.1:3211`. Do not
enable the role or start the service until the reviewed production build is
available and the owner has completed the password handoff.

## Production rollout gates

1. **Database migration — complete.** All four connector migrations are
   applied; the owner-only `variant_inventory` policy, grant/audit schema,
   daily one-year purge job, and least-privilege gateway-role attributes were
   verified. No active grants exist.
2. **DNS and TLS — complete.** The A record, certificate, HTTPS allowlist,
   and external redirect/path checks are in place.
3. **Secrets and runtime — open.** Create `/etc/baci/muse-connector.env` with mode
   `0600`, containing only the approved pooled database URL and the explicit
   production approval flag. Configure and verify the exact runtime role and
   branch connection against the production database; do not include staging
   owner secret, user ID, or merchant ID fields.
4. **Production proof — open.** Build and start the service only after the migration
   decision. Verify public discovery/docs, unauthenticated denial, all tool
   scopes, merchant/branch containment, rate limits, audit, revocation, and
   paths/methods denied by the Nginx allowlist. Start with a dedicated
   synthetic reviewer merchant, never a real merchant's credential.
5. **Privacy and review — open.** The connector disclosure is drafted in the
   platform privacy page and its rendering test passes, but the page is not yet
   deployed to `https://usebaci.com/privacy` and still needs owner/legal review.
   Keep the synthetic reviewer account available for Muse's review period.

The connector migrations are applied and verified; the retention test rolled
back its synthetic rows. The public privacy page change is still only in the
local worktree and has not been deployed to `https://usebaci.com/privacy`.
Do not enter the endpoint in Muse or start the gateway until its protected
runtime configuration, reviewer test account, current-diff review, public
privacy disclosure, and end-to-end production tests are complete. The read-only
grant flow lets a merchant owner authorize a Muse agent to read that merchant's
live orders, inventory, and analytics within the selected branch/scope limits.

## Active deployment receipt — 4 October 2026

- Container: `baci-muse-connector-gateway-1` (healthy).
- Image: `baci-connector-gateway:review-295878cdfbfb02cd`.
- Image ID: `sha256:af656c8ffa5e33def395349c2e11c420574db32d780e84abc0def6a38ce17b96`.
- Host Compose: `/home/bassey/baci-muse/production/compose.yaml`.
- Private config: `/home/bassey/.config/baci-muse/runtime.env` (0600 inside 0700 directory).
- Database: dedicated `connector_gateway` role, session pooler port 5432;
  LOGIN enabled, no superuser/createdb/createrole/bypass-RLS attributes.
- Public discovery/docs 200; missing bearer 401 `GRANT_REVOKED`; public health,
  grant administration and unknown routes 404. Local health reports database up.
- No active merchant grants were created during activation. Merchant-authenticated
  production proof and synthetic reviewer access remain pending.

To stop this service only, use `docker compose -p baci-muse -f
/home/bassey/baci-muse/production/compose.yaml stop`. Disabling the dedicated
role login is a separate database action; also stop the container to terminate
its existing pooled connections. Never stop other VPS services as part of this
connector's rollback.

The owner explicitly waived unavailable CodeRabbit review in this chat. The
final review is recorded as skipped, not passed. Web production deployment is
still separate: the current main workflow selects `ubuntu-24.04` for its
prebuilt build/deploy job, while the supplied repository instructions require
owner approval for that fallback. No web workflow was triggered here.
