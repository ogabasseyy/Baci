# Saved-card customer bridge (inactive source)

This slice connects an authenticated customer request to the existing durable
prefunded contribution queue. It does not enable a payment rail, install the SQL,
start the dispatch worker, or deploy a public route. Validation remains deferred
during the owner's performance-measurement window.

## Contract

`/api/storefront/customer/savings/card-contributions` accepts:

- `GET ?goalId=<uuid>`: scoped capability, masked already-provisioned reusable
  cards and the maximum remaining goal amount in kobo. No authorization code,
  provider credential, source wallet or float balance is returned.
- `GET ?goalId=<uuid>&idempotencyKey=<uuid>`: status of that customer's durable
  contribution. This is a read, not a repeat collection request.
- `POST`: exact `goalId`, `savedMethodId`, integer `amountKobo`, UUID
  `idempotencyKey`, and `consent: {version: "prefunded-card-v1",
  oneTimeCharge: true}`. Actor, merchant, provider mappings and treasury identity
  are resolved by the server. Clients must not submit those identifiers.

The one-time consent is for the displayed amount and chosen saved card. It does
not enroll auto-debit or alter an existing schedule. Consent and the scoped
reservation are recorded in the same transaction. The worker, not the request,
executes collection and transfer. `pending` is not a completed savings credit;
only canonical projection permits `completed`. `reconciliation_required` must
not cause a new collection attempt.

`newCardEnabled` remains **false**. First-card hosted checkout still needs its
own pre-collection reservation, verified reusable authorization and durable
collection correlation. The legacy small `savings_authorization` charge and its
internal-wallet credit are not a substitute and are not called by this bridge.

## Runtime boundary

The route defaults off. Future reviewed provisioning would supply the server-only
`PREFUNDED_CARD_PUBLIC_ENABLED=true` and `PREFUNDED_CARD_PUBLIC_CONFIG` JSON. No
credential or environment file is created by this source change.

The config schema requires:

- Dedicated staging public and authentication origins, staging environment,
  fixed merchant/integration/business scope and explicit customer allowlist.
- The unchanged owner-approved deadline `2026-09-29T15:59:10Z`. The constructor
  and each customer SQL call refuse at expiry; no lease extension is implied.
- TLS with certificate verification, fixed customer statement profile, exact
  database/login/project identities and isolated database system identifier
  `7685292944002592802`. The executor verifies live physical identity and role
  membership in its transaction before each permitted command.
- The actual RLS-client authentication URL and public auth environment URL both
  equal `https://staging-auth.ogabassey.com`.

Only authenticated requests reach runtime construction. Mutations pass the
existing CSRF boundary; bearer credentials are first verified by the existing
API auth helper. The public Host and any Origin must match the configured
staging origin. Forwarded headers cannot select an alternative host, merchant,
database, or provider. Existing local runtime origin checks are unchanged.

The customer constructor has no provider adapter, Paystack secret, dispatch
callback or authorizer callback. Its fixed SQL profile shares the existing
treasury login by the immutable binding contract; this is an application-call
allowlist, **not** a separate database principal. See `executor-README.md`.

## Remaining gates

After explicit release of the performance window: run the focused route, schema,
scope, consent/capability, executor and mobile recovery regressions; rehearse the
SQL and concurrent retries in a disposable database; run repository gates and
review the combined artifact. Public gateway route changes, root-protected
configuration, provisioning, dispatch scheduling and genuine settlement/device
checks remain separate activation work. Do not mark the phone ready from source
wiring or mocked tests alone.
