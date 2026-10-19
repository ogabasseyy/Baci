# Staging paid-interest bridge

## Verified deployment, 1 October 2026

The original bridge migration and append-only
`20261001140001_piggyvest_interest_existing_authority.sql` were installed on
application database `7685292944002592802` in one guarded transaction.
Three rollback-only rehearsals passed before the final installation.

Independent read-only verification confirms:

- the bridge exists and is owned by `postgres`;
- the existing treasury login is accepted only for its own immutable goal binding;
- no worker permissions, allocations, or interest receipts were added;
- customer principal and available treasury remain 10,000 kobo each;
- paid interest remains zero and the earlier checkout remains retired.

A fresh login using the existing private staging phone fixture returned 200.
The authenticated phone-origin wallet GET also returned 200, reporting Savings
at ₦100 and Earnings at ₦0. No goal or financial transaction was created.

Validation: 2 disposable-PostgreSQL tests, 7 installer tests, and 39 focused
receiver tests passed. Receiver-worktree typechecking passed. The full receiver
workspace run did not pass: 16 web test files failed (19 failed tests plus 3
failed suites), while 5,673 files passed. Failures were in unchanged migration
registry, cost/evidence, analytics, quiz, and older gateway/proxy tests.
Workspace lint also reports failures in other unchanged dirty files; the changed
TypeScript files pass focused Biome checks. These broad failures were not repaired
as part of this interest-only change.

This is **schema-installed-inactive**, not completed payout processing.
The receiver's TLS/interest-only transport change exists in the separate receiver
worktree and has not been deployed. Financial replay and notification delivery
were not started or renewed by this installer. Connectivity renewal does not
renew financial credentials or compiled financial-runtime deadlines.

The canonical savings worktree now also accepts the provider's
`eventCategory: interest_payout`, alongside the older `interest-payout` spelling.
The regression exercises the public webhook parser and rejects unrelated
categories. This parser correction does not change provider interest eligibility,
wallet rates, customer mappings, balances, signature verification, or deadlines.
The installed replay bundle still requires a separately reviewed replacement;
source tests are not evidence that staging is running this correction.

## Reviewed installer

`install-schema.py` requires the exact pinned migrations and `schema-guard.sql`
beside it. `--rehearse` ends with rollback; `--apply` ends with commit.
Installation refuses existing bridge objects, identity or protected-state drift,
unexpected grants, inherited access, or changed parent function bodies.
Do not rerun it to enable processing or relax its preconditions.

The final owner bundle manifest SHA256 was
`85dac1c829b126d44fb0298c8eb3a3f1f4b12dec699ce52362a8dd40025a67aa`.
Root audit files were retained, including the committed result. A failed or
interrupted invocation is unconfirmed until independently read back.

## Automatic attribution and phone preview

The append-only `20261001230001_customer_savings_interest_policy.sql` adds
automatic full-net allocation for an independently verified, opted-in
customer-wallet policy. It does not seed a policy, grant worker execution, change
provider settings, or credit money. Every new credit, including one with a legacy
manual allocation, must match the current enabled, unexpired policy and immutable
customer/goal binding. Previously committed exact duplicates remain duplicates.
The ledger, receipt, allocation and single customer notification commit together.

The existing authenticated `get_customer_savings_earnings` RPC has a two-argument
overload returning cumulative credited Earnings and available paid interest per
owned goal. The one-argument contract is unchanged. Mobile projects the per-goal
credit into Savings, plan progress and Total once; Earnings is an informational
breakdown, not another balance to add to Total. Foreground return and a scoped
30-second foreground refresh pick up committed payouts without relying on a
public goal update. Existing push-driven cache invalidation is retained.

In a verified development staging runtime, Wallet exposes **Preview sample
interest**. It opens only when tapped, is explicitly simulated, and sends no API
request or push and changes no real wallet. The provider sample shows 814 kobo
gross, 81 kobo tax and 733 kobo net: a ₦100 plan previews ₦107.33 with ₦7.33
Earnings. The real staging phone wallet was independently read as Savings ₦100
and Earnings ₦0. The staging iOS Metro bundle returned HTTP 200.

### Reviewed inactive policy installer

`activate-policy.sh` copies the checksummed owner bundle from
`/home/bassey/baci-interest-policy-20261001-reviewed`, verifies its sealed manifest,
runs a rollback-only rehearsal, then installs the policy schema and authenticated
read overload. Expected marker: `INTEREST_POLICY_SCHEMA_READY`.

This installer is **not worker activation**. It refuses protected-state drift or
running financial runtimes, installs zero policies and grants no worker access.
The sealed bundle was installed through the owner-authorized root web console
on 2 October. Both the rollback rehearsal and guarded commit succeeded, with
marker `INTEREST_POLICY_SCHEMA_READY`. Independent read-only verification
confirmed zero policies, allocations and paid receipts, no worker execution
grant, unchanged 10,000-kobo principal and treasury, and the retired checkout.
All five financial containers remain stopped. The authenticated phone-origin
wallet and new per-goal read overload both returned 200; Savings remains ₦100
and Earnings ₦0. An interrupted apply is unconfirmed until independently read
back; do not blindly retry this already-installed bundle.

## Current activation status

See `status-20261002.md` for the newer owner-verified interest-only replay and
notification activation. Those runtimes are renewed through 6 October;
customer attribution, genuine payout delivery and card funding are not inferred
from their readiness. The earlier deployment notes remain historical evidence.

## Remaining activation gates

1. Obtain a genuine signed `interest-payout.success` receipt and independently
   verify its business, currency, source wallet, destination wallet, and economics.
2. Approve the exact opted-in customer-wallet policy from independent provider
   evidence. The policy schema is installed, but a global rate or dashboard split
   does not establish wallet eligibility or customer attribution. New matching
   payouts then allocate automatically; company-profile payouts do not.
3. Review restricted access and coherent financial leases. Grant only the bridge
   surface, never canonical `apply` or private `apply_bound` to the replay worker.
4. Deploy the reviewed transport with certificate-validated TLS and verified
   private hostname resolution. Do not start old expired financial artifacts.
5. Verify committed earnings, unchanged principal, duplicate delivery, and actual
   phone notification separately. Daily accrual and simulated events are not paid
   earnings evidence.

The read-only provider API audit found no October payout among its five API
wallets, and no October receiver receipt was found at verification time.
This was not a complete audit of dashboard business profiles. After dashboard
reauthentication on 1 October, a successful September interest payout was visible
for Liquid Inventory: ₦14.08 credit, ₦1.40 withholding-tax debit, ₦12.68 net,
reference `PVB01M3V3DEZ2RRPHM6GTATQS9BMJ`, displayed time 1 October at 07:46.

Dashboard balances were ₦1,472.44 for Savings Profile (Main), ₦1,427.58 for
Liquid Inventory, and ₦0 for Profit. Using the current staging key with the
documented wallet-retrieval endpoint returned HTTP 404 for the observed Main
and Liquid Inventory profile IDs. This establishes the current key/endpoint
limitation, not universal API inaccessibility or absence of a parent payout.

The dashboard payout does not prove customer-goal attribution, the API wallet's
eligibility, a signed webhook receipt, or a customer allocation. It must not be
credited to the phone plan based on the company profile's balance or reference.
Neither the limited API audit nor the parent-profile payout replaces PiggyVest's
confirmed global 9% customer rate and 3% split with an inferred setting.
