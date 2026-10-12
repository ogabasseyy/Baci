# Local staging provisioning

This code is not deployed and has not contacted PiggyVest. Tests use synthetic
identities and mocked HTTP. It adds no public route, environment values, secret,
deployed database connection, deployed caller grant, automatic job or production payment behavior.
The disposable local runtime harness creates synthetic-only roles and connections.

## Worker flow

`provisionPiggyvestStagingResource` receives trusted server configuration and a
server-resolved command. It is not a customer-facing API and must not receive
raw request-selected merchant/customer/provider wallet identities.

1. Require staging project equality, expected business/merchant, an allowlisted
   synthetic customer, explicit owner provisioning approval and approved test
   identity. These flags are configuration guards, not evidence of approval.
2. Build only the documented customer or additional-wallet request. Customer
   creation uses one stable integration/customer correlation; plan-wallet names
   use integration/goal identity. There is no withdrawal-limit bypass field or
   automatic `returnIfExist` retry.
3. Make interest accrual and payout choice explicit. A configured destination
   must have independently verified ownership and routing terms. `own_wallet`
   with accrual enabled is unavailable unless provider default routing has been
   verified explicitly; omission of `interest_payout_wallet` alone is not proof.
4. Compute a keyed SHA256 request fingerprint over canonical request and local
   identity/business. The separate server key and raw KYC remain outside the
   database. Keep this key stable for outstanding intents; rotation must preserve
   deterministic recovery or explicitly reconcile prior intents, not recreate them.
5. Commit the scoped intent before requesting its exclusive dispatch claim.
   One customer operation exists per integration/customer and one wallet operation
   per integration/goal. A different fingerprint conflicts instead of overwriting
   prior terms. Both registry and merchant provisioning scope default disabled.
6. Commit the claim before a single POST. The claim checks the configured provider
   business and local ownership. A plan wallet also requires a matching existing
   provider customer correlation before dispatch. The TypeScript adapter validates
   the returned operation, local identity, fingerprint, first attempt, token and
   sufficient remaining lease. No permit means no POST.
7. Preserve bounded opaque customer/wallet acknowledgement IDs privately for
   recovery. A wallet acknowledgement remains `awaiting_confirmation`, never
   funded/usable. Provider acknowledgement does not automatically insert a trusted
   wallet mapping or customer balance.
8. Transport failure, malformed response, stale token or failed result persistence
   remains uncertain. No HTTP retry or expired-claim reuse exists. Even a crash
   after claiming but before actually sending requires reconciliation rather than
   assuming it is safe to create another resource.

## Database executor requirements

The injected executor must use the restricted staging connection and resolve only
after a successful autocommit/COMMIT. A queued statement, uncommitted transaction
or HTTP request sent to a database gateway is not a committed result.
`createPiggyvestPostgresExecutor` now implements this boundary using a fresh `pg`
connection, explicit READ COMMITTED transaction and acknowledged COMMIT with idle
transaction status. Its exact SQL catalog limits each of the three worker roles
to its own operations; database grants independently enforce the same boundary.

It requires explicit connection values, rejects privileged or inherited-role
sessions and read replicas, and verifies fsync/synchronous commit. Remote mode
requires verified TLS plus explicit approved staging host/project configuration;
these configuration flags do not establish actual owner approval. Local test mode
is restricted to the disposable harness socket and synthetic database identity.
Connection, statement, lock and overall execution deadlines are bounded. Failure
closes the connection and never retries an uncertain operation or returns success
before COMMIT. Errors are redacted; SQL parameters and payloads are not logged.

Use READ COMMITTED, a bounded connection/statement timeout, no SQL parameter/body
logging and no automatic uncertain-commit replay. The claim lease is 60 seconds;
the adapter requires over 15 seconds remaining before dispatch, while HTTP is
bounded to at most 10 seconds. Clock skew or excessive database delay fails closed.
Never pass a Supabase service-role client or grant unrestricted private table
access to a user-facing route. Grants are deliberately absent from the migrations.

The final claim interface includes expected provider account and customer IDs.
Earlier overloads in the append-only migration sequence are removed by later
migrations. Apply and verify the entire reviewed sequence, not a selected prefix.

## Funding lookup

The funding adapter obtains identity from a trusted resolver, confirms the local
merchant/customer/goal mapping and verifies the requested wallet against the
configured provider business and currency before fetching virtual-account details.
No account response is a deposit or balance update. Funding account information
must be protected from logs and returned only to the authenticated mapped customer.
No general customer route is connected to this adapter yet.

## Still required

- An isolated deployable artifact and approved restricted staging connection;
  the real driver is locally implemented, not connected to remote storage.
- Verified account/credential association, approved synthetic BVN/KYC fixtures,
  interest destination behavior and precise bounded test-operation approval.
- Recovery and independent wallet confirmation are implemented locally; see
  `apps/web/src/lib/piggyvest/provisioning-recovery.md`. Fresh creation provenance
  is required for first-customer ownership. Completion receipts and first-plan
  mapping are transactional; historical acknowledgements do not acquire that proof.
  Unknown operations cannot automatically resend. Remote acceptance remains pending.
- Full-schema/RLS replay and approved staging runtime verification, in addition
  to the focused local SQL/runtime tests.
- Internal ledger and read-only transaction observations now have local tests.
  Provider-backed financial webhook effects, savings UI connection,
  purchase/cancellation/schedules and approved sandbox end-to-end acceptance.

Sources: [create customer](https://www.piggyvestbusiness.com/docs/api/customers/create),
[create wallet](https://www.piggyvestbusiness.com/docs/api/wallet/create),
[funding accounts](https://www.piggyvestbusiness.com/docs/api/wallet/funding).

## Local runtime verification

Run `bash tools/test/run-piggyvest-runtime-local.sh`. It creates a new Unix-socket-only
PostgreSQL cluster in a private temporary directory, applies the private
base staging migrations plus recovery and ledger migrations (24 total), grants only fixture function access and destroys the cluster
after testing. No environment files or existing database are used. A failed server
stop retains its directory rather than deleting storage from a running server.

Ten real-database tests currently cover committed inbox deduplication under
concurrency, unsupported-event quarantine, deferred COMMIT rollback, direct role
permission denial, bounded lock failure, durable provisioning before simulated HTTP,
single-dispatch races, unknown-result no-resend behavior, provenance-based customer
and plan completion, and internal ledger-backed savings decisions. HTTP is explicitly
mocked and global network fetch is prohibited. This is not a provider sandbox test,
power-loss durability test, full Supabase schema test or production certification.
