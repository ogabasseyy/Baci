# Staging checkout retirement

This owner-only procedure retires the explicitly approved, unconfirmed test
checkout `d8bcf921-61b3-4647-90e2-5648e4d6967d`. It does not mark a Paystack
transaction failed and does not start a replacement payment.

## Confirmed refusal

The September 29 rollback-only diagnostic matched all 11 deployed function
baselines and identified `verification-lease-active` as the sole state refusal.
The background timer can renew verification leases while an unresolved checkout
is pending. Waiting without preventing new background runs is not a reliable
retirement procedure.

## Corrected sequence

1. Verify the exact approved checkout, runtime, worker identity, and systemd units.
2. Pause only the background timer, allowing the current worker to finish.
3. Hold the existing runner lock and wait for verification/dispatch leases to
   expire naturally. Do not clear lease fields or change retirement predicates.
4. Obtain fresh provider verification, then rehearse the unchanged guarded
   retirement transaction with `ROLLBACK`.
5. Install the compatible, pinned public application; reverify the provider and
   mounted configuration; apply the guarded retirement transaction.
6. Verify the customer still has 10,000 kobo principal and only the unused
   10,000-kobo reservation was released. Retain the old attempt and its audit.
7. Restore the previously active background timer on success or failure, subject
   to unchanged identity and the existing deadline. Never enable an originally
   inactive timer or extend the September 29, 2026 15:59:10 UTC deadline.

The public endpoint can still receive traffic. Any competing state change must
fail the transaction's existing locks, exact-state checks, or lease guards; it
must not be bypassed to obtain a successful retirement.

## Operator handoff

Run the freshly sealed `activation-retire-checkout.sh` from the Mac. Keep the SSH
session open through `STAGING_CHECKOUT_RETIRED`. The wait may take several
minutes while a worker finishes or a lease expires. Only redacted stage reports
are printed; provider credentials and error bodies must remain private.

Do not declare phone readiness from the marker alone. Verify authenticated
public terminal refresh, capacity, and unchanged principal afterward. A refused
or disconnected run is not permission to create another payment or release the
reservation manually.
