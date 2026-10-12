# Approved sandbox treasury prerequisite

The owner approved wallet `01M238A0V75387H4HZ15YFWGX3` as the separate company
prefunding wallet on 27 September 2026, with a maximum opening budget of 10,000
kobo. Read-only provider list and retrieve calls agreed on the business, active
API-wallet status, NGN currency, absent customer link and 10,000-kobo balance.
This is not the customer's existing 10,000-kobo savings wallet.

## What the owner bundle does

The externally pinned root bootstrap copies the runner before executing it. The
runner then copies the closed file set to its private root directory and checks
the embedded checksum-list digest and every payload. No user-writable Python or
Node code is executed as root. `env -i` removes inherited runtime overrides.

The owner script reads the existing staging-only provider credential and private
database CA without printing them. It creates one root-only snapshot-verifier
config, preserving an existing matching config and password on retry. It performs
a fresh provider GET and refuses a changed identity or opening balance.

The SQL transaction verifies the physical database, enabled integration and
merchant, separate unmapped source wallet and inactive treasury operator. It
creates the immutable 10,000-kobo treasury identity and dedicated verifier binding,
plus a restricted snapshot login with password expiry at the existing deadline.
The verifier cannot SET ROLE, read tables, call the unscoped snapshot recorder,
provision treasury funds, replenish the budget, or execute card-worker operations.
Its three scoped RPCs verify identity, read database time and record observations.
Snapshot sequence allocation serializes on the treasury row; duplicate observations
do not add another sequence or increase the spending budget.

The bundled one-shot CLI must then connect over certificate-verified TLS as that
restricted login, retrieve the exact provider wallet, and record a fresh snapshot.
Only that success produces `TREASURY_PREREQUISITES_READY`. A SQL error is reported
as apply-unconfirmed rather than claiming the transaction certainly rolled back.
For a completed apply with a failed TLS proof, a retry preserves the credential,
compares the installed function bodies and immutable scope, then retries the proof.
Foreign or partial state is left untouched for inspection.

## Deliberately unchanged

- The existing savings plan, public amount, contributions and canonical opening.
- The three card-worker roles remain `NOLOGIN`; card payments remain disabled.
- No credit route, legacy recognizer replacement, service, timer, public Nginx
  route, Vercel deployment, card charge or PiggyVest transfer is created or started.
- The deadline remains `2026-09-29T15:59:10Z`; no approval window is extended.

The setup is therefore not phone readiness. Before card activation, the remaining
cutover must reconcile any intervening bank deposits, deploy the original-signature
receipt replay path and reviewed alias fix, provision the restricted application
workers and independent verifier schedule, validate the staging app privately,
then activate public routing. A first card test still needs collection, actual
PiggyVest settlement, exactly-once projection and customer-visible progress proof.

## Validation

Run the six colocated `treasury-owner*`, `treasury_owner_*` and
`treasury-snapshot-store.test.py` Python suites; the two SQL suites start disposable
PostgreSQL only. Run the colocated TypeScript snapshot-config/store/file/CLI tests
and web typecheck. A synthetic compiled CLI refusal does not replace the required
live restricted TLS proof. No secrets belong in repository fixtures or reports.

## Installed prerequisite, 27 September 2026

The owner successfully executed the reviewed bundle from
`/home/bassey/baci-treasury-prerequisites-20260927-r3`. Audit files are retained at
`/root/baci-treasury.oQSm17IV`; do not rerun it for card activation.

Pinned SHA-256 digests:

- Owner command: `06448b577a808ff1f31d3e31c2ced55444e8b26568c694539ac4b44ab7917754`
- Root runner: `f1d5bd819f58f378545c32fa8c7bf892f4ce4d973eb10fd0f52c49d4a68f217d`
- Checksum list: `6fa74567fa815393b16028550531a2d9f33543dd5a39a253e758cbd5c379941d`

This supersedes both earlier bundles. The final
CLI uses an explicit refused-result discriminant, and both CLI source and tests
are now included in the existing tools-workers typecheck to prevent coverage gaps.

Current evidence: 24 Python/SQL tests and 49 focused TypeScript tests pass, scoped
Biome passes, and all six monorepo typecheck tasks pass. The compiled CLI refuses
without configuration; Bash syntax, ShellCheck and remote Node syntax checks pass.
Whole-repository lint remains blocked by existing mobile findings. CodeRabbit's
completed folder review reported three minor findings outside this installer and
no treasury-installer finding; Luna independently reviewed the corrected merchant
scope. No clean whole-folder review is claimed. The later checkout-promotion
repeat-update and saved-card capability maximum fixes are now implemented and
tested in source, not deployed; neither file is in this prerequisite bundle.
The third finding concerns an existing diagnostic in the separate receiver worktree.

Independent post-install read-only verification shows the exact company treasury
enabled with opening budget 10,000 kobo, reserved 0 and consumed 0. Snapshot sequence
1 recorded 10,000 kobo at `2026-09-27T14:27:09.864Z` using
`prefunded_snapshot_verifier`; its credential expires at the unchanged deadline.
That snapshot is historical proof, not a claim that it remains fresh for dispatch.
Public savings remain NGN 100, with zero credit routes, card operations, checkout
intents and active card-worker logins. The owner verified restricted TLS and reports
private config SHA-256 `26438acf5cef760c82a626ccdf7c62ca6ea1e4a531022b6bce1148529e257284`.
No payments, scheduled verifier or card services were enabled by this step.

## R2 refusal and R3 correction

R2 failed with SQLSTATE `42703` because its merchant check incorrectly referenced
`piggyvest_staging.integrations.merchant_id`. The live registry has only `id`,
`expected_provider_account_id` and `enabled`; merchant ownership belongs to
`wallet_goal_mappings`. The original candidate test masked the defect by adding a
fictional registry column. Removing that fixture alteration reproduced the exact
live undefined-column failure before the fix.

R3 checks the provider registry separately, then locks and joins the wallet
mapping, customer, active goal and enabled canonical accounting binding on their
matching integration/merchant/customer/goal identities. It requires the reviewed
treasury operator binding and still rejects every customer-mapped treasury wallet.
No registry column, migration, scope or authorization check was weakened or added
to the live database. This uses the migrated legacy plan's accounting binding,
not the unrelated canonical-draft binding tables.

Read-only live verification after the refusal found zero treasury bindings, zero
snapshot tables/logins or capability roles created by this installer, zero credit
routes and card operations, and the unchanged NGN 100 savings balance. The corrected
join matches the live database. All four pre-existing treasury helper function
bodies match the source used in the rehearsals. Negative tests cover conflicting
merchant/customer/goal ownership, a disabled binding and a closed goal; a separate
retry test proves the saved private config and verifier password are not rotated.
The new owner command retains the root audit from `/root/baci-treasury.e02Ua2Yr`;
it does not delete or rerun that failed bundle.
