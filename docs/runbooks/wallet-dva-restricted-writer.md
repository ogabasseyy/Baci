# Wallet DVA restricted writer

The customer wallet Paystack DVA creation route stores provider-returned account
details through `wallet_dva_private.record_paystack_customer_wallet_dva`. The
operation is executable only by the `baci_wallet_dva_writer` NOLOGIN group role.
That role has no direct table privileges. The existing shared Paystack DVA
alias triggers remain authoritative for collisions with order, checkout, and
merchant wallet accounts.

## Hosted activation gate

This change does not create a login password or enable the writer in a hosted
environment. Before activation, the database operator must provision a
separate login named `baci_wallet_dva_provisioner`, grant it membership only in
`baci_wallet_dva_writer`, and issue its password through the approved secrets
process. Do not reuse the Supabase service-role key, the PiggyVest worker
credential, or a shared application database login.

Configure the web runtime only after reviewing that credential and its network
path:

- `WALLET_DVA_PROVISIONER_ENABLED=true`
- `WALLET_DVA_PROVISIONER_DB_HOST`
- `WALLET_DVA_PROVISIONER_DB_PORT`
- `WALLET_DVA_PROVISIONER_DB_NAME`
- `WALLET_DVA_PROVISIONER_DB_PASSWORD`
- `WALLET_DVA_PROVISIONER_DB_CA`

The runtime uses TLS certificate verification and rejects any session whose
login/database identity, role membership, table privileges, or TLS state does
not match this dedicated contract. It has no service-role or generic database
fallback. Until these values are configured, the funding-account route keeps
returning existing RLS-visible accounts, but refuses new provisioning before
it calls Paystack.

After provisioning the role and before enabling the runtime, run
`supabase/tests/wallet_dva_restricted_writer.sql` against the chronological
migration replay. The test covers the SQL role boundary, exact owner/merchant
binding, idempotent retries, receiver and active-checkout alias conflicts,
projection shape, NULL rejection, authenticated execute denial, and owner
RLS reads with synthetic users.
