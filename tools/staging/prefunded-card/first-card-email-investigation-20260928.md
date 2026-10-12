# First-card staging email investigation

## Verified observations

- The owner report for intent `d8bcf921-61b3-4647-90e2-5648e4d6967d`
  shows `pending`, 10,000 kobo, no checkout URL, collection `pending`, transfer
  `not_started`, and projection `unapplied`. Verification using the prepared
  activation configuration returns HTTP 400, `transaction_not_found`.
- The running public container reaches Paystack within the application timeout:
  an unauthenticated GET returns HTTP 401. This proves basic connectivity, not
  successful authenticated initialization or settlement.
- The staging phone fixture email ends in the reserved `.invalid` domain.
- A non-charging initialization probe using that fixture email, a separate
  diagnostic reference, and the adapter's card-only 10,000-kobo request shape
  returned HTTP 400: `invalid_params`, `validation_error`, and the message
  `"email" must be a valid email`.
- Repeating that diagnostic initialization with **only the email changed** to
  `baci-staging@example.com` returned HTTP 200. The reference, Paystack checkout
  hostname, alphanumeric access code and URL/access-code equality all passed
  the current adapter's response checks. Object-valued metadata was accepted.
- Diagnostic reference: `pvb-first-feabcd09-d0f9-4e28-903c-2576140184bc`.
  No card was charged, no checkout URL was published, no database intent was
  created for the probe, and no PiggyVest transfer was attempted. Do not use
  this diagnostic checkout to pay. A subsequent verification probe did not
  produce valid JSON; no transaction-status conclusion is drawn from it.

## Application defect and source fix

The public entrypoint previously accepted a syntactically valid `.invalid`
email, reserved treasury capacity, and attempted provider initialization.
Initialization errors then became an uncertain `pending` result. A repeated
start does not initialize again, so an explicit validation failure can strand
the attempt. The historical initialization response was not retained, so the
probe reproduces the fixture failure without proving that response was the
original attempt's exact failure.

New-checkout preflight now rejects known non-public email suffixes before
reservation. This is not a complete Paystack email-validator replacement.
Existing payment-status verification remains available for legacy email
identities; it must not be blocked by the new-checkout guard. Unknown provider
errors still fail closed and do not authorize resubmission.

## Not changed or proven

- No production, deployment, account identity, balance, lease or treasury-budget
  changes were made during this investigation. Source changes are not deployed.
- The original pending intent and its reservation are retained. A verify
  `transaction_not_found` response or rejection of a separate probe does **not**
  authorize deleting, resetting or marking that original intent unpaid.
- The owner applied the coordinated Auth/customer/phone-fixture email repair to
  `baci-staging@example.com`. The success receipt confirms the same user,
  same-password login, preserved 10,000-kobo principal and untouched pending
  attempt. No payment was started.
- An audited original-attempt recovery/disposition is still needed before a
  further funded test. Preserve exactly-once processing and the approved
  10,000-kobo treasury budget; do not manufacture provider transaction evidence.

Provider contract: https://paystack.com/docs/api/transaction/

## Local validation

- Red-first public-runtime regression proved the rejected-domain customer
  reached `checkout_reserve` before the fix.
- Seven focused suites: 64 tests passed, including legacy pending verification.
- Broader prefunded-card suites: 88 suites, 796 tests passed.
- Changed-file Biome and web/application plus worker typechecks passed.
- Repository lint still has 11 unrelated mobile-storefront errors. Repository
  typecheck fails in the untouched mobile checkout controller test at lines
  153, 172 and 180 (`TS2345` and `TS18046`). No full-repository green claim.
- Luna reviewed the change without blocking findings. No activation or
  original-attempt disposition was performed.

## Approved email repair

- A fresh password-grant login confirmed the existing staging user UUID and
  the original fixture email digest. The owner repair pins both, the isolated
  physical database ID, customer, merchant, goal and existing expiry.
- `phone_email_owner.py` uses the private GoTrue admin update API, not direct
  Auth-table edits. It supplies only the new email and confirmation flag; no
  password or identity replacement. It then narrowly updates the customer email
  and atomically replaces only the phone fixture email line.
- Auth and the fixture are not one transaction. A root-only baseline and backup
  permit phase-aware retries after a timeout without repeating completed steps.
  A final failure must be treated as potentially partially applied, not unchanged.
- The script proves same-password login, authenticated customer/goal reads,
  unchanged password hash, goal principal, treasury reservations and checkout
  state. It never calls a payment provider or changes the original intent.
- The source's localhost Auth binding was not reachable in a read-only probe.
  The script instead resolves the running Auth container on the verified isolated
  database network. No public admin route, firewall change or restart is needed.
- Tests cover partial success, reruns, collisions, drift, staged-file tampering,
  symlinks, directory substitution and endpoint isolation: 19 checks passed.
  A disposable local PostgreSQL rehearsal passed;
  it preserved the old intent email and 10,000-kobo reservation.
- Repository lint/typecheck retain the unrelated mobile failures listed above.
  CodeRabbit refused the dirty worktree review: 222 files exceed its 150-file limit.

Admin update contract:
https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid

After the email repair, the original pending attempt still needs a separate
evidence-backed disposition. This repair does not make another funded test safe.

## Independent post-apply verification

On 2026-09-28, a fresh password grant using the updated approved phone fixture
returned the same pinned Auth user. Authenticated read-only application checks
returned:

- Goal read: HTTP 200, same goal/customer/merchant and current amount of ₦100.
- Phone-origin first-card capability: HTTP 200, `enabled: false`,
  `maximumAmountKobo: 0`, correct goal ID.
- No checkout initialization, card charge, provider transfer or financial write
  was attempted by these checks.

The current deployed storage contract deliberately continues to block the
unresolved intent. The owner approved a separate staging-only retirement path
on 2026-09-29. Its implementation and disposable database rehearsal are complete;
the owner command is not yet applied. See `checkout-retirement-20260929.md`.
The original attempt must not be labelled provider-failed from a
`transaction_not_found` response alone. No budget increase is authorized.
