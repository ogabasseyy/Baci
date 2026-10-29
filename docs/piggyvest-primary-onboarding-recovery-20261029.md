# Primary wallet recovery evidence

On 29 October 2026, read-only PiggyVest staging queries for the separate fresh
QA customer returned one customer by provider ID and by the application's
`third_party_identifier`. Both lookups returned the same customer ID and the
expected correlation. No provider IDs, personal fields or balances were logged.

The documented customer response does not identify its default wallet. A
customer-filtered wallet list returned six wallets for this QA customer; all six
matched the expected customer and business, and none exposed an `is_default` or
`is_primary` field. All six were marked as subaccounts. This observation does
not establish how to select the originally created default wallet, or what the
production response contains. An empty, incomplete or ambiguous lookup must not
be treated as proof that no wallet exists.

PiggyVest documents that `returnIfExist` can match an existing customer using
email, phone or BVN. A matching response or a repeated request fingerprint is
therefore not independent proof that the returned wallet belongs to the local
customer. A reclaimed uncertain onboarding intent now remains uncertain and
does not send another create request or accept provider IDs. Until a recovery
path proves both the customer correlation and the intended wallet, this case
requires review and is not automatically recoverable.

References: [create customer](https://www.piggyvestbusiness.com/docs/api/customers/create),
[fetch customers](https://www.piggyvestbusiness.com/docs/api/customers/fetch),
and [fetch wallets](https://www.piggyvestbusiness.com/docs/api/wallet/list).
