# GIGL tracking worker token rotation

`GIGL_TRACKING_WORKER_TOKEN` is a signed, time-bounded PostgREST JWT whose
`role` is exactly `gigl_tracking_worker`. It must hold the SAME value in
two places or the retained manual fallback route returns 500 while the VPS
poller keeps working (split brain):

1. VPS worker env: `$REMOTE_DIR/.env` (default
   `/home/bassey/baci-workers/.env`) on the worker host.
2. Vercel Production env (`GIGL_TRACKING_WORKER_TOKEN`).

The deploy pipeline only proves the Vercel key is DEFINED
(`verify-gigl-fallback-token.sh` injects a build-time stand-in over
Vercel's blank pulled value); it cannot prove the value is real or
unexpired, because CI never sees the real secret. This runbook is the
validity check.

## Check expiry (run against the REAL token, never in CI)

```sh
token="$(grep '^GIGL_TRACKING_WORKER_TOKEN=' /home/bassey/baci-workers/.env | cut -d= -f2-)"
exp="$(printf '%s' "$token" | cut -d. -f2 | tr '_-' '/+' | awk '{ while (length % 4) $0 = $0 "="; print }' | base64 -d 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["exp"])')"
date -u -d "@$exp" 2>/dev/null || date -u -r "$exp"
```

Rotate when expiry is within 14 days, and confirm the Vercel
Production value decodes to the same `exp`.

## Rotate

1. Mint a new JWT for role `gigl_tracking_worker` OFF the VPS with a
   trusted Supabase signing key (see `vps-workers/README.md`: never copy
   a signing key or service-role credential to the worker host).
2. Write the new token to the VPS `.env`, then update the Vercel
   Production env var to the identical value.
3. On the worker host, run the capability wrapper to prove the new
   token executes a reviewed wrapper without claiming work:
   `BACI_WORKER_ENV=$REMOTE_DIR/.env $REMOTE_DIR/bin/verify-gigl-tracking-worker-capability.sh`.
4. Hit the manual fallback route once and expect 200, not
   `GIGL tracking worker unavailable`.
