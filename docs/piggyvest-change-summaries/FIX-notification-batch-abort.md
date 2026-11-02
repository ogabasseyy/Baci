# Keep scheduled notifications moving when one cannot be closed

Task: FIX-notification-batch-abort
Owner sign-off: not required (bug fix; no money movement)

## What changes

The scheduled notification worker picks up to ten due notifications at a
time and handles them one after another. When one fails to send, the worker
marks it "try again later"; when one runs past its expiry time it is marked
"expired". If saving either mark failed, the worker gave up on the whole
group, so the notifications after it were skipped.

Now a failed mark only affects that one notification. It is reported as
"failed" with a short reason and the worker carries on with the rest of the
group. When the database says the worker no longer holds a notification
(another run took it over), the worker leaves it alone instead of trying to
mark it a second time.

The worker's health record and reply now say "failed" (reply code 503)
whenever any notification in the group could not be marked. A group with
only "try again later" results behaves as before.

## Why

One temporary database hiccup on one notification could hold back every
notification queued behind it until a later run picked them up again. That
delayed messages to merchants and hid the real cause in the health check.

## What could go wrong and how it is prevented

A notification could be sent twice. The worker still only finishes a
notification while it holds that notification's claim, and never makes a
second attempt to mark one whose claim was lost.

A failure could be hidden. Each unmarked notification is listed as "failed"
with its reason, the health check turns critical, and the reply code is 503.
The notification is not lost: its claim expires after fifteen minutes and a
later run retries it under the existing three-attempt limit.

No database change is made. The health record already accepts the new
reason code.

## How it is tested

New tests run two notifications where the first cannot be marked, covering
a failed send, an expiry during sending, a malformed notification and a lost
claim. Each failed on the current main branch because the whole group
stopped, and each passes with this change, showing the second notification
is still sent. Further tests cover the health and reply code rules, and an
existing safety check now confirms the worker uses them.

## How it stays switched off

This fixes an existing worker; there is no new feature or switch. It does
not touch payments, wallets or PiggyVest. Merging does not change production
by itself: the worker only changes when its Supabase function is next
deployed, which is a separate, manual step.
