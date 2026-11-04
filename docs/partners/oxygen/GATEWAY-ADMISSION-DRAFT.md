# Draft: order-bound gateway admission for Oxygen

Status: proposal only. The recorded-transaction fence is partial. Neither this
proposal nor that fence proves two-way payment exclusivity. Production Oxygen
must remain disabled until the implementation, rollout and reconciliation gates
below are complete. This document does not authorize a provider request.

## Conservative order-origin guard

The proposed `20261104063000_oxygen_payment_rail_origin.sql` migration permits
new Oxygen workflows and mutating commands only for orders created with Oxygen
as their payment method. An order from another rail cannot be switched into
Oxygen, even when no gateway transaction is recorded. An order that safely exits
Oxygen cannot later re-enter it. Existing orders have no origin marker and must
not be backfilled merely because they have no transaction record. Read-only
status checks and persistence of already completed responses remain available;
other work on those older applications is held for reconciliation. The checkout
also preserves a known pending prior order rather than silently opening another.

This is a same-order containment measure, not the shared pre-dispatch claim
described below. It does not prove exclusivity across different orders, devices
or legacy client SDKs. Before relying on it, deploy the gateway snapshot guards
to every entry point, drain old application instances, reconcile existing
provider sessions and validate the new migration against the full schema. Keep
Oxygen disabled until those steps and the release gates below are complete.

## Required contract

An ordinary gateway initializer must obtain an order-bound durable claim before
it can contact a provider or issue a launcher capability. The database—not a
client-selected merchant, amount, gateway reference or feature flag—must bind
that claim to the independently authorized order, its current merchant,
currency and payable amount. A guest must present that order's tracking token;
an authenticated customer must pass the existing user/customer ownership
boundary. Missing or invalid proof fails closed with an indistinguishable
response. Do not use the service-role client or expose an arbitrary-tenant RPC.

Use the same nonblocking per-order payment lock for the gateway claim and
Oxygen admission, with a reviewed ordering relative to the existing Oxygen
credit, financial-edit and workflow locks. Under the lock, re-read the order,
existing claims and the Oxygen obligation; insert a unique durable claim before
releasing the transaction. Oxygen method/workflow entry and mutation/activation
admission must reject a live or uncertain gateway claim. Gateway admission must
reject live or uncertain Oxygen obligations. Existing authoritative read-only
reconciliation must still work on conflicts.

A separate generation-fenced transition must persist `dispatching`, the
immutable provider reference and the claim binding before network I/O. A crash,
timeout, lost response or failed post-provider transaction insert is uncertain,
not evidence of non-dispatch: it must not release, expire or automatically
replay the claim. Only a provably pre-dispatch abort or authoritative
provider-specific proof of non-chargeability may close it. Completion and
reconciliation must compare the claim generation and immutable binding; late
responses cannot settle or release a newer generation. Provider results and
tracking tokens must not enter logs or unrelated responses.

The feature gate must be enforced consistently by the database and application:
enabling Oxygen execution cannot coexist with an initializer that skips this
claim. While the new gate is disabled, current ordinary checkout behavior may
remain unchanged only while Oxygen execution remains disabled. No configuration
or production flag is enabled by this proposal.

## Integration inventory

- `apps/web/src/app/api/payments/initialize/route.ts` calls Juicyway, Paystack
  card and DVA, and Korapay before transaction persistence. It returns a Klump
  launcher URL; the later launcher must also be fenced before provider dispatch.
  Claims must precede the earliest possible provider call for each branch.
- `apps/web/src/app/api/orders/[id]/generate-dva/route.ts` is a separate
  order-bound DVA entry. The existing DVA HMAC reservation happens after account
  creation and has its own narrowly scoped authority; it is not this claim.
- Credit Direct's server signing route and BNPL launcher paths require the same
  admission boundary. CredPal's existing public-key client SDK is not forced by
  the server to obtain a claim; it needs a provider-enforced capability or a
  coordinated disablement during cutover. A client-side check is insufficient.
- Web checkout order types and mobile checkout parameters make tracking tokens
  optional; some paths pass them onward, but web card and mobile card/crypto
  generic initialization omit them. Token availability on every creation,
  resume and legacy-client path is unproven and requires an audit. Updated
  clients must forward available tokens as untrusted proof; when the gate is
  enabled, missing proof must fail closed. Do not classify wallet top-ups or
  domain purchases as order payments without an independent binding audit.
- REDVAULT's v4 initialization claim is a useful uncertainty-handling model,
  but its attempt schema, permissions and authenticated-only RPC cannot simply
  be reused for ordinary guest checkout.

## Required verification and cutover

1. Real PostgreSQL concurrency tests, both lock orders: gateway claim versus
   Oxygen method/workflow/command/activation, including stale snapshots,
   simultaneous claims, rebind attempts and lock contention. No provider call
   may occur after denial.
2. Route/client tests for each gateway and entry, current authenticated and
   guest proofs, missing/wrong/cross-tenant tokens, forged amounts, retries,
   timeouts, process death and lost responses. Verify a stale generation cannot
   release or finish a later claim, and read-only recovery remains available.
3. Full-schema replay and exact-head CI/review. Local synthetic tests cannot
   establish full migration compatibility or provider behavior.
4. Quiesce and drain all old initializer instances and stale client SDK paths
   before relying on the new gate. Inventory and reconcile preexisting provider
   sessions whose successful initialization was never recorded; an absent local
   transaction does not prove no external chargeable session exists. Any case
   without authoritative non-chargeability proof stays blocked for review.
5. Separately obtain provider and operational approval for the specific launch,
   expiration, revocation and uncertain-outcome contracts. Keep the existing P1
   review threads open until the complete boundary and cutover are proven.
