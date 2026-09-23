# GIGL Merchant-Wallet Shipping and Platform Margin

## Goal

Let merchants ship Admin-created manual orders with GIG Logistics even though
those orders did not receive a checkout quote. At fulfilment time, Baci obtains
a fresh GIGL quote, shows one final shipping price, and books only after the
merchant confirms payment from the merchant wallet.

At the same time, add a Baci-owned 10% margin to every GIGL quote returned by
the shared shipping API so web storefront, mobile storefront, and Admin all use
the same price. The provider tariff, Baci margin, and final charged amount remain
separate internal financial values.

## Approved Product Decisions

- The platform margin is 10% and applies only to GIGL quotes.
- The margin applies everywhere a GIGL quote is offered: web storefront,
  mobile storefront, and Admin/manual fulfilment.
- The merchant or shopper sees one bundled final shipping amount. The UI does
  not itemize the GIGL tariff and Baci margin.
- The displayed amount must be the amount ultimately charged. Provider cost,
  margin, and charged total are retained internally for reconciliation.
- A storefront order whose shopper paid shipping at checkout is not charged to
  the merchant wallet again. Baci retains the full customer-paid GIGL shipping
  amount from settlement and pays the GIGL tariff from Baci's provider wallet.
- An Admin-created/manual order has no prepaid carrier amount. Its GIGL shipping
  amount is debited from the merchant wallet when the merchant confirms booking.
- If the merchant wallet is short, the Admin app immediately offers bank-transfer
  funding through a merchant-scoped Paystack dedicated virtual account (DVA).
- The funding UI shows the exact shortfall. Any excess transfer remains in the
  merchant wallet.
- Funding never auto-books a shipment. After the balance arrives, the merchant
  still confirms the current quote, preventing an unexpected booking after a
  price or address change.

## Pricing Contract

Provider adapters continue to return provider tariffs. A single server-only
pricing projection converts a GIGL provider quote into the public quote:

```text
provider_cost_kobo = round(provider_cost_naira * 100)
charged_total_kobo = ceil(provider_cost_kobo * 110 / 100)
platform_margin_kobo = charged_total_kobo - provider_cost_kobo
```

All arithmetic uses integer kobo. The public quote's `price` is
`charged_total_kobo / 100`. Non-GIGL quotes are unchanged. Applying the helper to
an already-priced snapshot is forbidden; call sites must always project from a
fresh provider-cost quote.

The quote API ranks GIGL options by the public price, stores the public price in
`shipping_quotes.price`, and stores the provider cost and platform margin in
dedicated columns. The API response omits raw provider payloads and internal
financial fields. Cached quote reads return the same public price.

This preserves the existing order-time invariant that selected quote price must
equal `orders.shipping_fee` for shopper-paid shipping.

## Order Funding Contract

New order shipping snapshots distinguish how the carrier charge was funded:

| Funding source | Created when | Settlement behavior | Booking behavior |
|---|---|---|---|
| `customer_checkout` | A storefront order is created with a selected GIGL quote | Retain the full charged shipping amount from merchant settlement | Do not debit merchant wallet |
| `merchant_wallet` | Admin obtains a fresh GIGL quote for an existing manual order | Do not change the original order total or customer invoice | Reserve/debit the full charged shipping amount before provider submission |

For both sources, the order snapshots quote ID, provider cost, platform margin,
charged amount, and currency. The snapshots are immutable for a booked shipment.
Changing the selected quote before booking replaces the unbooked snapshot.

Storefront order creation stamps `customer_checkout` from the selected quote in
the database boundary. For Admin orders, the existing trusted shipping-quote
persistence edge first creates an order-scoped, server-attested GIGL quote from
authoritative order, item, receiver, and merchant-origin data. The authenticated
binding RPC accepts only that persisted quote ID, revalidates its server-authored
Admin-order context, merchant, provider, pricing version, currency, expiry, and
delivery mode under row locks, and then stamps `merchant_wallet`. It never
accepts caller-supplied quote JSON or economics. Simply attaching an arbitrary
quote to an old order must never silently be interpreted as shopper-paid or
wallet-funded shipping.

## Merchant Wallet and Ledger

The existing merchant wallet remains the canonical balance. Shipping spends and
bank-transfer credits use append-only `wallet_transactions` entries with stable
business keys.

A merchant shipping charge record owns the state machine for a manual order:

```text
quoted -> reserved -> provider_submitting -> booked
                              |
                              +-> refunded            (definitive rejection)
                              +-> needs_reconciliation (ambiguous outcome)
```

Required properties:

- One active charge per order and selected quote.
- Reserving is atomic: lock wallet, verify ownership/quote/current balance,
  decrement available balance, and append the debit ledger entry.
- A token-gated begin-submission transition moves the charge from `reserved` to
  `provider_submitting` immediately before the first external GIGL request.
- Repeating the same request returns the existing reservation or booking; it
  never debits twice.
- The API generates an unguessable attempt token before provider submission.
  Completion, refund, and reconciliation transitions require that token.
- A definitive pre-booking or provider rejection refunds exactly once with a
  linked credit ledger entry.
- A timeout or other ambiguous provider result is not automatically retried or
  refunded. The funds and existing shipment-booking lock remain held in
  `needs_reconciliation` until provider state is checked.
- A successful provider booking links the charge, shipment, quote, and wallet
  transaction before the order is exposed as shipped.

Only merchant owners may provision/fund the wallet or authorize a wallet-backed
GIGL booking in the first release. Existing staff may continue self-fulfilment.
This is narrower than granting an order fulfilment role authority over merchant
funds.

## Merchant Wallet Funding

Paystack's supported DVA lifecycle is asynchronous. Baci therefore uses one
reusable platform-level Paystack DVA per merchant owner, with explicit consent
recorded when the merchant taps **Fund Wallet**.

The DVA is not connected to the merchant's Paystack subaccount: these funds are
held in the Baci merchant wallet to pay platform services such as GIGL. The
funding endpoint creates or returns the merchant's existing account and exposes
only bank name, account name, account number, currency, and current status.

Paystack `charge.success` webhooks match `authorization.channel =
dedicated_nuban` and the receiver account number to exactly one active merchant
wallet account. A service-only, idempotent database function credits the verified
NGN amount and appends a ledger row keyed by the Paystack reference. Zero or
ambiguous account matches enter the existing payment reconciliation path and do
not credit a wallet.

The Admin app shows:

- current wallet balance;
- final GIGL price;
- exact shortfall;
- DVA bank/account details with copy actions; and
- a refresh action plus bounded polling after the merchant indicates transfer.

Transfers can arrive after the sheet closes. The full verified amount is always
credited, so excess remains available for future shipments.

This follows Paystack's documented model: DVA assignment may be asynchronous,
bank-transfer completion is confirmed by `charge.success`, and requery triggers
webhook delivery rather than returning funds synchronously.

References:

- https://paystack.com/docs/api/dedicated-virtual-account/
- https://paystack.com/docs/payments/dedicated-virtual-accounts/
- https://paystack.com/docs/payments/webhooks/

## Admin Fulfilment Flow

1. The merchant moves a processing manual order toward **Shipped** and opens the
   existing shipment sheet.
2. The Admin app requests a new order-scoped GIGL quote. A protected mode on the
   existing trusted quote edge derives the receiver, items, weight, and merchant
   origin from the order and merchant, calls GIGL, and persists server-authored
   Admin-order provenance. The client cannot replace tenant, order financial
   data, or quote economics.
3. The server binds only the persisted attested quote ID after independently
   checking merchant, order context, GIGL pricing version, NGN currency, expiry,
   and address-delivery mode. It returns the cheapest eligible option, its
   expiry, wallet balance, and shortfall, and stamps the order as
   `merchant_wallet` funded. Station-pickup quotes are not silently substituted
   for delivery to the customer's address.
4. The sheet labels the option **Ship with GIG** and shows the bundled price.
5. If the balance is sufficient, **Continue** confirms the quote and books. If
   not, **Fund wallet** reveals the Paystack bank-transfer details and exact
   shortfall.
6. After funding is observed, the app refreshes the quote if it expired or the
   order/address changed. The merchant must confirm the resulting amount.
7. On success, the existing tracking, rider/contact, notification, and order
   status behavior continues with the provider shipment identifiers.

When required receiver fields, merchant origin, or items are missing, the quote
route returns a typed, actionable error. Existing 1 kg item fallback behavior is
retained for products without a recorded weight; the UI must not invent an
address, city, state, country, or phone number.

## Storefront and Settlement Flow

Web and mobile storefronts continue calling the shared quote API and rendering
`quote.price`; neither client implements markup arithmetic. This makes the 10%
price consistent across clients and prevents double application.

When a new storefront order selects a GIGL quote, the database stamps the split
and `customer_checkout` funding source. Paid-order settlement adds the snapshotted
charged shipping amount to the amount retained by Baci. Existing commerce and
gateway fees remain governed by the current settlement calculation, and total
deductions may never exceed verified gross funds.

The settlement side-effect result records the commerce platform fee and retained
shipping amount separately even if the existing settlement RPC receives their
combined platform deduction. That keeps retries idempotent and makes the GIGL
economics auditable without changing shopper receipts.

Legacy orders with no new funding-source snapshot retain their current behavior;
the rollout does not guess whether an old shipping fee was collected for Baci.

## API and Authorization Boundaries

- Every new merchant endpoint authenticates first through
  `authenticateApiRequest`, supporting mobile Bearer tokens and web cookies.
- Request bodies and route parameters are validated with colocated Zod schemas
  before database mutation.
- Tenant identity comes from `getUserAccess`; body-provided merchant IDs confer
  no authority.
- Owner authorization is checked both in the route and inside every
  `SECURITY DEFINER` wallet function.
- User-facing routes use the authenticated scoped Supabase client. They do not
  construct a service-role client.
- The existing verified Paystack webhook is the only service-role entry point
  for merchant-wallet funding credits.
- Raw Paystack/GIGL bodies, credentials, account-owner PII, attempt tokens, and
  provider tariffs never enter logs or public API responses.

## Failure and Retry Semantics

- Quote unavailable: no mutation and self-fulfil remains available.
- Quote expired before confirmation: require a new quote and confirmation.
- Wallet short: return `MERCHANT_WALLET_INSUFFICIENT` with public balance,
  charged amount, and shortfall; do not reserve or call GIGL.
- Duplicate confirm: return the existing reservation/booked shipment.
- Definitive GIGL rejection: token-gated refund and release the booking lock.
- Ambiguous GIGL outcome: retain funds and lock, mark reconciliation required,
  and do not create a second provider shipment.
- Provider booked but local shipment save failed: retain funds and mark
  reconciliation required with the provider reference/tracking data available
  to operators; never refund automatically.
- DVA provisioning pending: return a pending state and wait for Paystack's
  assignment webhook rather than fabricating account details.
- Duplicate Paystack webhook: return the existing wallet credit without changing
  the balance again.

## Testing

- Pure pricing tests cover GIGL, non-GIGL, fractional kobo rounding, zero/invalid
  values, and repeat-application protection.
- Quote-route tests prove public price, internal snapshots, response redaction,
  cached reads, and unchanged non-GIGL behavior.
- Migration contract tests prove RLS/grants, owner checks, idempotent reserve,
  insufficient balance, completion, definitive refund, and ambiguous hold.
- Settlement tests prove customer-paid GIGL retention and no retention for
  manual or legacy orders.
- Webhook tests prove exact DVA match, duplicate delivery, excess credit, wrong
  currency, and zero/ambiguous-account review behavior.
- Admin route tests cover auth, owner-only authorization, missing order data,
  fresh quote, insufficient funds, booking success, definitive failure, and
  ambiguous failure.
- Mobile tests prove the old disabled provider becomes **Ship with GIG**, bundled
  price display, exact-shortfall funding UI, bounded balance polling, explicit
  post-funding confirmation, and self-fulfil fallback.
- Full lint, typecheck, tests, migration checks, CodeRabbit, and an independent
  Luna whole-branch critique run before handoff.

## Rollout and Operations

- New tables/functions/columns are added only through an append-only migration.
- Markup is a named platform constant in one server module, not a merchant
  setting and not a client feature flag.
- Existing GIGL provider credentials and GIGL wallet funding are unchanged.
- Logs and metrics identify quote, order, charge, and shipment IDs, never secret
  tokens or raw provider bodies.
- Reconciliation views must expose charges stuck in `needs_reconciliation` or
  `provider_submitting` beyond their expected window before enabling the Admin
  booking option in production.

## Non-goals

- Applying Baci margin to Topship, Shiip, or merchant-configured rates.
- Showing the internal GIGL tariff or margin breakdown in customer/merchant UI.
- Card or USDT merchant-wallet funding.
- Automatically booking immediately after a bank transfer.
- Letting staff roles spend or fund the owner wallet in the first release.
- Refunding ambiguous provider attempts automatically.
- Changing GIGL credentials, commercial agreement, or provider-wallet funding.
- Deploying, enabling production flags, or migrating live data in this branch.
