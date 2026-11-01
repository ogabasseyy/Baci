# Staging approval retry recovery

A 500 response to approval is indeterminate: do not automatically replay approval,
show success, or assume that Oxygen made no change. Request explicit authorization
from Oxygen for the affected reference before an operator permits a retry.

`20261029055000_oxygen_operator_approval_retry.sql` adds a private, operator-only
SECURITY INVOKER function. No anonymous, authenticated, or workflow-worker role
can execute it. There is no customer-facing override endpoint.

The operator supplies the exact workflow, uncertain approval command, booking
reference, expected workflow version, and provider authorization. The operation
requires isolated staging, a BOOKED plan with verified address, an unpaid owned
order with unchanged amount, a captured approval HTTP 500 diagnostic, and no
other pending command. It refuses reference mismatches and authorization replay.

It records the original indeterminate status, stage, version and operator reason
before marking the command `superseded`. This status means an explicitly permitted
new attempt; it does not establish that the original attempt failed. Original
response evidence, diagnostics and history remain intact. The expired activity
token is cleared and the same workflow returns to `approval_required`.

The customer then uses the existing checkout flow: Continue on the saved plan,
sign and accept, Continue to request a fresh OTP, enter the new code. Only a
confirmed approval response completes the success animation. Each new uncertain
attempt blocks again and requires its own provider authorization. Recovery itself
makes no provider request, changes no booking or ownership, and does not enable
activation or settlement.

Regression: `supabase/tests/oxygen_operator_approval_retry.sql` runs inside a
rollback transaction. It covers app-role refusal, wrong reference, stale version,
audited original uncertainty, preserved booking and diagnostic, cleared old token,
new command admission, and replay refusal.
