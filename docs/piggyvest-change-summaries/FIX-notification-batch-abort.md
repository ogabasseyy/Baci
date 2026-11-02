# Keep scheduled notifications moving when one cannot be closed

Task: FIX-notification-batch-abort
Owner sign-off: not required (bug fix; no money movement)

## What changes

The scheduled notification worker handles up to ten due notifications at a
time. A notification that fails to send is marked "try
again later"; one past its expiry time is marked "expired". If saving either
mark failed, the worker gave up on the whole group and skipped the rest.

Now a failed mark only affects that one notification. It is reported as
"failed" with a short reason, logged once, and the worker carries on with
the rest of the group. A notification that expired before sending is marked
"expired" exactly once, like one that expires while sending. When another
run has taken a notification over, the worker leaves it alone.

A notification that arrives so damaged that nothing identifies it (not an
object, or an id or claim code that is not valid) cannot be marked at all.
It used to stop the whole group the same way. It is now reported as "failed"
with the reason `unidentifiable_claim_skipped` and no id, logged once with
fixed fields only, and the worker carries on. Its claim expires on its own
and a later run picks it up again.

The worker's health record and reply say "failed" (reply code 503) whenever
any notification could not be marked. A group with only "try again later"
results behaves as before.

## Why

One temporary database hiccup on one notification could hold back every
notification queued behind it until a later run. That delayed messages to
merchants and hid the real cause in the health check.

## What could go wrong and how it is prevented

A notification could be sent twice. The worker only finishes a notification
while it holds its claim, and never re-marks one whose claim was lost.

A failure could be hidden. Each unmarked notification is listed as "failed"
and logged, the health check turns critical, and the reply code is 503. The
log line carries only fixed fields, never raw database or provider error
text. The notification is not lost: its claim expires after fifteen minutes
and a later run retries it under the existing three-attempt limit.

No database change is made. The health record already accepts the new
reason code.

## How it is tested

New tests run two notifications where the first cannot be marked: a failed
send, an expiry before and during sending, a malformed notification, one that
cannot be identified at all, and a lost claim, plus the log line. Each failed on the current main branch and
passes with this change, showing the second notification is still sent.
Further tests cover the health and reply code rules. The tests sit in the
web test suite that the automated checks run, and a safety check keeps that
suite running whenever the worker's files change.

## How it stays switched off

This fixes an existing worker; there is no new feature or switch. It does
not touch payments, wallets or PiggyVest. Merging alone changes nothing in
production: the worker changes only when its Supabase function is next
deployed, a separate manual step.
