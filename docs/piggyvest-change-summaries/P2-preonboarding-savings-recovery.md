# Checking for a pending savings payment before onboarding is finished

Task: P2-preonboarding-savings-recovery
Owner sign-off: required

## What changes

When the app opens a savings goal, it first asks Baci whether a payment into
that goal is still on its way. Today that question only works for customers
who have fully finished PiggyVest onboarding. Everyone else gets an error,
and the app shows "could not check pending contributions" instead of
"nothing pending".

This change answers the question for any customer who owns the goal,
whatever their onboarding state. It is a read only: it never moves money
and never changes a record.

## Why

For most such customers the honest answer is "nothing pending", and where
a payment is in flight it should still be found. The error blocked the
savings screen needlessly.

## What could go wrong and how it is prevented

The answer could reach the wrong person. Baci still checks that
the request comes from the approved savings service, for the right merchant,
customer and signed-in user, and for a goal that customer owns. Any mismatch
is refused, as before.

"Nothing pending" could be wrong. If the app is told nothing is pending
while a payment is still in flight, it could let the customer pay twice.
That could happen if Baci were moved from one PiggyVest connection to
another (for example from testing to live) while a payment made through the
first was unsettled. Baci now says "nothing pending" only when no payment
into that goal is in flight at all. If one exists that it cannot match to
the current connection, it refuses to answer, and the app keeps blocking new
payments until the old one settles.

Starting a new payment still requires completed onboarding.

## How it is tested

A database test that runs on every pull request covers: a customer before
onboarding; a payment in flight during onboarding; settled and cancelled
payments being ignored; wrong merchant, customer, user, connection or goal;
badly shaped requests; the connection switch; and who may call the check.
It was also run against deliberately weakened versions to prove it
catches them.

A fuller test runs in a private local database on a developer machine, not
in CI. It also proves that a different service login is refused and that
nothing in the money records changes.

## How it stays switched off

Only the dedicated PiggyVest savings database login can call the check, and
only for a connection that is enabled and bound to that login. No customer,
merchant or public role can call it. New savings payments stay behind the
savings switch, which remains off in production. Live payments stay off.
