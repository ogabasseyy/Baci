# Codex review evidence

The `Codex Review Evidence` workflow observes the existing Codex app's pull
request comment and publishes an advisory status for its code review of the
current commit. It does not start a review or evaluate the separate security
review. Missing, stale, malformed, or ambiguous evidence stays pending.

This comment format is an observed integration detail, not a signed review
API. Statuses reflect the last successful observation; comment changes and API
failures can temporarily leave an older status visible. Do not use this status
as a required security or merge gate. GitHub branch protection and human review
remain independent. The workflow runs on a GitHub-hosted runner because it has
permission to write statuses; this consumes a small amount of hosted Actions
time even after private CI is enabled. Existing account budgets still apply.
