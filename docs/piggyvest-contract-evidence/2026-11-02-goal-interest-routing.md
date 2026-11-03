# PiggyVest sandbox contract evidence: 2026-11-02

> Live run against the PiggyVest sandbox host staging.piggyvest.business. Mode: live-sandbox-mutations.
> Pseudonyms such as W1 or C1 are stable within this run only. No ids, account numbers, names, emails, phones, BVNs, keys or balances of people appear.

## Summary

| Proof | Status | Findings yes / no / unknown |
| --- | --- | --- |
| p7 | observed | 11 / 3 / 3 |

## P7: Main-wallet interest routing at creation

Status: **observed**

| Finding | Question | Answer | Detail |
| --- | --- | --- | --- |
| customer_create_with_payout_accepted | Does POST /customers accept enable_interest_accrual=true with interest_payout_wallet set to the business wallet? | yes |  |
| customer_created_fresh | Was a new customer created (so the settings were actually applied)? | yes |  |
| main_wallet_readback_exposes_interest_fields | Does GET /wallet/:id expose interest or payout settings? | yes |  |
| main_wallet_readback_names_payout_destination | Does a readback field equal the payout wallet that was set? | yes |  |
| main_wallet_accrual_flag_readable | Is the accrual on/off setting readable? | yes |  |
| goal_payout_update_after_creation_documented | Does a documented endpoint set a goal's interest payout (to itself) after creation? | no | PiggyVest public API docs read 2026-11-02: no endpoint changes a wallet's interest payout or accrual after creation; nothing undocumented was tried |
| goal_without_payout_created | Is a goal sub-wallet with its own payout left unset created? | yes |  |
| goal_without_payout_inherits_business_payout | Does a goal wallet with no payout of its own inherit the customer's business payout wallet? | unknown | the readback names no payout wallet (null): that proves nothing unless PiggyVest confirms in writing where it pays; sandbox rates are 0%, so no payout can be observed |
| goal_explicit_payout_accepted | Does POST /wallet/sub-account accept interest_payout_wallet? | yes |  |
| goal_explicit_readback_names_payout_destination | Does the explicit goal wallet readback name that payout wallet? | yes |  |
| goal_opted_out_created | Is an opted-out goal sub-wallet (accrual off, payout unset) created? | yes |  |
| goal_opted_out_reads_accrual_off | Does the opted-out goal read back interest_enabled=false? | yes |  |
| goal_payout_main_accepted | Does POST /wallet/sub-account accept interest_payout_wallet set to the customer's own main wallet? | yes |  |
| goal_a_interest_stays_in_goal | Goal (a): does its readback name the goal itself as the payout wallet (interest stays in the goal)? | unknown | the readback names no payout wallet (null): that proves nothing unless PiggyVest confirms in writing where it pays; sandbox rates are 0%, so no payout can be observed |
| goal_b_interest_stays_in_goal | Goal (b): does its readback name the goal itself as the payout wallet (interest stays in the goal)? | unknown | the readback names no payout wallet (null): that proves nothing unless PiggyVest confirms in writing where it pays; sandbox rates are 0%, so no payout can be observed |
| goal_c_interest_stays_in_goal | Goal (c): does its readback name the goal itself as the payout wallet (interest stays in the goal)? | no |  |
| goal_d_interest_stays_in_goal | Goal (d): does its readback name the goal itself as the payout wallet (interest stays in the goal)? | no |  |

Values:

- create_http_status: 200
- create_outcome: accepted
- main_wallet_interest_field_names: auto_payout,interest_payout_wallet,interest_enabled,interest_forfeiture_minimum_transactions
- main_wallet_rate_field_names: creation_interest_rate,current_interest_rate
- main_wallet_payout_field_paths: interest_payout_wallet
- main_wallet_accrual_enabled: true
- wallet_list_interest_field_names: auto_payout,interest_payout_wallet,interest_enabled
- goal_a_http_status: 202
- goal_a_outcome: accepted
- goal_a_interest_enabled_at_0m: true
- goal_a_payout_at_0m: null
- goal_a_interest_enabled_at_5m: true
- goal_a_payout_at_5m: null
- goal_a_verdict: not_proven
- goal_b_http_status: 202
- goal_b_outcome: accepted
- goal_b_interest_enabled_at_0m: false
- goal_b_payout_at_0m: null
- goal_b_interest_enabled_at_5m: false
- goal_b_payout_at_5m: null
- goal_b_verdict: not_proven
- goal_c_http_status: 202
- goal_c_outcome: accepted
- goal_c_interest_enabled_at_0m: true
- goal_c_payout_at_0m: main
- goal_c_interest_enabled_at_5m: true
- goal_c_payout_at_5m: main
- goal_c_verdict: not_proven
- goal_d_http_status: 202
- goal_d_outcome: accepted
- goal_d_interest_enabled_at_0m: true
- goal_d_payout_at_0m: business
- goal_d_interest_enabled_at_5m: true
- goal_d_payout_at_5m: business
- goal_d_verdict: not_proven
- interest_routing_verdict: create_time_routing_verified

Response shapes (field names and types only):

#### GET /wallet/:id (P7 main wallet) (HTTP 200)

| Path | Type |
| --- | --- |
| id | string(ulid) |
| business_id | string(ulid) |
| branch_id | string(ulid) |
| faas_wallet_identifier | string(uuid) |
| currency | string(enum:NGN) |
| name | string(text) |
| status | string(enum:active) |
| auto_payout | boolean |
| type | string(enum:api) |
| tag | null |
| is_subaccount | boolean |
| parent_wallet_id | string(ulid) |
| balance | integer |
| ledger_balance | integer |
| gradient_color_id | null |
| provider_payload | null |
| auto_withdrawal_destination_type | null |
| auto_withdrawal_destination_id | null |
| auto_withdrawal_destination_name | null |
| auto_withdrawal_destination_code | null |
| auto_withdrawal_destination_bank_name | null |
| auto_withdrawal_destination_bank_logo | null |
| is_frozen | boolean |
| api_customer_id | string(ulid) |
| bypass_withdrawal_limit_rule | null |
| interest_payout_wallet | string(ulid) |
| interest_enabled | boolean |
| approval_workflow_id | null |
| creation_interest_rate | integer |
| current_interest_rate | integer |
| created_at | string(iso-datetime) |
| updated_at | string(iso-datetime) |
| deleted_at | null |
| split_save[] | array(len=0) |
| has_an_active_lien | boolean |
| withdrawal_count | integer |
| interest_forfeiture_minimum_transactions | integer |

> Goal (a) opted in, payout unset: accepted; payout at 0 min null, at 5 min null; interest_enabled true then true; verdict not proven.
> Goal (b) opted out (accrual off), payout unset: accepted; payout at 0 min null, at 5 min null; interest_enabled false then false; verdict not proven.
> Goal (c) opted in, payout = the customer's main wallet: accepted; payout at 0 min main, at 5 min main; interest_enabled true then true; verdict not proven.
> Goal (d) opted in, payout = the business wallet: accepted; payout at 0 min business, at 5 min business; interest_enabled true then true; verdict not proven.
> Goal payout pseudonyms: self = the goal itself; main = the customer's main wallet; business = the business (interest) wallet; null = the payout field is empty; other = any other wallet; absent = the readback omitted the field; unread = no readback. Only self proves interest stays in the goal; null proves nothing unless PiggyVest confirms it in writing.
> Sandbox interest rates are 0%, so no interest payout can be observed here: where goal interest is really paid stays a release check (the first monthly payout).
> Written question for the owner to send PiggyVest: when a goal sub-wallet is created with enable_interest_accrual=true and no interest_payout_wallet, where is its interest paid, and can it be paid into the goal itself? Until PiggyVest answers in writing, goal interest staying in the goal counts as not proven.
> verdict: verified = accepted and readable, so route at creation; rejected or unverifiable = sweep the interest after it lands with a main to Ogabassey wallet-to-wallet transfer (proofs 2 and 4 cover that transfer); unconfirmed = the readback never showed a payout destination field within the polling budget, so re-run before deciding.
> Correction recorded 2026-11-02 after a harness fix (no request was re-sent): goal_without_payout_inherits_business_payout now follows goal (a)'s final reading, the same one its verdict uses, so a null payout reads unknown (it proves nothing unless PiggyVest confirms in writing), not no.

## Assumptions the live run must confirm

- GET /api/v1/customers with third_party_identifier returns a list under paginatedPayload.edges, edges, or a bare array (the container found is recorded).
- Customer list rows carry the customer id as customer_id or id.
- GET /api/v1/wallet/:id returns api_customer_id (undocumented); wallet ownership is proven from it and nothing weaker.
- Wallet list rows (orderBy ASC/DESC) carry id, name and created_at; otherwise default-wallet-by-order cannot be judged.
- TSQ for a wallet-to-wallet transfer accepts wallet_id as a filter; its field names for source, destination, fee and currency are unknown until observed.
- TSQ status vocabulary is success\|pending\|failed while list/single use successful; a 404 may mean unknown OR not yet indexed.
- POST /api/v1/transfer/test/funding is the sandbox stand-in for a bank deposit to a virtual account number; it may lag or not settle (seen on 17 Sep).
- The sandbox accepts a bank outflow to an operator-supplied NUBAN and bank code (PVB_PROOF_BANK_CODE, PVB_PROOF_BANK_ACCOUNT) and settles it.
- withdrawal_count appears on GET /wallet/:id for every wallet and updates within the polling window after a settled outflow.
- Accrual and transaction reads accept limit up to 100 and a cursor; sandbox rates are 0% so no accrual edge may exist to inspect.
- Synthetic QA identities (000-prefixed 11-digit BVN, example.test email) are accepted by the sandbox; the 17 Sep probe accepted an all-zeros BVN.
- POST /customers accepts interest_payout_wallet set to an Ogabassey business sandbox wallet (PVB_PROOF_BUSINESS_WALLET_ID) together with enable_interest_accrual=true; whether GET /wallet/:id can read the payout destination back is unknown.
- POST /wallet/sub-account accepts interest_payout_wallet, and a goal sub-wallet created with no payout of its own may or may not inherit the customer payout wallet.
- Webhook delivery cannot be observed by this harness; the credited-wallet field must be confirmed from the durable inbox.

## Guards active in this run

- base URL host must be exactly staging.piggyvest.business; API key must be a test key
- dry-run is the default and uses mocks only; live-readonly sends GET only
- mutations need --live-sandbox-mutations, an allowlist of QA customer ids, a journaled intent and a unique reference
- the protected recording account is refused in arguments, requests and responses
- evidence is scanned for ids, emails, phones, BVNs, account numbers, keys and balances before it is written
