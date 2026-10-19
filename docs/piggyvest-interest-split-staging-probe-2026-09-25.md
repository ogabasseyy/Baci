# PiggyVest interest split: staging observations

Checked 25 September 2026, approximately 06:33 UTC, using the existing staging credential and only GET requests against `https://staging.piggyvest.business`. Credentials, customer identity details and bank account details were not printed or saved. No provider configuration, wallets, balances or application code were changed.

## Observed responses

`GET /api/v1/wallet/api/wallet-type?limit=100` returned HTTP 200, three wallets, `hasNextPage: false`, and a top-level `interest_rate: 6`. This field alone does not establish the global gross rate or either party's share; it must not be equated with the dashboard screenshot's displayed 12%.

| Wallet suffix | Balance in kobo | `interest_enabled` | Creation rate | Current rate | `interest_payout_wallet` |
| --- | ---: | --- | ---: | ---: | --- |
| YFWGX3 | 10000 | null | 0 | 0 | null |
| T49H01 | 20000 | true | 0 | 0 | null |
| C8P5FG | 0 | true | 0 | 0 | null |

The known probe wallet ending T49H01 also returned HTTP 200 from the individual wallet endpoint, with balance and ledger balance both 20000 kobo. A historical nested provider destination ID returned 404; it is not substituted for the top-level API wallet ID.

For each of the three API wallets, queried `GET /api/v1/wallet/interests/accrued/:wallet_id` twice, using `interest_type=original` and `interest_type=differential`, date range 1–25 September 2026, and limit 100. All six responses were HTTP 200 with provider success, zero records and `hasNextPage: false`.

The first Python urllib requests received Cloudflare HTTP 403 text responses. Node fetch using the app's documented Bearer authentication and JSON request headers reached the API. The 403s do not establish bad credentials or an interest API failure.

## What remains unknown

These reads prove the current staging wallet fields and absence of stored accrual rows in the queried window. They do not prove a split calculation, merchant payout, customer payout, or that the returned zero wallet rates caused the empty history.

The current [create customer](https://www.piggyvestbusiness.com/docs/api/customers/create) and [create wallet](https://www.piggyvestbusiness.com/docs/api/wallet/create) references document accrual enablement and a payout destination but no share-setting parameter. The [interest reference](https://www.piggyvestbusiness.com/docs/api/wallet/interest) documents original/differential reads, not a split configuration operation. Sending guessed write fields could silently do nothing and would not prove a supported API contract.

The focused provider question is which supported endpoint and request field configures the merchant share shown in the dashboard, whether the setting can vary by wallet, and the example payload needed to exercise a nonzero split in staging. Once that configuration is known, test actual accrual arithmetic, destination routing and payout records directly instead of asking the provider to explain facts observable in those responses.
