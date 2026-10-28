# Customer savings interest environment gate

The customer earnings and interest-history RPCs read exactly one ledger source:

- `staging` reads the existing staging-bound `piggyvest_savings_ledger`.
- `production` reads `piggyvest_primary` paid-interest receipts and reversals.

The append-only migration deliberately creates `savings_interest_private.deployment_environment`
empty. It does not derive an environment from a request, database name, project URL,
integration row, or migration default. Until the marker is configured, the earnings
and history RPCs fail closed; the mobile earnings projection presents that as
unavailable instead of returning a combined ledger amount.

## Provisioning gate

Provisioning is a separate, per-database operations step and is **not** part of
migration replay or this change. A database owner must independently verify the
target project and then insert exactly one row, choosing that database's verified
environment:

```sql
INSERT INTO savings_interest_private.deployment_environment (singleton, environment)
VALUES (true, 'staging'); -- use 'production' only on a separately verified production database
```

Do not run this statement as an application role or from a caller-controlled
request. The marker is RLS-protected, has no runtime grants or policies, and is
write-once (update, delete, and truncate are rejected). An incorrect marker needs
a separately reviewed database-owner recovery plan; do not work around the guard
by switching a setting or changing an integration row.

No staging or production database has been provisioned or activated by this change.

## Post-provisioning release check

Provisioning the marker is not sufficient evidence to release the customer
earnings surface. After the migration and marker are present in the same
database, use an authenticated session for a known customer in that environment
to call `get_customer_savings_interest_snapshot` for that customer's merchant.
Confirm the RPC succeeds, the response contains the interest-history field,
and its amounts and reversals come only from the ledger source listed above.
Record the environment, migration revision, and smoke result in the rollout
record; do not include customer data or credentials.

Keep the earnings/progress rollout blocked if the marker is absent, the RPC
fails, or the result cannot be tied to the expected environment and ledger.
Repeat this check independently in staging and production before enabling the
corresponding customer release. Applying migrations does not provision or
verify the marker.
