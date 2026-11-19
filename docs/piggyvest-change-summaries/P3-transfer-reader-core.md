# One careful way to check a PiggyVest wallet transfer

Task: P3-transfer-reader-core
Owner sign-off: required

## What changes

This adds one shared checker that asks PiggyVest what happened to a wallet
transfer we sent, and decides whether the answer really belongs to that
transfer. It adds a fixed naming scheme for transfer attempts, so each try
gets its own reference that is never used twice. It also makes provider
requests stop completely when an answer is too large or too slow.

## Why

The new settlement engine must only count a transfer as done when PiggyVest
clearly confirms that exact transfer. Today several places read PiggyVest
answers slightly differently; this gives the engine one strict reader built
on the rules already in use.

## What could go wrong and how it is prevented

An answer could describe a different transfer. The checker only accepts it
when our reference, the amount and both wallets match in the right
direction; a transfer the wrong way round is rejected.

The money could be in another currency. PiggyVest's answer usually names no
currency, so naira is only accepted when both of our registered wallets are
naira, and any answer naming another currency is rejected.

A fee could be taken. The checker reports the fee and who pays it: the
source wallet by default, or our own Fee wallet when fees are set to go
there. Later steps will only settle a fee paid by our Fee wallet.

PiggyVest answers "not found" for a transfer it has not finished recording.
The checker never treats that as proof nothing was sent, so it never
releases money or resends the transfer on it.

A retry could reuse a reference and pay twice. The naming scheme refuses any
attempt that is not newer than every earlier attempt.

A slow or oversized answer could tie up the system. Requests are now cut off
at their limits.

## How it is tested

Automated tests use the answer shapes recorded in the 31 October sandbox run
and copies of PiggyVest's published examples. They cover confirmed, pending
and failed transfers, "not found", and the real sequence of not found, then
pending, then confirmed. They also cover a fifteen naira fee with its payer,
a foreign currency, a missing currency, swapped wallets, wrong amounts,
unreadable answers, reference reuse, and requests cut off for size or time.
Deliberate faults were planted to confirm the tests catch them.

## How it stays switched off

Nothing uses the new checker or naming scheme yet. They stay unused until a
later change adopts them and you switch the settlement engine on. The
request cut-off only acts on a request that is already failing, so
successful requests behave exactly as before.
