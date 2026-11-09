# PiggyVest egress relay

Since 2026-10-27 PiggyVest Business accepts API requests (including status
queries with the secret key) only from whitelisted IP addresses. The only
whitelisted address is the VPS, `82.29.190.219` (confirmed: the VPS's public
egress address is exactly that). The web app runs on Vercel, which has no fixed
egress addresses, so its direct PiggyVest calls are rejected.

The relay is a small Node service on the VPS. The web app sends its PiggyVest
API calls to the relay; the relay checks a signature, then makes the same call
to `https://api.piggyvest.business` from the VPS address.

Webhooks from PiggyVest to `https://ogabassey.com/api/webhooks/piggyvest` are
not affected and do not use the relay.

## Status: ships dark

Merging the code changes nothing in production:

- Web app: the relay is used only when `PIGGYVEST_EGRESS_RELAY_URL` and
  `PIGGYVEST_EGRESS_RELAY_SECRET` are both set in Vercel. Unset, requests go
  straight to PiggyVest exactly as before.
- VPS: nothing installs or starts the relay automatically. The next `main`
  release only copies the files. The owner runs the install steps below.
- Only the PiggyVest production origin is rerouted. Paystack and the
  PiggyVest sandbox (`staging.piggyvest.business`) are never relayed. If
  PiggyVest turns out to restrict the sandbox by IP as well, that is a
  separate, deliberate change.

## How it works

- Code: `vps-workers/jobs/piggyvest-egress-relay.mjs` with
  `vps-workers/lib/piggyvest-egress-relay-{auth,allowlist,server}.mjs`.
  Web side: `apps/web/src/lib/piggyvest/egress-relay.ts`, used by
  `client.ts` and `prefunded-card-provider-request.ts`.
- The relay listens on `127.0.0.1:18910` only. nginx
  (`vps-workers/config/piggyvest-egress-relay.nginx.conf`) terminates TLS at
  `pv-egress.usebaci.com` and proxies only `/api/v1/`.
- Every request carries `x-baci-relay-auth: v1.<unix seconds>.<nonce>.<hmac>`.
  The HMAC-SHA256 covers the method, the exact path and query, the timestamp,
  the nonce and the SHA-256 of the body. The relay refuses stale (more than 60
  seconds), replayed or badly signed requests with 401, and refuses everything
  when no secret is configured.
- The relay forwards only an allowlist of method and path pairs (the PiggyVest
  calls the app makes; the sandbox-only test funding call is excluded).
  Anything else is 404 without contacting PiggyVest. The upstream host is
  fixed in code; absolute URLs, `..`, encoded separators and control
  characters are rejected.
- The caller's PiggyVest `Authorization` header and body pass through
  unchanged. The relay never holds the PiggyVest key. It never follows
  redirects, caps request (64 KiB) and response (1 MiB) sizes, and times out
  after 35 seconds (the web client's own limit is 30 seconds).
- Logs contain only method, allowlisted path template, status and latency.
  nginx access logging is off for this host because request lines carry wallet
  ids, references and account numbers. The 443 vhost also sets
  `error_log /dev/null crit;` because nginx writes the request line (with its
  query string) into error-level upstream-failure entries; a relay outage is
  therefore diagnosed from `systemctl --user status`/journald, not nginx logs.
  The relay port is fixed at 18910 (no env override) so nginx and the service
  cannot drift apart.

### How the app reads relay failures

Relay-originated answers always carry `x-baci-relay-error`. A genuine PiggyVest
answer (any status) carries `x-baci-relay-upstream: sent` and no error header.

| Relay says | Meaning | App behavior |
| --- | --- | --- |
| `x-baci-relay-upstream: not-sent` (401, 404, 413, 503) | The relay refused before contacting PiggyVest | Unavailable error (`PIGGYVEST_RELAY_UNAVAILABLE` / `PROVIDER_RELAY_UNAVAILABLE`), no money moved, never shown as a PiggyVest refusal |
| `maybe-sent`, any 504, an unknown marker, or an answer that is not from the relay (proxy error page) | PiggyVest may have processed the call | Same indeterminate path as a timeout today (`PIGGYVEST_NETWORK_ERROR` / `PROVIDER_TIMEOUT`), so existing reconciliation runs |

The app never retries a mutation because of a relay error.

When adding a new PiggyVest call to the app, add its method and path to
`vps-workers/lib/piggyvest-egress-relay-allowlist.mjs` in the same change;
otherwise the relay answers 404 `not_allowlisted` (a safe, `not-sent` failure).

## VPS facts found read-only (2026-11-04)

- Ubuntu 26.04 LTS, Node 24.22.2, nginx on ports 80/443 (certbot-managed
  Let's Encrypt certificates in `/etc/letsencrypt/live`, vhosts as symlinks
  from `/etc/nginx/sites-enabled` to `sites-available`).
- Workers run as the unprivileged `baci-worker` user (uid 987) as systemd user
  services; releases live under `/srv/baci-worker` (`current` symlink,
  `baci-workers/` persistent directory). `bassey` could not read
  `nginx.conf` or most vhosts, so the full set of server blocks was not seen.
- Local port `18910` is free. No relay unit exists yet.
- DNS for `usebaci.com` is on Vercel DNS and an unknown subdomain currently
  resolves to a Vercel address, so an explicit record is required.

## Owner steps (nothing here has been run)

All VPS commands run over `ssh bassey@82.29.190.219`.

1. Merge the PR. Wait for the next `main` release so the files appear under
   `/srv/baci-worker/baci-workers` (check:
   `ls /srv/baci-worker/baci-workers/install-piggyvest-egress-relay-service.sh`).
2. DNS: in Vercel DNS for `usebaci.com`, add `A pv-egress -> 82.29.190.219`.
3. Make the shared secret (keep it out of chat and shell history; store it in
   the password manager): `openssl rand -hex 32`.
4. Create the relay env file as `baci-worker`, secret read from stdin:

   ```bash
   sudo -u baci-worker -H bash -c 'umask 077; { printf "PIGGYVEST_EGRESS_RELAY_SECRET="; cat; } > /srv/baci-worker/baci-workers/piggyvest-egress-relay.env'
   ```

   Paste the secret, then press Ctrl-D. The file must be mode 600.
5. Install and start the service. First, once (needs root), let the user
   service run without a login session and survive reboots:
   `sudo loginctl enable-linger baci-worker`.
   The unit is sandboxed (`ProtectSystem=strict`, `ProtectHome=read-only`,
   `PrivateTmp=true`, `MemoryMax=256M`, `NoNewPrivileges=true`); it only reads
   the code and env file under `/srv/baci-worker/baci-workers`. If systemd
   reports a namespace error (status 226/NAMESPACE) for the user unit, report
   it rather than removing the sandbox lines. Then install:

   ```bash
   sudo -u baci-worker -H env XDG_RUNTIME_DIR=/run/user/$(id -u baci-worker) \
     bash /srv/baci-worker/baci-workers/install-piggyvest-egress-relay-service.sh /srv/baci-worker/baci-workers /usr/bin/node
   ```

6. Local check on the VPS: `curl -si http://127.0.0.1:18910/api/v1/wallet/x`
   must answer `401` with `x-baci-relay-error: auth_missing`.
7. nginx and certificate (root):

   ```bash
   sudo mkdir -p /var/www/pv-egress-acme
   # first the HTTP block only, to pass the certificate challenge
   awk '/^server \{/{n++} n<2' /srv/baci-worker/baci-workers/config/piggyvest-egress-relay.nginx.conf | sudo tee /etc/nginx/sites-available/pv-egress.usebaci.com
   sudo ln -s /etc/nginx/sites-available/pv-egress.usebaci.com /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot certonly --webroot -w /var/www/pv-egress-acme -d pv-egress.usebaci.com
   # then the full file (HTTP and HTTPS blocks)
   sudo cp /srv/baci-worker/baci-workers/config/piggyvest-egress-relay.nginx.conf /etc/nginx/sites-available/pv-egress.usebaci.com
   sudo nginx -t && sudo systemctl reload nginx
   ```

8. Public check from anywhere: `curl -si https://pv-egress.usebaci.com/api/v1/wallet/x`
   must answer `401` with `x-baci-relay-error: auth_missing`.
9. Signed end-to-end check (read-only bank list; the values come from the
   password manager, not from the shell history):
   `node vps-workers/scripts/piggyvest-egress-relay-smoke.mjs` with
   `PIGGYVEST_EGRESS_RELAY_URL`, `PIGGYVEST_EGRESS_RELAY_SECRET` and
   `PIGGYVEST_SECRET_KEY` set. Expect `status=200` and
   `x-baci-relay-upstream=sent`. A `403` with `sent` means PiggyVest still does
   not see the VPS address as whitelisted.
10. Turn it on for the web app: set `PIGGYVEST_EGRESS_RELAY_URL=https://pv-egress.usebaci.com`
    and `PIGGYVEST_EGRESS_RELAY_SECRET=<the same secret>` in Vercel production
    (REST API upsert, then pull to verify; a piped `vercel env add` stores an
    empty value). Then run the approved VPS prebuilt production deploy so the
    new values take effect.
11. Verify: trigger one live read (for example the savings status check) and
    read the relay log as `baci-worker`:
    `journalctl --user -u baci-piggyvest-egress-relay -n 20`. Lines look like
    `GET /api/v1/wallet/:id 200 142ms` and nothing else.

After later `main` releases the relay keeps running the code it started with.
Restart it to pick up new code:
`sudo -u baci-worker -H env XDG_RUNTIME_DIR=/run/user/$(id -u baci-worker) systemctl --user restart baci-piggyvest-egress-relay`.

## Rollback

- Fastest (web side): remove `PIGGYVEST_EGRESS_RELAY_URL` and
  `PIGGYVEST_EGRESS_RELAY_SECRET` from Vercel and redeploy. The app goes back
  to calling PiggyVest directly. Note that direct calls from Vercel are
  rejected by PiggyVest until the IP restriction changes.
- Stop the relay: `systemctl --user disable --now baci-piggyvest-egress-relay`
  (as `baci-worker`, with `XDG_RUNTIME_DIR` as above). nginx then answers 502
  for `/api/v1/`; the app reads that as an indeterminate outcome and never
  retries mutations.
- Remove the public entry: delete the `sites-enabled/pv-egress.usebaci.com`
  link, `nginx -t`, reload nginx, and delete the DNS record.
- Rotate the secret: write a new env file (step 4), restart the service, and
  update the Vercel variable and redeploy. A mismatch fails closed with 401
  `not-sent` errors.

## Known limits

- One VPS is a single point of failure for every live PiggyVest call; while it
  is down, reads and writes fail as described above.
- The replay cache lives in memory, so a relay restart forgets recent
  signatures; the 60 second window bounds that exposure.
- The relay allowlist and the app's PiggyVest call sites must be kept in step
  (see above).
