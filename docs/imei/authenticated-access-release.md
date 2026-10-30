# Authenticated IMEI access release

Customer POST and status polling use the authenticated Supabase session plus the
`imei_lookup_access` RPC. The server signs the exact serialized operation with
`IMEI_ACCESS_SIGNING_SECRET`. The database checks the signature, expiry, actor,
customer ownership and merchant before executing a fixed operation. The browser
must never receive that secret, a signature, or a signed payload.

## Provisioning and publication

1. Validate the append-only access migration and SQL contracts in a disposable
   database. Do not run fixtures or contract tests against production.
2. Apply `20261030120000_imei_authenticated_access_boundary.sql` through the
   normal migration release. It does not provision a default signing secret.
3. Generate a dedicated random secret of at least 32 bytes. Using a trusted
   database-owner channel, provision exactly one row in
   `private.imei_access_secrets` with `singleton=true`. Set the same secret as
   `IMEI_ACCESS_SIGNING_SECRET` in the target application's server environment.
   Do not print, commit, or put the value in release receipts or command history.
4. Publish the reviewed application using the repository's production prebuilt
   deployment flow. Existing application code does not depend on the new RPC;
   the new application fails closed with `503 IMEI_ACCESS_UNAVAILABLE` if its
   signing configuration is absent. A mismatched database secret rejects the
   operation before lookup mutations or provider work.
5. Verify auth denial, trusted merchant/customer scope, and replay behaviour
   before a single authorized paid check. Record provider identity, status and
   wallet debit/refund outcomes without copying identifiers or credentials.

Changing an environment variable alone does not update an existing deployment.
Do not enable any additional Petrock tier without reviewed service-specific
response evidence. The four existing bindings remain behind the master flag,
tier allowlist, and asynchronous-client gate. Customer prices are unchanged.
Remediation ordering is outside this diagnostic boundary and remains disabled.

## Verification

The isolated SQL suite uses actual wallet and provider-state functions, under
the authenticated role. It covers invalid or expired signatures, ownership,
prices, direct grants, idempotency, debit/refund constraints, and provider-state
delegation. `supabase/tests/run_imei_access_boundary.py` creates and drops a
scratch database; its fixtures must never be applied to an existing database.
The candidate evidence report lists the unavailable and unverified services.

The access RPC reports durable debit/refund evidence for lost wallet responses
and refuses to cache a charged lookup as an uncharged failure. Unknown Petrock
submissions without an order receipt remain pending for reconciliation rather
than receiving an automatic refund. Do not automatically repeat a paid provider
submission after an ambiguous response.
