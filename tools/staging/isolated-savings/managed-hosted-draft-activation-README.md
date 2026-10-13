# Hosted-draft Nginx activation — parent review required

This package is staging-only preparation. It has not changed a remote host,
started a service, run `sudo`, or reloaded Nginx.

The separate hosted identity permits exactly these routes: Auth's existing
methods, GET/HEAD catalogue reads for products, customers, and merchants, and
POST to `customer_savings_draft_command` plus
`get_storefront_product_variants`. It does not permit provider financial
writes, PiggyVest intake, transfer routes, or arbitrary REST RPCs.

The owner wrapper creates fresh binding and evidence, sets a 24-hour gateway
lease, confirms the managed socket, and installs the Nginx candidate only after
that evidence passes. It preserves the exact `/piggyvest/intake` proxy to
`http://127.0.0.1:4791`; the Auth prefix rewrite is removed so the Unix gateway
receives `/auth/v1/...`. Gateway connection failures map to a route-scoped 503;
there is no TCP fallback or write retry.

Before replacing the vhost, the wrapper verifies every live non-root Nginx
worker's effective `/proc/<pid>/status` groups. On the reviewed staging host it
may perform only this narrow prerequisite when absent:

```sh
/usr/sbin/usermod -a -G baci-savings-ingress www-data
```

It reloads Nginx and waits up to five seconds for stale workers to drain and all
current workers to show group `984`; otherwise it refuses before staging a
vhost. The candidate swap rechecks the root-owned source fingerprint and hash
immediately before atomic rename. Parser/reload/callback failures restore and
reload the saved original. A successful persistent activation retains its
evidence/service only until the gateway's 24-hour lease expires.

After parent review, copy the sealed files into a new root-owned `0700`
directory, make the code and JSON files root-owned `0400`, and run exactly one
command from that directory after verifying its checksum list:

```sh
/usr/bin/sha256sum --strict --check /root/baci-hosted-draft-activation/managed-hosted-draft-activation.SHA256SUMS
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C HOME=/ \
  /usr/bin/flock --nonblock /run/lock/baci-isolated-savings-admin.lock \
  /usr/bin/node /root/baci-hosted-draft-activation/managed-hosted-draft-owner-activation.mjs \
  4283c805a0acb5eb8b86fd6074209ddbb9f875c5bbeae1d30b6b02ed91009479 \
  fe699b5bef2784953d6b8d82a8f8772280fd9b0cdeec1b5625b9e9bfa8393152 \
  /root/baci-hosted-draft-activation/managed-hosted-draft-identity.json \
  684c10750d7abc80eaec7e78453d4490ba88fed4d06eaed24afdabb4c3d58b0f \
  /root/baci-hosted-draft-activation/managed-install-manifest.json \
  9d2cbe1cbff31644c7de503ab92f195cebcd44fb6661c91a343e38ce788d2ccc
```

Do not use this package before parent review. This is not application enablement
evidence and does not authorize production or BFF work.
