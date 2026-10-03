# GIGL tracking worker token rotation

## Pre-merge checklist (cutover PR)

CI proves the Vercel key is DEFINED, never that the value is real or
unexpired — do not rely on the green gate. Before merging:

- [ ] Vercel Production `GIGL_TRACKING_WORKER_TOKEN` decodes (payload
  `exp`, one-liner below) and matches the VPS `.env` value exactly.
- [ ] `exp` leaves a 14-day runway; otherwise rotate first (steps below).
- [ ] Manual fallback route returns 200 with the Vercel value.

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
3. Redeploy Vercel production via a manual workflow dispatch, or a
   main push that selects the tracking filter — NOT a Vercel
   dashboard redeploy and NOT an ordinary non-tracking push. Env
   values snapshot at deploy time, so the running deployment keeps
   serving the OLD token until redeployed (a 200 from step 5
   beforehand would be false confidence). The rotation invalidates
   the cutover latch by design (new token fingerprint), so the
   capability smoke must re-run with the new token and re-latch —
   but the smoke job is skipped whenever `tracking == 'false'`, and
   without either a smoke success or a valid latch bypass
   `deploy-production` never runs: a dashboard redeploy skips the
   smoke unconditionally, and a non-tracking push skips it while
   the invalidated latch kills the bypass, stranding the old token
   in production. A dispatch always runs the smoke (unset filter
   outputs fail closed into it). If you dispatch (rather than
   push), run `bash vps-workers/deploy.sh` from current
   main FIRST: a dispatch always runs the exact-SHA worker check, so
   a worker that legitimately trails main after web-only releases
   would block the redeploy. If a dashboard redeploy already
   happened, dispatch the workflow once immediately after to re-smoke
   and re-latch; until then the next web push stays blocked on the
   invalidated latch.
4. On the worker host, run the capability wrapper to prove the new
   token executes a reviewed wrapper without claiming work (same
   environment as the cron and deployment smoke — `run-web-script.sh`
   exits unless `NODE_ENV` is set):
   `REMOTE_DIR=/home/bassey/baci-workers`, then `NODE_ENV=production
   BACI_WORKER_PROFILE=gigl-tracking BACI_WORKER_ENV=$REMOTE_DIR/.env
   $REMOTE_DIR/bin/verify-gigl-tracking-worker-capability.sh` as a second
   command (`$REMOTE_DIR` in a single-line env prefix expands before the
   temporary assignment takes effect, which would point
   `BACI_WORKER_ENV` at `/.env`).
5. Hit the manual fallback route on the NEW deployment once and expect
   200, not `GIGL tracking worker unavailable`.
