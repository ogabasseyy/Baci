# Interest payout bridge contract and implementation

The technical-team sample supplied on 1 October 2026 pairs
`eventType: interest-payout.success` with `eventCategory: interest_payout`.
The receiver accepts this underscored category and the legacy hyphenated
`interest-payout` fixture, without accepting other categories. The sample's
814 gross, 81 tax, and 733 net are integer kobo: the net payout is NGN 7.33.
Its nullable envelope destination is supported; the nested destination wallet
remains authoritative, subject to the independently verified binding below.
Local fixture/replay tests establish payload compatibility, not signed delivery,
phone-goal ownership, deployment, or a balance credit.

`interest-payout.success` is eligible for the bridge only after all of these
inputs have been independently verified in one transaction:

- provider business identity and `NGN` currency for the receipt, from a
  provider-certified payload or authenticated reconciliation read;
- a trusted `(provider business, provider customer, accrued-interest source
  wallet, payout wallet)` binding to exactly one active, opted-in customer
  goal. The bridge obtains the source from `pvb_accrued_interest_wallet` and
  the payout destination from `eventData.destination_wallet`, corroborated by
  `pvb_destination_wallet` when non-null; it must not infer either from
  `pvb_wallet`;
- gross, withholding-tax, and net amounts in integer kobo, with
  `gross - tax = net` and receipt amount equal to net;
- a product-approved allocation policy identifying what portion, if any, is
  customer earnings. PiggyVest dashboard split settings are not a per-wallet
  allocation contract.

The older `replay-interest-dispatch.ts` remains a side-effect-free assessment.
The actual dispatcher is now `replay-interest-runtime.ts`, invoked by
`replay-runtime-pass.ts` for authenticated interest receipts. Without the
explicit restricted financial connection it remains deferred. It does not use
the legacy inflow wallet mapping, invent an interest rate, or credit accrual.

## Restricted SQL adapter

The savings worktree migration
`20260926170000_piggyvest_interest_bridge.sql` implements
`piggyvest_savings_ledger.apply_interest_receipt`. Its single transaction:

1. lock and validate the trusted binding and the canonical goal eligibility;
2. insert an immutable observation keyed by provider payout identity, comparing
   the economic fields (amount, wallets, customer, business, and currency) on
   replay and rejecting a changed economic identity as a conflict. A genuine
   redelivery may have a different transport `eventId` and must not conflict
   solely for that reason;
3. invoke the existing `piggyvest_savings_ledger.apply` operation exactly once
   only for the approved customer allocation, using the provider payout identity
   as its economic idempotency key; and
4. return `applied`, `duplicate`, `deferred`, or a conflict outcome without
   exposing balances, credentials, or internal policy inputs.

The function must not be granted to `anon`, `authenticated`, or `public`.
It needs RLS-preserving restricted-worker access, explicit schema qualification,
and disposable PostgreSQL tests for cross-business, cross-customer, wrong source
wallet, wrong payout wallet, arithmetic mismatch, duplicate replay, and changed
economic identity.

The migration grants no application or worker access and seeds no allocations.
The owner must independently approve the exact source-wallet payout economics,
positive customer allocation, eligibility evidence, policy reference, canonical
goal binding, and restricted worker grant. A physical PostgreSQL system-ID pin,
exact login, enabled integration/business registry, and current customer/goal
ownership are checked before applying. Operation, balanced postings, existing
notification trigger effects, and receipt commit together; an acknowledgement is
returned only after commit.

The append-only `20261001140001_piggyvest_interest_existing_authority.sql`
also permits the existing `prefunded_treasury_operator` login. It preserves the
immutable canonical binding and requires `authorized_login = session_user`;
neither login can use the other login's binding. The treasury transport requires
certificate-validated TLS and permits only the paid-interest bridge statement,
not accrual, outflow, or general ledger statements. It needs only a separate,
explicit grant on this bridge, never on `apply` or private `apply_bound`.
Installing these migrations alone does not enable replay or credit money.

The treasury-role runtime also disables legacy bank-inflow mapping and dispatch
before any application RPC, and rejects prefunded-bank callback activation in
the same configuration. The runtime and durable adapter also refuse injected
prefunded callbacks in this mode, even without a configuration activation.
Restricting its SQL connection alone is insufficient:
legacy inflow recognition uses the separate app token. Non-interest receipts
remain deferred rather than being credited through that alternate authority.
Ordinary bank replay retains its explicitly separate legacy mode.

Economic deduplication is by `(integration, payout_id)`, not transport `eventId`.
This supports one independently mapped source-wallet/goal payout. It is not a
pooled-business-payout distribution engine. Zero/unapproved customer allocations,
ordinary-wallet interest, and the business remainder are not silently credited.
The global dashboard split does not provide the missing customer allocation.

Local disposable-PostgreSQL tests cover duplicate races, process restart, ownership
and amount mismatches, privilege rejection, and rollback after a posting. These
tests do not prove a real PiggyVest payout or delivered phone notification.
On 1 October 2026, both bridge migrations were independently verified installed
on the isolated staging application database, with zero allocations/receipts and
no worker access. The transport changes in this receiver worktree remain local.
Replay and phone delivery are not activated by that schema-only installation.
No accelerated payout endpoint or missing field is fabricated.

## Interest-only readiness

The treasury configuration does not require a prefunded-bank runtime. Its
readiness check independently verifies both restricted HTTP database identities,
then a certificate-validated TLS, read-only, non-superuser treasury session and
physical database identity. It queries metadata for schema usage and execution
on the exact paid bridge function; it does not execute a payout or grant access.
An absent grant reports `interest-authority`; transport, session or physical
identity failures report `financial-database`. Bank readiness remains separately
configured, and a missing bank configuration without explicit treasury mode
still refuses readiness.

The 1 October private disposable-container check verified both HTTP identities
and restricted TLS with the prepared interest-only credentials through
`2026-10-06T15:59:10Z`. Its deliberate final refusal is `interest-authority`.
The five financial containers and four financial services remained stopped,
principal remained 10,000 kobo, and no allocation or paid receipt was created.
The temporary checker was removed. This proves transport, not paid replay,
customer eligibility, notification delivery or phone interest completion.
