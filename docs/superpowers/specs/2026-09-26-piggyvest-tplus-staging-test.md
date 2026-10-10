# PiggyVest T+1 staging test

Date: 26 September 2026. All timestamps below are UTC.
Scope: one genuine Paystack test-card payment, one PiggyVest staging T+1 POST,
and read-only checks of the provider wallet, transactions and receipt database.
No real card, production payment, deployment, service restart, database write,
lease extension or financial configuration change was performed by the probe.

## Result

Paystack successfully collected 10,000 kobo (NGN 100) in test mode. PiggyVest
rejected the T+1 notification because it is not activated for the staging
business. No corresponding PiggyVest credit or new webhook receipt was observed.

## Paystack verification

- Reference: `baci-tplus-probe-20260926-a1b86fcbdb78`.
- Transaction ID: `6596664591`.
- Verified domain: `test`; status: `success`; channel: `card`.
- Amount: `10000` kobo; currency: `NGN`; reported fee: `150` kobo.
- Created: `2026-09-26T09:35:54.000Z`.
- Paid: `2026-09-26T09:36:32.000Z`.
- Checkout visibly displayed TEST and used Paystack's built-in Success option.
- The reference was fresh and separate from application wallet top-up intents;
  the application confirmation/credit route was not called.

## PiggyVest request and actual response

Origin: `https://staging.piggyvest.business`.
Endpoint: `POST /api/v1/transfer/tplusOne`.
The existing mapped staging probe wallet was revalidated against its expected
business, active status, NGN currency and isolated customer/merchant mapping.

```json
{
  "provider": "paystack",
  "provider_reference": "baci-tplus-probe-20260926-a1b86fcbdb78",
  "amount": 10000,
  "wallet_id": "01M2T3PCEDE2MGF2S7Y5T49H01",
  "created_at": "2026-09-26 09:35:54"
}
```

HTTP 403:

```json
{
  "status": false,
  "message": "Tplus one not activated for your business",
  "data": {}
}
```

The POST was not repeated. UTC and the gross collection amount were used for
this probe; rejection does not validate the provider's timezone or fee semantics.

## Independent before/after checks

| Observation | Before, 09:33:08 | After, 09:37:30 |
| --- | --- | --- |
| Provider balance, kobo | 20000 | 20000 |
| Provider ledger balance, kobo | 20000 | 20000 |
| Durable receipt count | 13 | 13 |
| Latest receipt timestamp | 2026-09-25T17:01:04.955632Z | Unchanged |

The provider transaction-list call returned HTTP 200 with two transactions;
neither matched this Paystack reference. Receipt absence is bounded to this
observation window, not a guarantee about all future deliveries.

Database identities were verified before their read-only queries:
application cluster `7685292944002592802`, receipt cluster `7686901100561231906`.
The fixed expiry `2026-09-29T15:59:10Z` was checked and preserved.

## Other test observations

- Paystack rejected the existing fixture's `.invalid` email address during
  initialization. A clearly named synthetic address under the owner's domain
  was used instead; the phone customer's database record was not changed.
- The staging `/checkout/success` callback returned 404 after checkout. The
  successful payment was independently verified through Paystack's API. This
  callback-page issue is separate from PiggyVest's explicit activation refusal.
- API credentials were entered through a hidden terminal prompt or read from
  the existing private staging credential source; none are in this report or
  the probe scripts. No saved-card authorization was persisted by this probe.

## Next action

Ask PiggyVest to enable T+1 for the staging business and explain the Paystack
settlement linkage and wallet credit timing. Before a subsequent POST, reverify
the original payment and check provider records for any late processing; do not
blindly replay or create additional collections. A successful future HTTP 200
still requires wallet, transaction, webhook and application-ledger verification.

Evidence is retained privately in
`/home/bassey/baci-tplus-one-probe-20260926` on the VPS and
`/private/tmp/baci-tplus-one-20260926.RKRVVC` on the Mac.

Sources: [PiggyVest T+1 API](https://www.piggyvestbusiness.com/docs/api/t-plus-1),
[Paystack transaction API](https://paystack.com/docs/api/transaction/), and
[Paystack test payments](https://paystack.com/docs/payments/test-payments/).
