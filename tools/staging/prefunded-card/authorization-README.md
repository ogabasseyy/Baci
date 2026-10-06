# Restricted saved-card authorization resolution

This local bundle extends the existing `public.customer_saved_payment_methods`
model. It does not create another customer-facing card list or change legacy
wallet-credit behaviour. The private immutable binding records the original
authorization for historical verification after a card is disabled, replaced or
removed. Current eligibility still comes from the existing saved method.

## Application interface

`createPrefundedCardAuthorizationResolver({ execute, scope, verification? })`
uses the same parameterized executor shape as the prefunded operation store:
`(statement, readonly string[]) => Promise<{ rows: unknown }>`. The parent owns
executor construction and composition. Scope requires `treasuryBindingId`,
`integrationId`, `merchantId`, and the physical PostgreSQL `systemIdentifier`.

- `resolveSavedMethod({ savedMethodId, merchantId, customerId })` fits the existing
  provider dependency exactly. It returns independently persisted owner, original
  email, original authorization, Paystack customer code, test domain, and current
  active/reusable flags. It never makes HTTP requests.
- `provision({ savedMethodId, merchantId, customerId, transactionId })` requires a
  **separate provisioning executor** and server-injected
  `verification: { paystackSecret, fetchImplementation }`. Input cannot contain
  authorization material or evidence. It reads an eligible original transaction
  and card through `authorization_candidate`, verifies the stored reference with
  `GET https://api.paystack.co/transaction/verify/{reference}`, and only then calls
  the restricted provisioning function with the validated provider evidence.
  It returns only saved-method ID, transaction ID, and provisioned/duplicate.

The original transaction must be a completed NGN `savings_authorization` payment
with existing owner metadata. Independent verification requires a successful
test card payment, exact reference/amount/currency/email/authorization/signature,
and the original provider metadata's internal customer ID and merchant slug.
Missing provider metadata is refused; it is never copied from expected values.
This deliberately refuses legacy authorizations without that evidence.

Only strict `sk_test_` keys are accepted. HTTP uses the existing bounded streaming
transport, a five-second timeout, a 64-KiB response cap, and no redirects. Only HTTP
200 with verified successful evidence can provision; 202/pending is refused.
No credentials are loaded from environment files. Callers must not log executor
parameters or resolver results: authorization codes remain server-only.

## Private database installation and roles

After the existing prefunded storage bundle, load these files in order:

1. `authorization-storage.sql`
2. `authorization-candidate.sql`
3. `authorization-functions.sql`

No role is created or granted by these installation files. An approved installer
must supply the two NOLOGIN capability roles and restricted login memberships:

| Caller | Required membership | Function EXECUTE grants |
| --- | --- | --- |
| Collection worker / customer reservation worker | `prefunded_card_authorization_reader` | `read_authorization(uuid,uuid,uuid,uuid,uuid,text)` |
| Separate verification/provisioning worker | `prefunded_card_authorization_provisioner` | `authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text)` and `provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)` |

Both need schema `USAGE`, no direct table grants, and non-superuser/non-BYPASSRLS
sessions. Role checks use `session_user`, not caller JSON, a GUC, or effective
`SET ROLE`. The reader must exactly match the treasury's `authorized_login` and
the immutable binding's login, integration, merchant, customer, saved method,
cluster system identifier and database name. No grants reach `anon`,
`authenticated`, or `service_role`. Private storage has RLS with default denial.
The provisioner role is trusted to attest independently verified evidence;
customer and normal worker roles cannot call that write boundary or modify proof.

For new reservations, the parent must call `read_authorization` and require
`active=true` and `reusable=true` **after returning a valid existing idempotent
operation, before reserving**. Historical reads intentionally return the original
identity with `active=false` after revocation. The provider already refuses such
methods for new sends but can verify a previous charge with the original identity.

## Local regression evidence

Run `bash tools/staging/prefunded-card/authorization-local.test.sh`. It creates a
private temporary Unix-socket database, installs real prefunded claim functions,
and tests ownership/domain/role/database mismatch, duplicate proof, immutable
identity, public-card mutation/removal, inactive-before-claim denial and restart.
All credentials and receipts are synthetic; no provider endpoint is contacted.

For the parent's disposable composition harness, load
`authorization-integration-fixture.sql` before the authorization bundle, then call
`authorization_fixture.seed(treasury_id, saved_method_id)` as its test admin.
This adds missing fixture columns, capability roles and synthetic immutable proof
for an existing method. **Never install this fixture in a deployed database.**
It is not independent provider verification; the TypeScript provisioning suite
separately exercises the real GET/validate/write path with mocked HTTP.

Still unproven: approved deployed grants, secure operator provisioning, actual
Paystack authorization evidence, parent source-runtime composition, and genuine
staging settlement. Incomplete PiggyVest TSQ identity still requires independently
correlated webhook/enrichment and does not establish completed funding.

The original-email/reusable-authorization rules follow the
[Paystack recurring-charge contract](https://paystack.com/docs/payments/recurring-charges/).
