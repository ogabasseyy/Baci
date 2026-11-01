# Immediate order notification recovery

The recovery worker records completion for an email whose provider acceptance
was durably recorded. It does not send email. A dispatch that may have reached
the provider but has no recorded acceptance remains fenced: the original claim
must not be reclaimed or retried automatically.

## Release sequence

The sender and cron are disabled unless `IMMEDIATE_NOTIFICATION_REDRIVE_ENABLED`
is exactly `true`. Do not enable that flag merely because the code is deployed.
The current migrations create the restricted role and stage its request hook;
they intentionally do **not** grant the role to `authenticator`. The
attempt-ownership migration refuses to run if legacy dispatch rows exist,
because they cannot be assigned safely to a particular sender. Reconcile any
such rows before applying it; do not delete them merely to pass the migration.

Before enabling the flag:

1. Apply and verify the database migrations through the normal release process.
2. Verify the anonymous POST to
   `/rest/v1/rpc/__immediate_notification_redrive_complete_hook_canary__` is
   rejected with SQLSTATE `42501` and the `IMMEDIATE NOTIFICATION COMPLETE hook
   reload canary observed` message. This canary follows the backlog-monitor
   allowlist change; the earlier redrive canary alone does not prove that later
   guard is loaded. A normal
   successful response means the serving instance has not loaded the hook.
   Run `.github/scripts/probe-immediate-notification-hook-reload.sh` with the
   target project reference, management token, Supabase URL and anonymous key
   in the environment. It re-notifies both reload channels and requires a
   continuous window of observed acknowledgements. A single successful probe
   is not fleet-wide evidence; sticky routing can conceal stale instances.
3. Review and deploy a separate role-membership activation only after the fleet
   verification. That activation is not included in the current migrations.
   Confirm the role can invoke only the documented recovery RPCs and cannot
   call unrelated RPCs or read the dispatch table directly.
4. Provision an independently signed, short-lived worker JWT with role
   `immediate_notification_redrive` in the server-only
   `IMMEDIATE_NOTIFICATION_REDRIVE_WORKER_TOKEN` setting. Confirm the endpoint
   and credential configuration and the scheduled cron in the target environment.
5. Prove the full flow with synthetic data: a confirmed acceptance is completed
   by the worker after an unrecorded completion, while an uncertain dispatch
   remains fenced. Confirm the aggregate backlog warning reaches the operator's
   monitoring system before enabling the flag.

The current client accepts only the configured production Supabase host. A
staging rollout needs an explicitly reviewed environment-specific host policy;
do not point a production credential at an arbitrary endpoint to work around it.

## Triage

The cron logs `Immediate notification deliveries require reconciliation` when
the bounded batch contains unresolved rows or an independent aggregate check
finds a stale dispatch or conflicting accepted record. The boolean is a signal,
not a count of all affected orders. The cron response and logs contain no
recipient address, claim token, or provider response body.

Investigate using restricted operational access and the provider's authoritative
delivery evidence. A timeout, an absent audit row, or a missing provider lookup
result is not proof that the email was not accepted. Preserve the fence while
the outcome remains uncertain. Escalate unresolved records and confirmed lease
conflicts to the owning engineering team; the current worker intentionally has
no operator override or automatic resend operation. Any corrective action must
be separately reviewed and tied to authoritative evidence for that exact order
and attempt. Never log the worker JWT, claim token, recipient address, or provider
payload in an incident channel.

If the cron returns `Immediate notification recovery failed`, check the
deployment flag, cron authentication, worker token expiry, endpoint, hook and
database health. Do not repeatedly rotate credentials or clear dispatch rows
without establishing the cause. A confirmed accepted row remains protected while
recovery is unavailable.
