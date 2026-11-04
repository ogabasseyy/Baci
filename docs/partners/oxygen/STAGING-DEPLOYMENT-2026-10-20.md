# Oxygen on isolated Ogabassey staging — 20 October 2026

## Deployed scope

- App: https://hardcover-california-proxy-christ.trycloudflare.com/
- Callback: https://hardcover-california-proxy-christ.trycloudflare.com/api/payments/oxygen/webhook
- Database: existing isolated `baci-isolated-savings-db-1` on the VPS. No managed
  Supabase branch, production migration, production release or production provider
  credential was used.
- Five append-only migrations: `20261020142857`, `20261020150556`,
  `20261020151230`, `20261020210000`, `20261020220000`. Migration SQL and ledger
  entries were committed atomically after rollback rehearsals against the actual
  staging schema. A private full database backup was retained before installation.
- Dedicated ordinary Auth worker, no customer identity, bound to synthetic
  staging merchant `10000000-0000-4000-8000-000000000001`. Disabled bindings fail
  closed. No user-facing service-role client is provisioned.
- Separate compiled Next.js application on loopback 4801, Oxygen-only Nginx on
  loopback 4802, and its own HTTPS tunnel. Existing PiggyVest services, routes,
  credentials and containers were preserved.
- API ingress allows the Oxygen workflow/actions/webhook/reconcile routes, CSRF,
  scoped Oxygen RPCs, password-token/user authentication, the order handoff page
  and its static assets. Auth admin, arbitrary REST, activation and settlement
  routes return 404. No customer or order data was cloned from production.
- Provider/callback/worker credentials live in mode-0600 files under the dedicated
  mode-0700 `/home/bassey/baci-oxygen-staging` directory. They are not in source,
  environment files or public bundles. Global web environment validation receives
  non-credential placeholders for unrelated service-role/signing/quiz settings;
  those placeholders grant no database or provider authority.

## Verification

- Compiled application build and its TypeScript checks passed on the VPS.
- Local affected runtime/form/API suite: 678 tests across 32 files passed;
  registration helper: 11 tests passed. Web lint and web/tool-worker typechecks
  passed. The disposable PostgreSQL fixture passed with all five migrations.
- Supabase security advisors completed against the hosted staging database: 15
  existing findings, none identifying Oxygen objects. Unrelated findings were
  left outside this change.
- Normal worker password login succeeded. Disabled binding returned 403;
  enabled scoped callback read succeeded; anonymous access was rejected.
- Public health returned `{ready:true,environment:"staging"}` after a real worker
  login and database RPC. Unsigned callback returned 401, malformed authenticated
  callback returned 400, and two identical authenticated synthetic transactions
  returned 200 with one durable inbox row. This is synthetic delivery evidence.
- Oxygen registration update returned HTTP 200 with a matching active callback
  receipt. The earlier local helper attempt rejected the new path before any
  provider call; after the exact path allowlist fix and regression test, one
  provider update was sent and confirmed.
- Worker-only reconciliation returned processed=true with activationEnabled=false
  and settlementEnabled=false. `baci-oxygen-staging-drain.timer` runs a bounded
  drain every two minutes. Failed read retries use fresh durable attempt keys;
  poison callbacks are retained as observed after five deferred attempts.
- Database function fingerprints outside Oxygen matched before/after. Existing
  merchant/customer/order counts remained 1/2/0 and all four isolated database,
  Auth, REST and mail containers stayed healthy. Seven private Oxygen tables have
  RLS enabled. No existing order was booked, approved, activated or settled.

## Review decisions

CodeRabbit reviewed the complete task diff. Valid recovery findings were fixed
and covered: definite failures no longer permanently lock workflows; malformed
claimed contexts are released; callback budget is checked before enqueue; blocked
callbacks retire; transient read retries receive a fresh idempotency key. Unknown
mutation outcomes remain blocked for reconciliation.

The suggestions to put blanket IF NOT EXISTS guards on all migration objects were
not applied: these append-only, transactionally ledgered migrations deliberately
fail if their exact prerequisites differ. Silently accepting an incompatible
existing table or constraint would mask drift, contrary to repository guidance.
Minor UX/caching suggestions are not a clean-review claim. No PR/merge is claimed.

## Operational limits

The tunnel URL is temporary and must be re-registered after a tunnel replacement.
App, Nginx and tunnel currently use transient user-systemd units; the drain timer
is persisted. A reboot requires restoring the supervised deployment and checking
its URL/configuration before registration. Do not treat this as an unattended
production callback host. Do not stop or reset the existing PiggyVest stack.

The app source snapshot/build scripts, worker provisioning and redacted receipts
are retained under `/home/bassey/baci-oxygen-staging`. The build reuses installed
VPS dependency files read-only. The application contains the actual workflow and
verification forms; no hosted customer/order journey has been completed yet.
There were no Oxygen workflows/orders at initial deployment. The checkout test
below subsequently created one isolated synthetic customer order and workflow.

## Checkout test follow-up — 21 October 2026

- Created a disposable synthetic customer and unpaid NGN 400,000 order
  `40000000-0000-4000-8000-000000000099`; no production customer was copied.
- Deployed a staging-only customer sign-in form and session endpoint using normal
  Supabase password authentication. The endpoint is unavailable in production.
- The deployed API receipt confirms owned workflow creation, web/chat resumption
  of the same workflow, anonymous denial, another account's denial, premature
  booking rejection, and activation/settlement rejection.
- Browser sign-in succeeded. Reloading the handoff page preserved authentication
  and resumed the customer verification form without a second workflow.
- The saved stage is `application_required`. No provider application, OTP, KYC
  submission, booking, approval, activation or settlement was performed in this
  checkout test. The form uses a synthetic phone until valid test identity details
  are supplied. Do not submit invented BVN/NIN or reuse the earlier activated loan.
- The main `staging.ogabassey.com` storefront returned a Vercel 404 during testing.
  This is a direct Oxygen handoff test, not a completed storefront/cart journey.
- Affected validation reported 689 tests passing, web lint/typechecks and the VPS
  build passing. CodeRabbit reported no critical/high findings; minor findings
  remain and this is not a clean-review claim.
- Redacted API receipt: private staging directory `checkout-api-verification.json`.
  Customer login material remains private and is excluded from this report.

No actual provider callback or customer-money collection is proven. Settlement
notifications are observations only, and do not establish a bank receipt.
Activation and settlement operations remain absent from the provider allowlist
and deployed ingress. Any future production rollout remains separate.

## Customer prefill follow-up — 21 October 2026 (pending publication)

The owner clarified that PiggyVest is still staging-only and is not integrated
into customer checkout. Read-only inspection of its separate worktree found
provider customer/wallet mappings, provisioning fingerprints and result records;
these are not a reusable BVN/NIN profile. `plan-wallet-provisioning.ts` uses
synthetic KYC behind a staging gate. Do not treat those values as customer identity
or copy PiggyVest's staging provisioning into Oxygen.

The Oxygen handoff now has a server-side prefill implementation for the owned
Ogabassey customer profile: first name, last name, email and date of birth. The
order's email is a fallback only after matching the customer ID, merchant ID and
signed-in auth user. Queries use the normal RLS client with explicit columns;
missing/invalid fields or profile query errors leave manual entry available.
The checkout phone/address already come from the owned order workflow. There is
no full-name splitting, bank-account inference, identity-number storage, provider
KYC inheritance or automatic consent. Prefilled values remain editable and the
customer must review and consent before sending details to Oxygen.

Regression coverage includes profile isolation, safe email fallback, missing and
invalid profile fields, query errors, editable values, flow-to-form wiring, and
blank BVN/NIN/consent. Existing activation and settlement gates are unchanged.
CodeRabbit rejected the required review due to exhausted review capacity; this
change has not been promoted to the live handoff service. Its isolated build
release is `releases/prefill-20261021/app`, separate from the active checkout
release. Complete the review gate before publication and browser verification.

The bank-entry correction adds an authenticated, workflow-ownership-scoped
`POST /api/payments/oxygen/bank-details` endpoint. It uses the previously tested
GET bank-list and POST EXTERNAL name-enquiry contracts. The browser selects a bank
and enters the account number; bank code/name and the resolved account name are
filled automatically. The server derives phone from the owned workflow, accepts
no caller-selected phone, returns only bounded bank/name projections, and does
not save lookup payloads. Changing bank/number clears resolution and invalidates
late responses. These lookups neither change provider KYC status nor book a loan.
Merchant settlement accounts and customer wallet funding DVAs are not reused as
personal repayment bank details. No saved personal repayment bank profile was
found in the inspected customer schema. The new endpoint also needs an exact
Oxygen gateway ingress entry when the review gate permits deployment.

Final local verification for profile and bank wiring: 707 affected tests across
38 files passed; direct web Biome and web/tool-worker typechecks passed; the
isolated prefill release build passed. This does not replace the unavailable
CodeRabbit gate or prove browser/provider delivery of the unpublished change.
The active staging application and gateway were not switched.

## Local Ogabassey storefront QA — 21 October

The local Next storefront is served at `http://localhost:3440` from a private
runtime snapshot of this worktree, backed by the existing isolated staging
Supabase stack. This is not a hosted staging deployment or a production rollout.
The staging-only product `50000000-0000-4000-8000-000000000099` now belongs to the
new isolated Phones category. Its canonical URL is
`/savings-synthetic/phones/oxygen-checkout-test-phone`; the old `/products/` URL
redirects there and renders the custom Ogabassey PDP. The original PiggyVest
product and provider setup were not modified.

The private local gateway exposes the isolated Auth/REST bridge under
`/qa-backend` on the same origin as the storefront. This preserves the existing
CSP instead of allowing arbitrary local ports. The repository's
`calculate-commerce` handler runs behind a loopback-only Node compatibility
adapter restricted to `calculate_order`; it has no payment operations. Runtime
credentials and launch helpers remain outside the repository. The SSH bridge
uses keepalive checks; a tunnel outage must be recovered before testing.

The PDP/cart surfaces and scoped merchant-colour utilities were corrected.
Default content tokens now use light backgrounds and readable text independently
of the dark header/footer chrome; existing system dark-mode overrides remain.
Cart and checkout request data are behind local Suspense boundaries, including
route parameters and the cart VAT read, addressing Next's instant-navigation
insights. Regression checks cover pending route data, missing brand colours,
and the actual scoped Tailwind output.

Browser evidence: the canonical custom PDP rendered, its cart retained one
₦400,000 product, and checkout advanced with temporary synthetic contact details
through manual address inference, store pickup, and the selectable Oxygen staging
installment option. No order was submitted, and no approval, activation or
settlement was called. Contact inputs were cleared after QA. Live delivery rates
are unavailable without shipping-provider configuration; store pickup was used.
The local analytics sink is also unconfigured and reports an event-write error;
this is separate from checkout totals and provider progress.

Validation: the final affected checkout/theme/route suite passed 661 tests
across 49 files, including 31 focused route/theme checks across five files. Web typecheck, targeted Biome and diff whitespace checks
passed. CodeRabbit completed with zero findings for the three tracked storefront
route/CSS files it reviewed. The whole-worktree attempt exceeded its file cap,
and the broader source review disconnected; this is not a complete integration
review or authorization to ship.


## Local actual-checkout continuation — 21 October

The subsequent browser run completed canonical PDP → retained cart → customer
sign-in → store pickup → Oxygen selection → unpaid order → Oxygen application
form. It created order `6974e8cc-4e90-4ca9-b2cf-aa2abaf461df` for ₦400,000 and
workflow `641d7aa1-09a6-4f9a-9443-e42cb29c89c1`. Exact database reads confirmed
`unpaid`, `application_required`, version 0, and zero provider commands. This
supersedes the earlier screen-only run above, which did not submit an order.

The actual checkout submit handler now routes Oxygen orders to the resumable
application instead of the ordinary order-success page. Its authorization check
uses the storefront customer cookie session, and the order currency read-back
uses that caller's RLS client. Regression tests exercise the actual component and
verify that Oxygen does not initialize an ordinary payment gateway or create an
admin client for the order read-back. Local scoped order signing was repaired in
the private runtime without changing repository environment files.

The Oxygen page now places request data behind a Suspense boundary; incompatible
route-segment configuration was removed for the enabled Next cache-components
mode. Persisted contact-field border styling waits for hydration. A further
regression covers hiding Oxygen when wallet credit changes the amount payable.

The application resumes on refresh and loads Oxygen's staging bank list. The
isolated customer profile has a synthetic name; the user must review it and fill
missing identity, bank and employment fields and personally accept the terms
before provider verification. No provider application was submitted in this run.
Activation and settlement remain disabled. Live shipping and analytics provider
configuration remain separate limitations of this local environment.

The main affected validation run passed 1,228 tests across 75 files and the web
TypeScript check passed. The scoped checkout CodeRabbit review completed with
one minor eligibility-display finding, addressed with a failing-then-passing
regression. This scoped result is not a complete review of the integration and
no commit, merge, hosted deployment or production financial action occurred.


The standalone `/payments/oxygen` route was subsequently found to have no
stylesheet-owning layout. Added its own shared global stylesheet import and a
scoped light, readable page shell with the skip-link target. Browser evidence
confirmed the default inline controls changed to spaced, full-width styled fields.
The follow-up eligibility regression run passed 86 tests across three files;
web TypeScript and whitespace checks passed before this CSS/layout-only fix.


## Embedded storefront checkout correction — 21 October

The generic payment-plan handoff did not meet the requested actual-checkout UX.
Oxygen now continues within the existing Ogabassey checkout at
`/savings-synthetic/checkout?oxygenOrderId=6974e8cc-4e90-4ca9-b2cf-aa2abaf461df`.
The original handoff redirects to the same merchant checkout after customer
sign-in. Existing checkout header, brand theme, contact/delivery progress and
responsive order summary remain visible; duplicate order submission and discount
controls are removed during the saved finance step. No additional order is
created to resume. The summary uses the RLS-visible saved order and merchant ID,
not the current cart. Missing order data is refused rather than inferred.

The Oxygen form now reuses contact name and email saved with this checkout,
with existing profile data as fallback. BVN/NIN and bank information remain
missing; no provider KYC is inferred from contact reuse. The browser confirmed
correct merchant checkout routing, loaded bank options, contact prefill and
refreshing the saved application without mutation. Activation and settlement
remain disabled. The missing private KYC fields and customer consent still
block a complete provider E2E test.

Focused verification passed 56 tests across four files plus three handoff
redirect tests; web and worker typechecks were rerun. Scoped CodeRabbit review
is still separate from local preview verification; its minor existing provider
hook error-message finding remains to be addressed before shipping. No clean
full-integration review, hosted deployment or production readiness is claimed.


## Direct worktree runtime and native checkout design — 22 October

The frontend now runs directly from
`/Users/mac/Baci-worktrees/oxygen-integration/apps/web`; the private launcher
uses that worktree's Next executable and working directory. The old copied
frontend tree is no longer the serving source. No repository environment file,
proxy, production database or PiggyVest setup was changed. The same-origin local
gateway and isolated staging backend remain in use; the product/catalog data
is still the synthetic staging fixture, not the production Ogabassey catalog.

The normal PaymentStep and the saved Oxygen flow now share CheckoutStepCard.
The saved flow displays completed contact/delivery cards and an active payment
card, instead of a separate progress row and unstyled provider form. Its mobile
summary uses the existing MobileOrderSummary component, supplied with saved
order data. Oxygen identity, bank and income/consent are progressive sections;
known contact data is collapsed under Edit details. Inputs and actions match
Ogabassey's existing checkout classes. Going back retains in-memory identity
inputs without writing them to browser storage. Bank verification and explicit
consent are required before the start-application submission. Later OTP,
address and payment-plan inputs share the checkout field/action styles.

Browser verification confirmed the native summary expand/collapse, saved
contact values, styled identity step and the canonical PDP in the directly
served app. The product tab was left open for the user to begin their own
journey. The staging cart already contained one test product; QA did not add a
second item or create another order. Full provider progression still requires
the user's missing KYC data and consent. Activation and settlement remain
disabled. Focused tests passed 148 cases across nine files, with web and worker
typechecks passing; the native mobile summary also has a separate regression.
This is a local preview, not a production deployment or a completed financial
end-to-end test.


## Real catalog product fixture — 22 October

The local catalog now includes Samsung Galaxy A16 LTE (4GB/128GB) copied from
Ogabassey's public get_product response observed during this session. Source
product `f6c22071-e9e4-4c9a-add9-692ebfe3c8e5` listed a ₦198,000 price,
₦210,700 comparison price and Blue/Black options. Name, description, image URLs
and those exact variant attributes/prices were copied into the existing isolated
merchant, with source provenance in product metadata. No production catalog
record was modified and no product asset was downloaded.

Local product: `50000000-0000-4000-8000-000000000097`, slug
`samsung-galaxy-a16-lte-4gb-128gb`; variants end in `095` and `096`. The public
source did not confirm stock. Inventory tracking is explicitly off for this
staging copy; zero stored stock does not establish a production stockout or
availability. The previous synthetic product and saved order remain unchanged.
The direct local PDP returns HTTP 200. Activation and settlement stay disabled.


Browser check: the Samsung PDP rendered its real product photograph and
₦198,000 price. Add to cart produced one Samsung line with Blue / 128GB and the
same total, with shipping shown as calculated at checkout. The old synthetic
cart line was removed first. After verifying the Samsung line, it was removed
again so the user can start with an empty cart; the real PDP was left open.
No order, provider application, activation or settlement was created in this
catalog/cart check. Delivery details and delivery costs precede payment in the
intended checkout journey.
