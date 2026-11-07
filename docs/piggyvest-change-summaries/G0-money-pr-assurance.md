# A money-safety check on every pull request

Task: G0-money-pr-assurance
Owner sign-off: not required

## What changes

Every pull request now gets a status called money-pr-assurance. If the change
touches how money moves (wallets, savings, PiggyVest, payments, checkout,
refunds, airtime or IMEI), the status only turns green when the extra money
safety steps are done on its latest version. Others turn green at once.

## Why

The plan asks money changes for two independent AI reviews from different
companies that try to break the money rules, green database tests, sandbox
proof or a statement of what keeps the change switched off, and a
plain-English summary like this one.

## What could go wrong and how it is prevented

A money change could slip past unnoticed. The check looks for money words
anywhere in the code, screens included, plus known money files with other
names, and reads what each database change says. A test finds today's money
code by what each file does and fails if the check misses any of it.

A review or approval given on an older version could be reused. Every review
and your approval must name the exact latest version in full, so any new push
needs them again. A review counts only when it answers the latest request to
use the money rules on that exact version.

Someone could fake a reviewer. Only the Codex and Claude apps count, and a
review anyone else edited, hid or dismissed no longer counts. Gemini is left
out because it posts under a shared identity. Agents use your account, so
they are told never to write your approval.

A pull request could try to weaken the check itself. The check only ever
runs its rules from the main branch, and any change to those rules needs
your approval as well as the two reviews.

If the check cannot read GitHub or its run breaks, it retries, then reports
an error, never a pass, replacing any earlier green status.

## How it is tested

Automated tests cover an ordinary pull request passing, and a money pull
request failing when the summary is missing, when only one AI company has
reviewed it, when a review is old, edited, hidden, dismissed or unrequested,
when a review comment is unresolved, when the sandbox proof is old, and when
your approval is missing, from someone else or for another version.
Summaries with code, more than 450 words or a missing heading also fail.

## How it stays switched off

The status is advisory. Nothing is blocked until you make it a required
check, and before that it must get its own identity that other workflows
cannot copy. It can be made advisory again without a code change.
