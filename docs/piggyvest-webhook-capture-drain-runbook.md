# PiggyVest webhook capture drain: runbook

The web receiver stores every authentic PiggyVest webhook delivery before it
answers (the durable capture). The **capture drain** is the background job
that finishes any stored delivery whose processing did not complete, for
example after a crash or a database blip.

The drain runs on the worker host (VPS) every minute. It connects to the
database with its **own login**, never the service-role key, and that login
can only lease, count and settle captured deliveries. It can settle only a
delivery it leased itself.

Everything below is for the owner to run later, with approval. Nothing in
the pull request that adds the drain changes production behaviour by itself.

## What it does on each run

1. Does nothing at all (no configuration read, no connection) unless
   `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED=true` is set in the worker env file.
2. Otherwise connects as `baci_piggyvest_webhook_capture_drain` and checks the
   session before anything else: exactly that login, a member of
   `piggyvest_webhook_capture_worker` and of nothing else, no elevated rights,
   and a TLS connection. Any doubt stops the run.
3. Claims at most 10 stored deliveries, one at a time, that are at least two minutes old,
   re-checks each stored signature, and hands the ones a PiggyVest primary
   intake owns (bank inflow, card custody outflow, interest payout) to that
   intake, which writes through its own dedicated login. A delivery signed
   with a key this host does not hold yet waits (it is retried later and
   never used up) and raises `PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED`.
4. Sets aside, for review, deliveries that only the legacy path can finish
   (legacy-family deliveries and record-only events such as interest
   accruals) and raises a `PIGGYVEST_WEBHOOK_REPLAY_DEFERRED` alert. They
   leave the drain's queue, so they can never hold up other deliveries. The
   web receiver keeps asking PiggyVest to redeliver them, and a successful
   redelivery closes them automatically.

Each pass admits new work for ten seconds and reserves the rest of the 50-second
cron bound for the current replay, settlement and alert delivery. Before each
replay the worker renews its still-live claim through its restricted settle
entry point; a stale token, expired lease or late renewal response prevents
replay. GNU timeout uses `--verbose`, and the wrapper also records timeout exits.

Unavailable primary families are deferred without spending an attempt; ready
families continue. A mixed-family delivery that a ready primary intake declines
also waits without spending attempts if its authorized legacy fallback is
unconfigured; primary successes do not wait for that fallback. If every family is unavailable the pass reads review
metadata only and claims nothing. Every enabled pass checks review metadata
before and after draining and writes a concise status line. It pages when the
number of parked rows increases, persisting that count under the worker's
`$XDG_STATE_HOME/baci/piggyvest-capture-review.json` (or
`~/.local/state/baci/piggyvest-capture-review.json` when unset). A failed page
does not advance the saved count, so the next pass retries it.

Replaying is safe to repeat: every downstream ledger is keyed on PiggyVest's
transaction id. If the job is killed mid-run, the claimed delivery returns
to the queue five minutes later and the next run finishes it.

## Before you start

- The migration `20261102202552_piggyvest_webhook_capture_worker_role` is
  applied by the normal deploy (it only creates the non-login role, one
  claim-bound settle function, and three grants). Apply the append-only
  `20261107121500_piggyvest_capture_claim_recovery` migration too. Worker
  status must report `claimRecoveryVersion: 1`; an older database fails closed
  before any claim and cannot pass worker readiness.
- The worker env file already holds the PiggyVest primary configuration the
  intakes need (database host/port/name/CA, the **current bank, custody and
  interest signing keys, the same as the web app's**, each intake's own
  settings, and the same environment marker the other PiggyVest primary
  workers use). Without it the drain can claim deliveries but cannot finish
  them, and they wait for a later run. When a key is rotated on the web app,
  copy it to the worker host too.
- The worker env file holds `POSTHOG_PROJECT_TOKEN`, so the drain's alerts
  reach PostHog as the `piggyvest_money_alert` event (see
  docs/piggyvest-money-alerts.md). On this host the console line only goes
  to a local log file that nobody watches.

## Step 1: create the login (privileged database session)

Generate the password in the password manager. Never paste it into chat,
a ticket, the repository, or **any SQL text**: SQL is kept in editor
history, `~/.psql_history` and the database's statement logs.

Create the login without a password:

```sql
CREATE ROLE baci_piggyvest_webhook_capture_drain
  LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
  CONNECTION LIMIT 3
  IN ROLE piggyvest_webhook_capture_worker;
```

Then set the password from `psql`, which prompts for it and sends only a
hashed verifier (the password itself is never part of a statement):

```
\password baci_piggyvest_webhook_capture_drain
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
pass except `drain_schedule: DRAIN_NOT_ENABLED`. Fix anything else first:

- `DRAIN_LOGIN_UNSAFE` lists which session check failed;
- `DRAIN_FAMILY_KEY_MISSING:<families>`: the host lacks the current key of
  those families. With the default legacy lane off, readiness requires the
  primary families. With `PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED=true`,
  readiness requires the legacy key; primary keys are required only for
  primary families also configured on the host;
- `PRIMARY_INTAKE_NOT_READY:<families>`: the primary intake of those
  families (bank, custody, interest) is switched off or not fully configured
  on this host, so the drain would answer every replay of that family with a
  retry and, once the attempt budget ran out, leave it for review. Enable and
  configure the intake in the worker env file first. A signing key alone is
  not enough;
- `LEGACY_INTAKE_RUNTIME_NOT_READY`: the optional lane is enabled but the
  existing restricted webhook-intake login settings are missing or malformed.
  The drain still monitors review metadata and processes ready primary-owned
  captures. Legacy-dependent captures are deferred without spending replay
  attempts. If every primary intake is unavailable, the pass reports
  `legacy_intake_not_ready` without claiming rows. The runtime uses
  `PIGGYVEST_WEBHOOK_INTAKE_DB_PASSWORD` and shared verified TLS database
  settings; it does not use service-role credentials;
- `DRAIN_ALERTS_NOT_CONFIGURED`: `POSTHOG_PROJECT_TOKEN` is missing.

The worker host cannot see the web app's setting from Step 5, so the
report says `"processingFailureReply": "unknown"`; that is expected.

## Step 4: switch the drain on

Set `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED=true` in the worker env file. The
next minute's run picks it up. Watch
`/srv/baci-worker/baci-workers/logs/piggyvest-webhook-capture-drain.log` for
lines like `{"status":"drained","claimed":0,...}`.

Run the readiness check again: it should now exit 0 with
`"readyToAttest": true`. Keep running it (for example daily, and after any
key rotation): once the drain is on, `worker: DRAIN_BACKLOG_STALE` means a
stored delivery has waited more than 15 minutes, so the drain is not
finishing work.

## Step 5 (optional): let the drain own the retry

On the web app, `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED=true` makes the
receiver answer 200 (instead of 503) when processing fails after capture,
so PiggyVest stops redelivering and the drain finishes the delivery.

Only set it when **all** of these hold:

- the readiness check exits 0 (`"readyToAttest": true`);
- either leave legacy replay off and keep current or overlapping legacy keys
  off the web app, or explicitly enable
  `PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED=true` on the worker and
  pass readiness with the legacy key and restricted intake runtime present;
- when legacy replay is off, accept that record-only events (such as interest
  accrual notices) whose processing fails are set aside for review and are
  not redelivered. No money moves on those events.

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

All alerts reach PostHog as `piggyvest_money_alert` once
`POSTHOG_PROJECT_TOKEN` is set on the host.

- `PIGGYVEST_WEBHOOK_REPLAY_DEFERRED`: a delivery only the legacy path can
  finish was set aside for review. A successful PiggyVest redelivery closes
  it on its own; if it is still in review a day later, finish it by hand.
- `PIGGYVEST_WEBHOOK_NEEDS_REVIEW`: a delivery cannot be finished
  automatically (for example a conflicting redelivery or an unreadable
  body). It stays stored for review.
- `PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED`: the host's key set is incomplete
  or out of date (for example a rotation not copied over); affected
  deliveries wait without using up their retries.

## Captures already parked before enabling legacy replay

Enabling the legacy lane does not release `needs_review` rows. Before rollout,
count rows whose state is `needs_review` and whose exact last error is
`REPLAY_OUT_OF_SCOPE_LEGACY_FAMILY`. The production metadata check on
2026-11-08 found zero such rows. A nonzero count requires a separate, audited
recovery of those specific captures after signature and ownership verification.
Do not broaden the worker login or release unrelated quarantines. A verified
provider redelivery still settles its matching capture through the receiver.

## Replaying a parked delivery (operator requeue)

PiggyVest cannot resend a webhook on request; it only retries on its own for
a while. Once those retries stop, the stored capture is the only copy of the
event. When a delivery is parked for review (`needs_review`) because of a bug
or outage that has since been fixed, an operator puts it back in the drain
queue with the replay tool. The tool never processes anything itself: the
regular drain claims the delivery again, re-checks the stored signature
against the current and archived keys exactly as it does for every capture,
and processes it. The ledgers ignore an event they already applied, so
requeueing a delivery that was in fact already credited credits nothing twice.

**Before any live replay**, confirm the ledger that the event reaches dedupes
on the provider's stable key. For bank inflows that key is `pvb_reference`
(PiggyVest confirmed it on 2026-11-11); the fix that makes it the credit
dedupe key is PR #4199. Without that fix, a delivery that was parked after a
partial credit could otherwise be credited again, so the database enforces
it: requeueing a bank inflow, an interest payout, or a capture with no
readable event type returns `credit_dedupe_missing` and changes nothing until
both ledgers enforce uniqueness on `pvb_reference` alone (#4199's UNIQUE
constraints, or any full unique index on that column).

Each requeue gives the delivery a fresh attempt budget and writes an
append-only audit row (who, from the database login; when; why). A delivery
can be requeued at most five times.

### One-time setup (owner, with approval)

Create a personal operator login for each person who may replay, as a member
of `piggyvest_webhook_capture_operator` only. Never use `postgres`,
`service_role`, the drain login or the intake login, and never add an operator
login to `piggyvest_webhook_capture_worker` or `piggyvest_webhook_intake`: the
tool refuses those logins by name and refuses any login that also holds a
pipeline role, so one person cannot both requeue and drain. Both database
functions (list and requeue) enforce the same session checks (operator role only, no pipeline
grants, no direct table access), so calling them directly from `psql`
cannot skip them. Encryption is enforced by the tool (direct host only,
`verify-full` TLS) and by the project's SSL enforcement: from SQL the
server can only see the last network hop.

Generate the password in the password manager and, as with the drain login,
never put it in any SQL text. Create the login without a password:

```sql
CREATE ROLE ops_<name> LOGIN IN ROLE piggyvest_webhook_capture_operator;
```

Then set the password from `psql`, which prompts for it and sends only a
hashed verifier:

```sql
\password ops_<name>
```

### Each replay

From `apps/web`, with your own login's connection string (TLS) in
`PIGGYVEST_CAPTURE_OPERATOR_DATABASE_URL`. It must be the **direct** database
connection (`db.<project-ref>.supabase.co`, port 5432), never the pooler on
port 6543: the tool's encryption check sees only the last hop into PostgreSQL,
which through a pooler is the pooler's own link. The tool accepts only that
direct host on port 5432 (or a loopback database for local testing).

1. `pnpm piggyvest:capture-replay list` shows parked deliveries (metadata
   only: id, event type, transaction id, attempts, last error). It shows up
   to 200 at a time, newest first; add `--offset 200`, `--offset 400`, and so
   on to page further. The preview of a requeue searches every page.
2. `pnpm piggyvest:capture-replay requeue <id> --reason "<what was fixed>"`
   previews the change; add `--yes` to do it.
3. The drain picks the delivery up on its next run (within a few minutes).
   Run `list` again: it is gone once processed. If it comes back with a new
   error, the fix did not cover it; do not keep replaying.
