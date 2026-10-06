# PiggyVest interest allocation and whole-wallet migration

Status: design and readiness boundary, 26 September 2026. This document does
not authorize provider mutations, interest credits, transfers, or migration.

## Product intent

- Target state: ordinary Baci wallet balances are held with PiggyVest. Any interest on those
  balances belongs to the business; it creates no customer earnings liability.
- A customer can opt into an eligible savings plan. Only that plan's verified
  principal and eligible interest can contribute to its customer benefit.
- The business share, if any, is an explicit contractual/economic allocation;
  it is not inferred from a provider dashboard setting or wallet balance.
- Pending accrual is an observation and never spendable. A paid, reconciled
  payout is a separate event and is not spendable until its ownership,
  destination, amount units, tax, fees, and allocation reconcile.

## What the provider contract establishes

The wallet creation API documents `enable_interest_accrual` (default true) and
`interest_payout_wallet` (a wallet receiving interest). It does not document
either field as a percentage, a per-wallet split, or an allocation instruction.
Provider support confirmed that the interest split is dashboard-global and
cannot vary per wallet. Do not use either field to encode a customer/business
percentage. The current accepted probe retained its requested destination but
reported rate 0 and balance 0; this proves neither an active rate nor a paid
payout. No actual interest payout has been received.

The accrued-interest endpoint returns dated accrual rows, including amount,
balance, percentage, and original/differential type. Its response does not
establish monetary units or a payout entitlement. Published terms say accrual is
daily, previous-month interest is paid on the first of the month, and more than
four bank-transfer outflows in a month forfeit that month's payout. Treat these
as provider terms to disclose and reconcile; do not derive a guaranteed rate
from them. See [wallet creation](https://www.piggyvestbusiness.com/docs/api/wallet/create)
and [accrued interest](https://www.piggyvestbusiness.com/docs/api/wallet/interest).

## Allocation model

Keep four financial concepts separate in Baci's canonical ledger:

1. **Ordinary wallet liability:** customer principal available under the
   ordinary-wallet product. No interest from this wallet is credited to the
   customer's earnings. Ordinary-wallet principal is never silently
   reclassified as a plan.
2. **Plan principal liability:** principal attributable to one opted-in plan,
   based on settled deposits only. It remains distinct from provider balance
   and is not created by an accrual observation.
3. **Accrued interest observation:** provider-reported amount by wallet and
   accrual date/type, held as pending and non-spendable. Keep the raw provider
   observation reference and normalized amount-unit evidence; do not post a
   customer or business allocation yet.
4. **Paid payout allocation:** a provider payout with durable unique identity,
   matching wallet/period/destination and reconciled gross, withholding tax,
   net and fees. Post each confirmed component once. Customer-eligible net
   becomes plan earnings only if the plan is opted in, satisfies the withdrawal
   eligibility rule, and has an approved period/disposition policy. The
   contractual business share posts to a separate business-interest account.
   Pending, forfeited, unallocated, and paid amounts remain distinguishable.

Do not choose a business/customer percentage in code or configuration until an
approved product/economic decision and provider-compatible routing evidence
define it. The intended ordinary-wallet allocation is 100% business and 0%
customer. The plan allocation must follow the approved customer/business
economics; do not assume a residual, dashboard default or unverified percentage.
Because the provider split is dashboard-global, the chosen design must prove
that each wallet's payout can be attributed and allocated internally from
reconciled provider facts, or provide a provider-supported route that honors
those distinct policies. Until then, do not activate customer-facing interest
or post either allocation. This is not an instruction to change existing
provider wallets or disable the separately authorized, unmapped interest probe.
`interest_payout_wallet` may route a
payout; it does not prove wallet ownership, per-plan attribution, split amount,
or reversal behavior.

Fees are independent ledger components. Do not subtract an assumed transfer,
platform, or payout fee from customer earnings or business share. Establish the
fee payer, amount basis, and charged-wallet evidence first; otherwise retain
the payout for reconciliation without allocating it. Tax withholding is not a provider fee and must
remain its own reconciled component.

## Provisioning and migration sequence

1. **Ordinary wallet creation:** the target policy is accrual enabled only when
   verified provider routing and reconciliation allow 100% of ordinary-wallet
   interest to be retained by the business with no customer earnings credit.
   Until that evidence exists, set accrual false explicitly. Confirm the created
   wallet's identity and effective provider-side settings before accepting it
   as the ordinary-wallet destination. The current generic provisioning
   command can carry explicit accrual/destination choices, but those choices
   alone do not establish provider-side effective configuration.
2. **Existing ordinary balances:** inventory each balance and pending transfer
   against its exact owner and source wallet. Obtain an approved, documented
   transfer path, fee responsibility, idempotency/correlation, finality and
   recovery contract before moving any money. Reconcile source debit and
   destination credit before changing the Baci liability mapping. Never
   convert a current wallet into a plan wallet by relabeling it.
3. **Plan enrollment:** record explicit customer opt-in and plan terms before
   creating a distinct plan wallet. Enable accrual only after the allocation,
   payout route, forfeiture disclosure, rate/units, and period attribution are
   verified. Until then, plan principal may be tracked, but interest remains
   disabled and no customer earnings promise is made.
4. **Period close:** ingest accrual observations as pending evidence; reconcile
   the actual payout event and destination to the period. Check eligibility,
   gross/tax/net, fees, duplicate/conflict identity, and all relevant provider
   transfers. Only then post distinct customer and business allocations in one
   idempotent ledger operation.
5. **Reversals and late events:** hold unresolved or conflicting outcomes in
   reconciliation. Do not invent reversal states, claw back spendable funds,
   or allocate late payout to a current plan without an approved period policy
   and provider evidence.

The existing ledger already distinguishes principal, eligible paid interest,
pending interest, and reservations. The implementation gap is the proven
provider payout attribution and economics that can safely feed those buckets,
not another parallel balance ledger.

## Readiness gates

No interest-enabled production provisioning or Earnings credit until all are
true:

- Written economic policy establishes opt-in scope, customer/business shares,
  forfeiture/cancellation/late-payout treatment, and customer disclosures.
- Documentation or genuine bounded tests establish effective split semantics,
  wallet-specific destination behavior, and compatibility with the approved
  allocations. Ask the provider only for evidence that cannot be obtained safely
  through its documented API; the global-only split limitation is already confirmed.
- A synthetic sandbox test observes a nonzero rate and a genuine paid payout;
  the payout's currency units, period, gross/tax/net, destination, fee handling,
  unique identity and duplicate delivery behavior reconcile.
- The payout reaches the canonical savings ledger exactly once and the
  customer-facing Earnings view uses only the confirmed customer-eligible paid
  amount. Business proceeds are accounted separately.
- Ordinary-wallet interest is either verified off while blocked, or its
  provider payout is proven to accrue to and be retained by the business with
  zero customer allocation. Existing balance migration has independently
  reconciled source and destination settlement.

Current readiness is **blocked**: dashboard split is global, the accepted probe
has rate 0/balance 0, no real payout has been received, and allocation/routing
and payout monetary semantics are not proven. Existing accrual observations
remain non-spendable. The deployed receipt worker is inflow-only; this design
does not connect or claim an interest webhook or Earnings path.

## Source alignment and implementation handoff

- `apps/web/src/lib/piggyvest/provisioning-request.ts` serializes the documented
  accrual flag and optional destination, guarded by trusted configuration. Keep
  these flags as provisioning choices; do not treat them as economic authority.
- `apps/web/src/lib/piggyvest/accrued-interest.ts` returns observations with
  `monetaryUnits: 'unconfirmed'` and `spendable: false`. Preserve this boundary.
- `apps/web/src/lib/piggyvest/savings-ledger.ts` delegates to the canonical
  savings ledger; future payout integration should allocate there rather than
  add another wallet balance ledger.
- `docs/piggyvest-provisioning-local.md` describes synthetic,
  disconnected provisioning and keeps routing verification outstanding.

Parent integration should wire nothing from this design into the protected
receipt/replay entry points until the readiness evidence above exists. The
current live interest event path and canonical ledger bridge require a separate
bounded implementation after contract evidence; this lane intentionally adds
no executable interest or provisioning behavior.
