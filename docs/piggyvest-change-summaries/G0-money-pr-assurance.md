# A money-safety check on every pull request

Task: G0-money-pr-assurance
Owner sign-off: not required

## What changes

Every pull request now gets a status called money-pr-assurance. If the change
touches how wallet, savings or PiggyVest money moves, the status only turns
green when the extra safety steps for money changes are done on the latest
version of the change. Every other pull request turns green straight away.

## Why

Money changes need more care than ordinary changes. The plan asks for two
independent AI reviews from different companies that actively try to break
the money rules, green database tests, proof from the PiggyVest sandbox or a
clear statement of what keeps the change switched off, and a plain-English
summary like this one that you can read and approve.

## What could go wrong and how it is prevented

A review or approval given on an older version could be reused after new
code is pushed. Every review and your approval must name the exact latest
version, so any new push needs them again.

Someone could pretend to be a reviewer. Only comments from the Codex, Claude
and Gemini apps count, and your approval only counts from your own account.
Because agents also use your account, agents are told never to write your
approval.

A pull request could try to weaken the check itself. The check always runs
its own rules from the main branch, and changes to those rules are treated as
money changes too.

The check could break and wave things through. If it cannot read GitHub or
its settings, it reports an error, never a pass.

## How it is tested

Automated tests cover an ordinary pull request passing, and a money pull
request failing when the summary is missing, when only one AI company has
reviewed it, when a review is for an older version, when a review comment is
unresolved, and when your approval is missing, comes from someone else or
names an older version. Summaries with code, more than 450 words or a missing
heading also fail.

## How it stays switched off

The status is advisory. Nothing is blocked until you choose to make it a
required check in the repository settings, and it can be made advisory again
at any time without a code change.
