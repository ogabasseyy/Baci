# PE3: reconciliation index and rotation

## What changes
The daily PiggyVest reconciliation read gets database indexes covering funding, cancels and completions so it stays fast as the savings history grows. It also stops always returning the same first 500 wallets and first 200 stuck transfers. Each day it returns a different page of each list and wraps round, so a large book is fully checked over several days.

## Why
Before the reconciliation is switched on, it must finish inside the database's 2.5 second limit and must not quietly ignore wallets beyond the first 500.

## What could go wrong and how it is prevented
A wallet could be skipped forever. The page moves by exactly one page per day and wraps, so consecutive days cover the whole list. A test with 1,100 wallets checks all of them are seen within three days. Stuck transfers are best effort, because the stuck set changes between days; they are always counted and always page, only some detail may wait.

Expected balances could ignore refunds and completed goals, paging the owner for every closed goal. The read keeps subtracting settled cancels and completions from confirmed funding, and a test with a cancelled and a completed goal expects zero for both.

A wrong "left out" figure could hide rows. The app refuses any database answer where the left-out count does not equal the total minus the rows listed, and reports the run as failed rather than clean.

A malformed or missing day number could be accepted. The database requires both options, refuses anything that is not a whole non-negative number, and the app fails the run if its clock gives an unusable value.

Wallets left out could page the owner every day and become noise. They do not page, since later days cover them. Stuck transfers still page, because any stuck transfer pages. A shortfall found inside a day's page still pages.

## How it is tested
Unit tests cover the schema, report wording, paging rules, the day number, and a 1,100 wallet simulation. A database suite checks both indexes exist with the right columns, that 1,100 wallets and 250 stuck transfers rotate to full coverage, that repeating a day gives the same page, and that bad options are refused. The existing read suite is updated for the new option and the access rules are re-checked.

## How it stays switched off
Nothing calls the reconciliation unless the owner sets its own switch to true, and the daily job is not on the server schedule yet. The change only reads; it moves, settles and releases no money.
