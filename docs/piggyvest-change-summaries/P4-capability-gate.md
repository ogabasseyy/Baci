# Who may open a PiggyVest wallet, and from which app version

Task: P4-capability-gate
Owner sign-off: required

## What changes

This adds the gate that will decide whether the new PiggyVest wallet is
offered. First, the app version: new storefront builds will report their
build number, which the server compares with a minimum you set for iPhone
and for Android. Second, a new, empty
list of customers who may set up the new wallet. Third, a checklist of nine
parts of the system (interest marker, ledger fences, settlement worker,
spending, airtime, IMEI checks, checkout, webhook capture and the legacy
balance move). A new customer may start setup only when their app is new
enough, they are on the list and all nine checks pass. A customer whose
wallet is verified, or whose setup is under way, only needs a new enough
app, so leaving the list never strands a half-made wallet.

## Why

Older apps cannot read some newer wallet answers, so they must keep using
the current wallet. No customer should get a PiggyVest-backed
wallet before every part that protects their money is proven ready.

## What could go wrong and how it is prevented

An old app could slip through. A missing or garbled version counts as old,
and while either minimum build is unset every app is refused.

A refusal could break an old app. Every refusal uses an answer released apps
already read as "carry on with the current wallet"; a test checks this
against the app's own list.

A database hiccup could misroute someone. A failed check answers "try
again later", never a refusal.

A half-finished system could let customers in. All nine checks start as
"not ready", and any unclear answer counts as not ready.

An over-the-air update could put older app code on a new build. The
deployment notes require unsetting or raising the minimum builds before any
such rollback.

The list could leak. Only the wallet setup login can ask about it, only for
the requesting customer, and the answer is just yes or no.

## How it is tested

Automated tests cover missing, garbled, old, exactly-minimum and newer
builds on both platforms; unset minimums; each checklist item turned off
alone; verified and mid-setup customers outside the list; and failed
reads. Database tests prove the list starts empty, answers only for the
exact customer, refuses other shops, other users and a disabled setup, and
only the wallet setup login can use it. Planted faults were caught.

## How it stays switched off

No route uses the gate yet, and once one does it stays
closed: both minimum builds are unset, the list is empty and all nine
checks report "not ready".
