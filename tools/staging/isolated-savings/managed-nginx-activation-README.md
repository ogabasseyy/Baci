# Managed Nginx activation candidate — owner review required

This is a preparation-only gate for a future owner-run staging activation. This
task has not modified Nginx, started the gateway, reloaded a service, changed
firewall/DNS, or enabled PiggyVest processing.

`managed-nginx-activation.mjs` accepts only a current, independently reviewed
gateway binding and startup evidence. The evidence must still pass the existing
five-minute freshness/identity checks, and its explicit lease remains the
gateway's hard maximum lifetime. It refuses unknown Nginx layouts instead of
attempting a broad replacement.

The read-only VPS inspection on 2026-09-19 observed this exact separation in
`/etc/nginx/sites-available/staging-auth.ogabassey.com`:

- General `location /auth/v1/` and `location /` each proxy to
  `http://172.23.0.3:9999`.
- Exact `location = /piggyvest/intake` proxies to `http://127.0.0.1:4791`.

The activation renderer replaces exactly two occurrences of the general Auth
upstream with `http://unix:/run/baci-savings-gateway/ingress.sock`. It requires
the exact intake location and its `127.0.0.1:4791` upstream, then compares that
entire location block unchanged after rendering. It rejects a changed Docker IP,
missing/extra general proxy, non-exact intake location, or any intake route that
already points at the Unix gateway.

Before any owner applies a generated candidate, they must independently capture
fresh container identity/evidence, select a short explicit lease, verify the
active gateway socket, preserve a root-owned copy of the full current Nginx
file, parser-test the candidate, and use an atomic replacement with immediate
rollback on parser/reload failure. Keep the saved original until the gateway has
withdrawn at lease expiry and the expected unavailable response is observed.
Do not use this route change for public app/BFF access or provider money movement.

## Sealed owner command

After parent review, copy exactly the files named by
`managed-nginx-owner-activation.SHA256SUMS` into a new root-owned 0700 directory
and seal each file root-owned 0400. The owner must independently verify that
checksum list before use. The wrapper reuses the installed-runtime verification
from the private smoke, creates fresh binding/startup evidence, requires the
active 0660 Unix socket, stages only after those gates, validates Nginx, reloads
only on a valid candidate, and restores/revalidates/reloads the original on any
activation, parser, or reload failure.

The existing reviewed identity is deliberately **read-only**: it permits only
`/rest/v1/products` GET/HEAD plus the fixed private Auth routes. It does not
authorize application enablement. A separate parent-reviewed identity is required
before enabling the minimum hosted-draft commands:

- `POST /rest/v1/rpc/customer_savings_draft_command`
- catalogue reads for customers, merchants, and products
- `POST /rest/v1/rpc/get_storefront_product_variants`

Do not add those paths to `managed-private-smoke-identity.json` or this command.
They require a new reviewed identity/evidence checksum and the same bounded lease.

When the parent has approved the current read-only rehearsal, the runnable owner
command is:

```sh
cd /root/baci-nginx-owner-activation
/usr/bin/sha256sum --strict --check managed-nginx-owner-activation.SHA256SUMS
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C HOME=/ \
  /usr/bin/flock --nonblock /run/lock/baci-isolated-savings-admin.lock \
  /usr/bin/node /root/baci-nginx-owner-activation/managed-nginx-owner-activation.mjs \
  4283c805a0acb5eb8b86fd6074209ddbb9f875c5bbeae1d30b6b02ed91009479 \
  974472a0c57399151acb72af1eff7d1b414eea507583c8bba6a863283237b294 \
  /root/baci-nginx-owner-activation/managed-private-smoke-identity.json \
  2681c4befbe401304afdde5fb96a823f10b911cd2b9509e67d9aca10530e594b \
  /root/baci-nginx-owner-activation/managed-install-manifest.json \
  9d2cbe1cbff31644c7de503ab92f195cebcd44fb6661c91a343e38ce788d2ccc
```

The command is intentionally for the parent-approved read-only rehearsal only.
It must not be run until the parent confirms the sealed files and current host
identity. No fallback TCP proxy, sudo expansion, or production endpoint is used.

Local regression check:

```sh
node --test tools/staging/isolated-savings/managed-nginx-activation.test.mjs
```
