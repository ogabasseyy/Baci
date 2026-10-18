# Ogabassey public UBA test product

## Owner-approved scope

Anyone may test the dedicated NGN 100 UBA product, without an account allowlist or
automatic expiry. This is not a general REDVAULT campaign. Only the bound Ogabassey
product is accepted, one unit without variants or mixed products, with a fixed 5%
discount. Normal server-derived VAT remains applicable. Do not promise a NGN 95
final charge: the current product's 7.5% VAT must be verified in the checkout quote.

PAN, CVV and OTP entry remains on Paystack. UBA bank filter 033 and the Verve, Visa
and Mastercard filters remain mandatory. No agent should submit a real payment.
The owner or UBA representative submits their own payment on the hosted page.

The public product mode is explicit in BOTH server configuration and the private
database policy. Missing dates or user identity never implicitly select it. The
old private tester mode retains its existing restrictions. Attempt idempotency,
customer/order authorization, amount and currency verification, capture holds,
refund reconciliation and webhook signature checks remain unchanged.

## Rollout gates

1. Review and deploy the append-only policy, guards and safe projection migrations
   together with the server/client changes. Do not activate against old application
   code or call the old private tester configuration function for this mode.
2. Verify the dedicated product belongs to Ogabassey, costs NGN 100, has no variants,
   has tracking off, and has no unrelated orders. Existing draft UUID:
   `f6f4261f-8cc8-42c4-941c-e8d3483c6628`. Never reprice a retail product.
3. Keep the runtime disabled until discount binding, public-test-specific terms,
   bank code, live domain and verified issuer evidence are configured. Do not
   invent public campaign funding, caps or dates from test-product settings.
   Automated live refunds stay disabled: use the owner-approved supervised
   process in `redvault-public-product-supervised-refunds.md`, with a responsible
   operator and verified provider completion for each capture.
4. Configure the server's existing production/database binding plus
   `REDVAULT_LIVE_PILOT_AUDIENCE=public_product_test`. No automatic-expiry or
   single-global-attempt setting should be used for this audience.
5. Publish the dedicated product and call the owner-only
   `private.configure_uba_redvault_public_product_test(true, product_uuid)` in
   one guarded transaction after verification. Ordinary payment paths cannot
   purchase the bound product. Never expose its owner configuration RPC publicly.
6. Verify anonymous and signed-in availability for only the correct cart, exact
   tax-inclusive quote, hosted card/bank filter configuration, and fulfilment
   blocking before providing a usable test URL. No physical shipment is permitted,
   even after payment approval or after disabling the product test.

## Manual stop and reconciliation

Call `private.configure_uba_redvault_public_product_test(false, NULL)` as database
owner and disable the application/runtime flags. The product binding is retained
so prior orders stay quarantined. A lost provider response is indeterminate, not
permission for a fresh charge. Reuse or reconcile the durable reference. Check
any previously issued hosted checkout separately: disabling this mode does not
revoke a Paystack checkout URL already issued. A subsequent capture remains held.
Confirm refund completion with the provider and persisted state; submission is not refund
completion. A single Mastercard verification does not establish coverage of all
three card networks.

Paystack Dashboard refunds alone do not reconcile the private REDVAULT ledger.
Follow the supervised refund runbook and distinguish financial completion from
remaining inventory/lifecycle review.

Before the public product has any order history, disable it and call the
owner-only `private.restore_uba_redvault_private_test_audience()` before using
the legacy private-tester configuration function. The restore retains the product
binding and refuses an enabled or previously used public test. After any public
order exists, retain the public audience and quarantine; switching that history
to private mode requires a separately reviewed migration, not a policy-row reset.

## Validation

`node supabase/migrations/tests/run-redvault-public-product-test.mjs` uses only a
loopback PostgreSQL server, default port 55439, and creates then removes its own
test database. It exercises real PostgreSQL policy/trigger functions against an
isolated schema fixture. It is not a full historical migration replay or a live
Paystack test. Existing fulfilment guards are exercised after manual disable.

`redvault-public-product-full-schema-run.sql` is a rollback-only psql suite for a
separately provisioned, disposable full-schema database with the ordered REDVAULT
migrations applied. Never run this fixture seeder against a shared or production
database. A network-isolated schema-only Supabase snapshot passed guest and
signed-in order creation, retry/reference reuse, distinct customers' attempts,
initialization claiming, manual disable and physical/item fulfilment rejection.
It includes the real inventory anchor created during checkout and the 7.5% VAT
case (NGN 102.50 payable). No customer data or provider requests are involved.

Focused web/mobile tests cover the explicit audience, mismatched database policy,
guest and arbitrary-user access, wrong merchant/product, fee combinations and
legacy private-mode behaviour. Full release checks and live browser validation
are separate required evidence.
