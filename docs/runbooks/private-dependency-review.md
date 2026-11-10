# Dependency review in private Baci

On the current private-repository plan, GitHub's dependency-review action is
not available. The workflow skips that action in private repositories and
shows a separate notice that no pull-request dependency or license review ran.
Public repositories continue to use the existing action and license policy.

Keep Dependabot alerts and updates enabled. They are separate coverage and do
not replace a review of dependency additions, changes, licenses, or install
scripts. Until a tested replacement or the applicable GitHub entitlement is
available, review dependency and lockfile changes manually before merging.
Do not treat the private notice as a clean dependency-review result.

If private dependency-review entitlement is added later, update the workflow
and its availability tests, then exercise the actual action in a private trial
repository before relying on it.
