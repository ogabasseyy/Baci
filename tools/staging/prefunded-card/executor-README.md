# Restricted prefunded-card executor

This inactive staging bundle provides a dedicated, fixed-profile PostgreSQL
executor for prefunded-card operations. It does not provision credentials,
activate a provider, or change an existing application role.

`customer`, `worker`, and `reversal` are separate server-owned constructor
profiles, but intentionally use the same `prefunded_treasury_operator` login.
Both `customer_request` and the worker path require the same `session_user` to
match the immutable treasury binding. Customer card authorization also pins its
own `authorized_login` to that session identity. Separate customer and worker
database logins cannot satisfy those guards for one binding without weakening
them, which this bundle does not do.

The constructor profile is never request-selected. The customer profile exposes
only `customer_capabilities`, `customer_request`, and `customer_status`; the worker profile has its exact
queue, authorization-read, provider-evidence-read/classify/apply, replay-enrollment routing, and reversal
statement catalog; the reversal profile has only its two reversal calls. These
constructor allowlists restrict application call surfaces even though the shared
treasury login has the union of those exact database function grants.

`prefunded_authorizer` and `prefunded_evidence` remain independent logins with
their own narrow function catalogs. The evidence reader functions may be used by
the shared treasury login only when its separately provisioned immutable evidence
authority is the canonical ledger and treasury authorized login.

`executor-roles.sql` creates only the three bundle logins and their required
NOLOGIN capabilities, revokes and grants only the exact catalog function
signatures, and does not issue table privileges. `executor-identity.sql` exposes
the physical server identity through a read-only security-definer helper; the
executor validates it and the exact role/membership state in its operation
transaction before invoking any allowed statement.

## Inactive installation order

Install the reviewed base integration/mapping, canonical ledger, prefunded
storage/treasury, authorization, customer/queue, evidence and reversal bundles
first. Then install these executor-owned files in this exact order:

1. `customer-capability.sql` (defines the customer capability RPC; no login
   grant).
2. `replay-enrollment.sql` (defines the routing-only RPC; no login grant).
3. `executor-roles.sql` (grants the exact eight-argument customer capability
   and seven-argument routing signatures only to the shared treasury operator,
   alongside the existing fixed catalog).
4. `executor-identity.sql` (requires those logins and defines identity access).

Never load `executor-roles.sql` before the capability and enrollment RPCs exist. Both maintained
executor scratch loaders install the real RPC first; the grant-only fixture
still stubs the other catalog functions and does not exercise their semantics.
The separate routing regression uses the full private evidence fixture, then
`replay-enrollment.sql`, then `replay-enrollment.test.sql`. No new registry or
receipt-copy inbox is required.

The composition returns `resolveEnrollment({receiptId, payloadSha256, eventId,
eventType, providerCustomerId, rawPayload})` for the receiver's pre-signature
seam. It checks the digest of bounded original bytes and metadata equality, then
passes only bounded routing hints to the worker executor. Nullable optional
provider identifiers normalize to absent; required customer/wallet identities
do not. Bank routing considers only the supplied inner and outer wallet candidates;
exactly one independent mapping must resolve, with matching scope/customer and a
canonical credit route. Conflicting mapped candidates defer, and independent
evidence still decides the final destination. Sparse internal outflows use one
exact operation reference with pinned envelope/treasury source, then that
operation's immutable destination mapping; supplied contradictory hints defer.
Neither path requires prior provider evidence. Routing only permits subsequent original
signature retrieval and independent evidence replay, never monetary credit.

Legacy requires exact private integration mapping plus matching public legacy
wallet ownership, an active legacy/manual goal and no canonical binding or
operation. Public-only legacy rows lack integration/physical authority and defer.
Ambiguous operation references, mismatched identities, missing mappings, and
unreferenced bank receipts with multiple possible treasury bindings also defer:
credit routes do not independently store a treasury binding. Downstream monetary
writers must recheck enrollment; routing is not a transaction-spanning credit lock.

All newly added routing/composition regressions remain source-only and unrun
during the performance window; no install, activation, scheduler or listener is
enabled by these files.

The disposable `tools/test/prefunded-card-postgres-executor.test.py` harness
includes the private PostgreSQL customer-request then scoped-claim journey
under `prefunded_treasury_operator`, and a routing regression using the full
evidence fixture. The latter covers both bank-wallet orientations, exact positive
legacy, sparse operation-correlated outflows, incompatible candidates, physical
scope refusal and absence of credit/evidence side effects. This source is not an
activation procedure or a claim that the new regressions have executed.
