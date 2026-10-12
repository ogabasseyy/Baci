# First-card checkout: inactive source slice

This is the 26 September source snapshot. The subsequent HTTP, mobile recovery,
return-page and webhook-isolation work is tracked in
`piggyvest-first-card-wiring-2026-09-27.md`. Its separate checkout capability does
not change the older saved-card `newCardEnabled` contract. Neither document is
evidence of public activation.

The owner approved prefunded contributions and continued source editing during the
performance window, then released local validation on 2026-09-27. Test results are
recorded in `piggyvest-performance-window-handoff-2026-09-26.md`. Public activation
has not occurred and `newCardEnabled` remains false. This document is a source
contract, not evidence of a successful payment or a deployed checkout page.

## Payment boundary

The first checkout collects the actual consented contribution amount once. It is
not the old small `savings_authorization` charge. Before initialization, a scoped
database transaction must reserve both company float and remaining goal capacity.
The original customer's email is frozen in that reservation. Saving the card and
making the one-time contribution require explicit consent; neither enrolls an
automatic debit schedule.

The adapter follows Paystack's documented [transaction initialize and verify API](https://paystack.com/docs/api/transaction/)
and [reusable authorization requirements](https://paystack.com/docs/payments/recurring-charges/).
It sends a fixed reference and card-only channels, without split, subaccount or
subscription fields. The checkout URL is returned only after it is durably stored.
An initialization timeout or uncertain storage result does not permit a new POST,
reference, automatic reservation release, or a replacement charge.

A return URL is not payment evidence. The server independently verifies the
stored reference against the test domain, exact amount, currency, original email,
identity metadata, transaction ID and reusable card authorization. A verified
collection is promoted into the same already-reserved operation, never passed to
`charge_authorization` as another first payment. PiggyVest transfer verification
and canonical ledger projection remain separate from Paystack collection.

## Storage obligations

`PrefundedCardCheckoutStore` is an internal trusted-worker interface, not a public
HTTP schema. Actor and customer values must be derived from authenticated,
merchant-scoped identity before this interface is called. SQL must independently
check the actor's customer ownership and all immutable bindings.

The runtime now requires an injected server-owned customer resolver. Customer
request schemas reject supplied actor/customer IDs; the resolver must authenticate
the current request and resolve the requested goal under the configured merchant.
This dependency is not a replacement for implementing and reviewing the eventual
HTTP authentication and CSRF boundary.

The concrete adapter uses fixed SQL statements and separate `checkout_customer`
and `checkout_authorizer` executor profiles. These profiles use the existing
treasury-operator and authorizer logins, respectively, with their existing role
memberships. They narrow application call surfaces; they do not create additional
database logins or remove the union of privileges already held by those logins.

- Reserve and retries must use the existing treasury/goal locks and existing
  operation accounting. The first-card operation starts with collection pending,
  never `not_started`, so the saved-card worker cannot charge it again.
- Initialization has one durable winning claim. Token/fence/lease checks are
  re-evaluated after lock waits. Expiry never resets it to a new initialization.
- Original intent identity, email, amount, consent, key and fingerprint are
  immutable. A changed retry is rejected before any new provider action.
- A separate restricted verifier, not the customer executor, may attest the
  independently verified collection and persist reusable authorization.
- Promotion must atomically save the card/immutable proof and advance the existing
  collection, keeping its reservation and original operation ID. It must not
  credit the ordinary wallet, create a second collection, or claim savings
  completion before canonical projection.
- A conflicting pre-existing card, non-reusable capture, identity mismatch or
  ambiguous provider result needs reconciliation, not a new charge. Transient
  verification transport errors remain pending.

## Fixed scope and remaining gates

All constructors pin the isolated staging database identity and the unchanged
deadline `2026-09-29T15:59:10Z`. No production key or arbitrary callback is accepted.
The planned return URL is
`https://staging.ogabassey.com/savings/card-return`; creating a schema constant does
not deploy that page or make it reachable.

Before public use: authenticate the public first-card entrypoint, add the non-authoritative return
page/mobile checkout and persisted recovery, then validate their integration with
the checkout source and private database rehearsals. Reviewed installation, gateway
activation, genuine settlement and phone checks are still required. No generated
artifact, credentials, role grants or public flag changes are part of this slice.

Public activation must also review the registered Paystack webhook path for the
new `prefunded_first_card` metadata/reference. It must not send this capture through
the legacy card-setup, ordinary-wallet credit, or order-settlement branches.
This slice does not install a webhook branch or claim background first-card
reconciliation is connected; authenticated refresh is the implemented verifier
entrypoint in source.

Review corrections in this slice include JSON-null-safe SQL validation, exact
executor catalogs, treasury-first locking, expiry rechecks after insert waits,
canonical UTC claim timestamps and conservative handling of conflicting saved
cards. Regression sources cover these boundaries, including a disposable lock
ordering check. None has been executed during the performance window.

Final bounded Terra review reported no remaining actionable findings in the
reviewed TypeScript and SQL after those corrections. The Python scratch harness
received parent source review only. This is not a passing typecheck, executed SQL
rehearsal, whole-tree review, deployment, or phone-readiness claim.
