# PiggyVest DB forwarder

A small TCP passthrough on the VPS (`82.29.190.219`) that lets Vercel functions
reach the Supabase direct Postgres host. It is published as
`pg-relay.usebaci.com:15432`.

## Why it exists

Vercel functions are IPv4-only. The Supabase direct host
`db.aivqthbxdshhltbwipbr.supabase.co:5432` is IPv6-only, so Vercel cannot reach
it. The shared Supavisor pooler is reachable over IPv4, but our executors
verify end-to-end TLS and the pooler-to-Postgres hop reports
`pg_stat_ssl.ssl = false`, so the pooler fails that check. The VPS has working
IPv6 to the database, so it can carry the connection.

## Security model

- TLS is end to end. The forwarder never terminates, inspects or modifies TLS.
  It sees ciphertext only. The client does the Postgres `SSLRequest` handshake
  and then TLS directly with Postgres.
- Only traffic that starts with exactly the 8-byte Postgres `SSLRequest`
  (`00 00 00 08 04 d2 16 2f`) passes. A plaintext startup message,
  `GSSENCRequest`, `CancelRequest` or any other bytes are closed immediately,
  without contacting the database. An `SSLRequest` followed by extra bytes
  before the server replies is also closed.
- The upstream is fixed in code (`db.aivqthbxdshhltbwipbr.supabase.co:5432`,
  IPv6, resolved on every connection). No environment variable or config file
  can change it, and the service has no env file and holds no secrets.
- The database still requires its password and least-privilege logins. The
  forwarder adds no authentication; it only moves bytes. Anyone on the
  internet can reach the port, exactly as with the direct host itself.
- After the `SSLRequest` is forwarded, the client must stay silent until the
  database answers (data before the reply closes the connection, reason
  `data_before_ssl_reply`). The database must answer `S` and begin TLS within
  15 s, otherwise both sides are closed (`handshake_timeout`). An `N` reply
  (SSL refused) closes both sides at once (`upstream_refused_ssl`), so a
  plaintext session is never possible.
- Limits: 60 concurrent connections overall (more are refused), 20 per source
  address (IPv6 sources are grouped by their /64), 5 s to send the first bytes, 5 s to connect upstream, 10 minutes
  idle. These cap the load an abusive client can put on the VPS. The real DoS bound
  is the app's own 60/20 connection caps. `MemoryMax` and `TasksMax` in the
  unit may not be enforced for systemd user units (cgroup delegation), so do
  not rely on them.
- Logs contain only aggregate counts and reject reasons, plus a salted
  truncated hash of the source address. No addresses, no payload.
- The client MUST verify the certificate against the real database host name,
  not `pg-relay.usebaci.com` (that name is not in the certificate). With
  node-postgres, set `ssl.checkServerIdentity` to check against
  `db.aivqthbxdshhltbwipbr.supabase.co`. A custom `ssl.servername` is lost
  (pg overwrites it with the host), so use `checkServerIdentity`.

## Client requirements

Any client pointed at `pg-relay.usebaci.com` MUST:

- keep `rejectUnauthorized: true` (never disable certificate verification),
- pin the Supabase Root 2021 CA as the trust anchor, and
- verify the certificate name against
  `db.aivqthbxdshhltbwipbr.supabase.co`, not the relay name.

The web app does this through `PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME` (PR #4027).
Without these, the relay would be an unauthenticated man-in-the-middle position.

## Status: ships dark

Merging changes nothing in production. The next `main` release only copies the
files to the VPS. Nothing installs or starts the service, opens the port or
creates DNS. The owner runs the steps below.

## Owner steps (nothing here has been run)

All VPS commands run over `ssh bassey@82.29.190.219`.

1. Merge the PR and wait for the next `main` release. Check:
   `ls /srv/baci-worker/baci-workers/install-piggyvest-db-forwarder-service.sh`.
2. Once (root), let the user service run without a login session and survive
   reboots: `sudo loginctl enable-linger baci-worker` (already done if the
   egress relay is installed).
3. Install and start the service as `baci-worker`. The unit is sandboxed
   (`ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp=true`,
   `MemoryMax=256M`, `NoNewPrivileges=true`). It binds port 15432 (an
   unprivileged port, no root needed) and keeps outbound IPv6 allowed. If
   systemd reports a namespace error (226/NAMESPACE), report it rather than
   removing the sandbox lines. After install, check whether the limits are
   enforced: `systemctl --user show -p MemoryMax baci-piggyvest-db-forwarder`
   (as `baci-worker`). `infinity` means the cap is not applied.

   ```bash
   sudo -u baci-worker -H env XDG_RUNTIME_DIR=/run/user/$(id -u baci-worker) \
     bash /srv/baci-worker/baci-workers/install-piggyvest-db-forwarder-service.sh /srv/baci-worker/baci-workers /usr/bin/node
   ```

4. Firewall (root): if `ufw` is active (`sudo ufw status`), allow the port:
   `sudo ufw allow 15432/tcp comment 'piggyvest db forwarder'`. If a cloud
   firewall exists in the Hostinger panel, allow inbound TCP 15432 there too.
5. DNS (Vercel DNS for `usebaci.com`): add `A pg-relay -> 82.29.190.219`.
   DNS only. It must NOT be proxied (Cloudflare orange cloud would break
   Postgres, which is not HTTP).
6. Confirm the VPS can reach the database over IPv6:
   `getent ahostsv6 db.aivqthbxdshhltbwipbr.supabase.co` must list an address.

## Verification

From a laptop (no psql or openssl needed). This sends the `SSLRequest`, expects
`S`, then runs TLS through the relay while verifying the certificate against
the real database host name:

```bash
node -e '
const net = require("node:net"), tls = require("node:tls");
const DB = "db.aivqthbxdshhltbwipbr.supabase.co";
const s = net.connect(15432, "pg-relay.usebaci.com", () =>
  s.write(Buffer.from([0,0,0,8,4,0xd2,0x16,0x2f])));
s.once("data", (d) => {
  if (d.toString() !== "S") { console.log("FAIL: reply", d); process.exit(1); }
  const t = tls.connect({ socket: s, servername: DB }, () => {
    console.log("OK authorized=" + t.authorized, "cert-for=" + DB, t.getProtocol());
    t.destroy();
  });
  t.on("error", (e) => { console.log("FAIL", e.code || e.message); process.exit(1); });
});
s.on("error", (e) => { console.log("FAIL", e.code || e.message); process.exit(1); });
'
```

Expected: `OK authorized=true ...`. If `authorized=false` with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, the Supabase certificate chain needs the
Supabase CA as trust anchor; that is a CA issue, not a forwarder issue. A
plaintext probe must be closed without an answer:
`printf 'GET / HTTP/1.0\r\n\r\n' | nc pg-relay.usebaci.com 15432` prints
nothing.

On the VPS: `journalctl --user -u baci-piggyvest-db-forwarder -n 20`
(as `baci-worker`) shows a `listening` line and periodic aggregate `stats`.

## Rollback

Nothing depends on the forwarder until the app is pointed at it, so stop it
first, then undo the rest:

```bash
sudo -u baci-worker -H env XDG_RUNTIME_DIR=/run/user/$(id -u baci-worker) \
  systemctl --user disable --now baci-piggyvest-db-forwarder.service
sudo ufw delete allow 15432/tcp        # if you added the rule
```

Then delete the `pg-relay` DNS record. To pause without removing anything,
only the `disable --now` command is needed; the port closes immediately.
