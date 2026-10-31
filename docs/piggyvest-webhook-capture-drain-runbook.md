# PiggyVest webhook capture drain: runbook

The web receiver stores every authentic PiggyVest webhook delivery before it
answers (the durable capture). The **capture drain** is the background job
that finishes any stored delivery whose processing did not complete, for
example after a crash or a database blip.

The drain runs on the worker host (VPS) every minute. It connects to the
database with its **own login**, never the service-role key, and that login
can only lease, settle and count captured deliveries.

Everything below is for the owner to run later, with approval. Nothing in
the pull request that adds the drain changes production behaviour by itself.

## What it does on each run

1. Does nothing at all (no configuration read, no connection) unless
   `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED=true` is set in the worker env file.
2. Otherwise connects as `baci_piggyvest_webhook_capture_drain` and checks the
   session before anything else: exactly that login, a member of
   `piggyvest_webhook_capture_worker` and of nothing else, no elevated rights,
   and a TLS connection. Any doubt stops the run.
3. Claims at most 10 stored deliveries that are at least two minutes old,
   re-checks each stored signature, and hands the ones a PiggyVest primary
   intake owns (bank inflow, card custody outflow, interest payout) to that
   intake, which writes through its own dedicated login.
4. Leaves deliveries that only the legacy path can finish (legacy-family
   deliveries and record-only events) in the queue and raises a
   `PIGGYVEST_WEBHOOK_REPLAY_DEFERRED` alert. The web receiver's own retry
   (provider redelivery) still covers them.

Replaying is safe to repeat: every downstream ledger is keyed on PiggyVest's
transaction id. If the job is killed mid-run, the claimed delivery returns
to the queue five minutes later and the next run finishes it.

## Before you start

- The migration `20261031222127_piggyvest_webhook_capture_worker_role` is
  applied by the normal deploy (it only creates the non-login role and its
  three grants).
- The worker env file already holds the PiggyVest primary configuration the
  intakes need (database host/port/name/CA, the bank, custody and interest
  signing keys, each intake's own settings, and the same environment marker
  the other PiggyVest primary workers use). Without it the drain can
  claim deliveries but the intakes answer "unavailable", and the deliveries
  wait for a later run.

## Step 1: create the login (privileged database session)

Generate the password in the password manager. Never paste it into chat,
a ticket or the repository.

```sql
CREATE ROLE baci_piggyvest_webhook_capture_drain
  LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
  CONNECTION LIMIT 3
  PASSWORD '<from the password manager>'
  IN ROLE piggyvest_webhook_capture_worker;
```

Read-only check: the login must belong to exactly one role.

```sql
SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls,
       array_agg(g.rolname) AS member_of
FROM pg_roles r
LEFT JOIN pg_auth_members m ON m.member = r.oid
LEFT JOIN pg_roles g ON g.oid = m.roleid
WHERE r.rolname = 'baci_piggyvest_webhook_capture_drain'
GROUP BY 1, 2, 3, 4;
-- expected: true, false, false, {piggyvest_webhook_capture_worker}
```

If you give the password an expiry (`VALID UNTIL`), set a reminder: an
expired password stops the drain (nothing is lost; deliveries wait).

## Step 2: give the worker host the password (drain still off)

Add to the worker env file (`/srv/baci-worker/baci-workers/.env`):

```
PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_DB_PASSWORD=<from the password manager>
```

Leave `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED` unset for now.

## Step 3: readiness check

From the deploy checkout on the host (it runs the installed release as the
worker user):

```
NODE_ENV=production BACI_WORKER_PROFILE=piggyvest-webhook-capture-drain \
  bash vps-workers/release/run-as-worker.sh \
  vps-workers/bin/process-piggyvest-webhook-capture-drain.sh --readiness
```

It prints a JSON report (gate names and counts only). Expect every gate to
pass except `drain_schedule: DRAIN_NOT_ENABLED` and
`worker: DRAIN_NOT_SCHEDULED`. Fix anything else first; for example
`DRAIN_LOGIN_UNSAFE` lists which session check failed.

## Step 4: switch the drain on

Set `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED=true` in the worker env file. The
next minute's run picks it up. Watch
`/srv/baci-worker/baci-workers/logs/piggyvest-webhook-capture-drain.log` for
lines like `{"status":"drained","claimed":0,...}`.

Run the readiness check again: it should now exit 0 with
`"readyToAttest": true`.

## Step 5 (optional): let the drain own the retry

On the web app, `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED=true` makes the
receiver answer 200 (instead of 503) when processing fails after capture,
so PiggyVest stops redelivering and the drain finishes the delivery.

Only set it when **all** of these hold:

- the readiness check exits 0 (`"readyToAttest": true`);
- the web app holds **no legacy-family webhook key**: `PIGGYVEST_SECRET_KEY`
  and `PVB_SECRET_KEY` are empty and `PIGGYVEST_WEBHOOK_KEY_ARCHIVE` has no
  legacy entry still inside its overlap window. The drain does not replay
  legacy-family deliveries, so for those the provider's redelivery must stay
  the retry.

Without this step the drain still finishes primary deliveries; the receiver
simply keeps asking PiggyVest to redeliver as well.

## Switching it off

1. If Step 5 was done, unset `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED` on
   the web app first, so the receiver goes back to asking for redelivery.
2. Set `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED` to anything other than
   `true` (or remove it). The next run does nothing.
3. To withdraw the login entirely: `ALTER ROLE baci_piggyvest_webhook_capture_drain NOLOGIN;`

Stored deliveries are never deleted by any of these steps. A delivery that
was claimed when the drain stopped returns to the queue after five minutes.

## Alerts

- `PIGGYVEST_WEBHOOK_REPLAY_DEFERRED`: a delivery only the legacy path can
  finish was left in the queue. Check that the receiver's redelivery
  finished it; the alert repeats (at most hourly per delivery) until then.
- `PIGGYVEST_WEBHOOK_NEEDS_REVIEW`: a delivery cannot be finished
  automatically (for example a conflicting redelivery or an unreadable
  body). It stays stored for review.
- `PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED`: the host's key set is incomplete;
  affected deliveries wait without using up their retries.
