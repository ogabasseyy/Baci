# Check whether a customer has started PiggyVest wallet setup

Task: P2-onboarding-presence
Owner sign-off: required

## What changes

When a customer opens their PiggyVest wallet screen, the server first asks
our own database one yes-or-no question: has this customer ever started
wallet setup? If the answer is no, the server replies straight away,
without asking PiggyVest or reading any review records.

A new database check answers that question. Only the restricted wallet
setup group may run it. The app's public roles and the general server role
may not.

## Why

Before this, a customer who had never started setup still caused calls to
PiggyVest and several database reads, only to end up with "setup pending".
Answering from our own records first is quicker, cheaper and never shows
PiggyVest anyone who has not asked for a wallet.

## What could go wrong and how it is prevented

Phones already in customers' hands only understand two answers, "pending"
and "ready". A new answer would break their wallet screen until they
update. So the new "not started" answer goes only to an app that says it
understands it. Every other app keeps getting "pending", exactly as before.

The check could mix up customers or stores. It only counts setup records
for the same customer, store and wallet connection as the person asking.
Tests plant records for another customer, a second connection of the same
store and another store, and confirm none of them count.

A failed or garbled database answer could be read as "not started" and
invite a second setup. Instead the server refuses with "temporarily
unavailable" and never guesses.

The new check could be run by the wrong people. Its permissions are
removed from everyone except the setup group, and a test confirms this
holds even on a database that hands such rights out by default.

## How it is tested

Automated tests cover the "not started" reply for an app that asks for it,
the unchanged "pending" reply for current apps, and the refusal when the
database answer fails or is garbled. Database tests run on a real
PostgreSQL: they cover never started, started, finished, released, other
customers, other connections, other stores, mismatched or switched-off
connections and the permission list. Deliberate faults (a missing store
filter, a missing permission removal) were planted to confirm the tests
catch them.

## How it stays switched off

The wallet screen answers "temporarily unavailable" until the PiggyVest
wallet settings are configured, and they are not. The database change only
adds a read-only check; it moves no money and changes no account. Current
mobile apps see no difference, and no app asks for the new answer yet.
