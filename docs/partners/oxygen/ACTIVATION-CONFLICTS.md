# Oxygen activation reconciliation conflicts

A conflict means an activation was recorded as confirmed, but the local order or
booking no longer matches the evidence. The customer must not be told the order
is complete solely from that record. The existing activation evidence is retained;
the recovery path does not repeat activation or settlement.

An authorized database operator can inspect unresolved records with a read-only
query in the correct environment:

```sql
SELECT workflow_id, activation_id, observed_at
FROM oxygen_private.general_activation_reconcile_conflicts
WHERE resolved_at IS NULL
ORDER BY observed_at;
```

Escalate the workflow and activation IDs through the existing restricted payment
support process. Compare the recorded order and booking bindings with Oxygen's
confirmed activation and the order's current payment and cancellation state.
Keep customer identifiers and provider evidence out of public channels.

Do not clear the conflict, alter the order, retry activation, refund, cancel or
settle solely because this record exists. A reviewed, authorized reconciliation
procedure is required before resolution. This table does not provide a customer
notification or an automated resolution workflow; production operations must
monitor it and assign an owner before enabling activation.
