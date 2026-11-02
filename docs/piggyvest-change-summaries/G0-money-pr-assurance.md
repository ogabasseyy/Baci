# A money-safety check on every pull request

Task: G0-money-pr-assurance
Owner sign-off: not required

## What changes

Every pull request now gets a status called money-pr-assurance. If the change
touches how wallet, savings or PiggyVest money moves, the status only turns
green when the extra safety steps for money changes are done on the latest
version of the change. Every other pull request turns green straight away.

## Why

The plan asks money changes for two independent AI reviews from different
companies that try to break the money rules, green database tests, sandbox
proof or a statement of what keeps the change switched off, and a
plain-English summary like this one.

## What could go wrong and how it is prevented

A money change could slip past unnoticed. The check looks for money words
anywhere in the server, database and tooling folders, plus known money files
with other names, and tests prove it recognises today's money code.

A review or approval given on an older version could be reused. Every review
and your approval must name the exact latest version, so any new push needs
them again. A Codex review counts only when asked to use the money rules.

Someone could fake a reviewer. Only the Codex and Claude apps count, and a
review anyone else edited no longer counts. Gemini is left out for now
because it posts under a shared identity any workflow can use. Agents use
your account, so they are told never to write your approval.

A pull request could try to weaken the check itself. The check only ever
runs its rules from the main branch, and any change to those rules needs
your approval as well as the two reviews.

If the check cannot read GitHub or its settings, it reports an error, never
a pass, and replaces any earlier green status when it can.

## How it is tested

Automated tests cover an ordinary pull request passing, and a money pull
request failing when the summary is missing, when only one AI company has
reviewed it, when a review is for an older version, was edited by someone
else or was never asked to use the money rules, when a review comment is
unresolved, when the linked sandbox proof is old, and when your approval is
missing, comes from someone else or names an older version. Summaries with
code, more than 450 words or a missing heading also fail.

## How it stays switched off

The status is advisory. Nothing is blocked until you make it a required
check, and before that it must get its own identity that other workflows
cannot copy. It can be made advisory again without a code change.
